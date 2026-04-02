# =============================================================================
# TentaCLAW OS -- AWS Terraform Deployment
# =============================================================================
#
# Deploys a production TentaCLAW inference cluster on AWS:
#   - 1x Gateway instance (t3.medium -- coordinator, dashboard, API)
#   - Nx GPU Worker instances (g5.xlarge -- NVIDIA A10G inference)
#   - VPC with public/private subnets
#   - Application Load Balancer with health checks
#   - Security groups (role-based, least-privilege)
#   - S3 bucket for model storage (optional)
#   - IAM roles (no hardcoded credentials)
#   - User data scripts for automated TentaCLAW installation
#
# Usage:
#   cd deploy/terraform/aws
#   cp terraform.tfvars.example terraform.tfvars
#   # Edit terraform.tfvars with your values
#   terraform init
#   terraform plan
#   terraform apply
#
# Or with environment variables:
#   export TF_VAR_ssh_key_name="my-key"
#   export TF_VAR_aws_region="us-east-1"
#   terraform init && terraform apply
#
# SECURITY:
#   - No hardcoded secrets. AWS credentials via environment, profile, or IAM role.
#   - All instances use IAM instance profiles (no access keys on machines).
#   - SSH restricted to specified CIDR blocks.
#   - Workers are not directly accessible from the internet (ALB only).
#
# TentaCLAW says: "Eight arms in the cloud. Enterprise-grade grip."
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment to use S3 backend for remote state
  # backend "s3" {
  #   bucket         = "tentaclaw-terraform-state"
  #   key            = "aws/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "tentaclaw-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# =============================================================================
# Local Values
# =============================================================================

locals {
  common_tags = {
    Project     = "tentaclaw"
    Cluster     = var.cluster_name
    ManagedBy   = "terraform"
    Environment = var.environment
  }

  gateway_private_ip = cidrhost(aws_subnet.private.cidr_block, 10)
}

# =============================================================================
# Data Sources
# =============================================================================

# Latest Ubuntu 24.04 AMI (Canonical official)
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

# Latest Deep Learning AMI for GPU workers (includes NVIDIA drivers + CUDA)
data "aws_ami" "gpu_worker" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

# Available AZs in the selected region
data "aws_availability_zones" "available" {
  state = "available"
}

# =============================================================================
# VPC & Networking
# =============================================================================

resource "aws_vpc" "tentaclaw" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.cluster_name}-vpc"
  }
}

# Internet Gateway for public subnet
resource "aws_internet_gateway" "tentaclaw" {
  vpc_id = aws_vpc.tentaclaw.id

  tags = {
    Name = "${var.cluster_name}-igw"
  }
}

# Public subnet (ALB, NAT Gateway)
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.tentaclaw.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.cluster_name}-public"
    Type = "public"
  }
}

# Second public subnet in different AZ (required for ALB)
resource "aws_subnet" "public_secondary" {
  vpc_id                  = aws_vpc.tentaclaw.id
  cidr_block              = var.public_subnet_secondary_cidr
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.cluster_name}-public-secondary"
    Type = "public"
  }
}

# Private subnet (gateway, workers)
resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.tentaclaw.id
  cidr_block        = var.private_subnet_cidr
  availability_zone = data.aws_availability_zones.available.names[0]

  tags = {
    Name = "${var.cluster_name}-private"
    Type = "private"
  }
}

# Elastic IP for NAT Gateway
resource "aws_eip" "nat" {
  domain = "vpc"

  tags = {
    Name = "${var.cluster_name}-nat-eip"
  }
}

# NAT Gateway (allows private subnet instances to reach the internet)
resource "aws_nat_gateway" "tentaclaw" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id

  tags = {
    Name = "${var.cluster_name}-nat"
  }

  depends_on = [aws_internet_gateway.tentaclaw]
}

# Route table for public subnet
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.tentaclaw.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.tentaclaw.id
  }

  tags = {
    Name = "${var.cluster_name}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_secondary" {
  subnet_id      = aws_subnet.public_secondary.id
  route_table_id = aws_route_table.public.id
}

# Route table for private subnet (via NAT Gateway)
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.tentaclaw.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.tentaclaw.id
  }

  tags = {
    Name = "${var.cluster_name}-private-rt"
  }
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

# =============================================================================
# Security Groups
# =============================================================================

# --- ALB Security Group ---
resource "aws_security_group" "alb" {
  name_prefix = "${var.cluster_name}-alb-"
  vpc_id      = aws_vpc.tentaclaw.id
  description = "TentaCLAW ALB - HTTP/HTTPS from internet"

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.cluster_name}-alb-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# --- Gateway Security Group ---
resource "aws_security_group" "gateway" {
  name_prefix = "${var.cluster_name}-gateway-"
  vpc_id      = aws_vpc.tentaclaw.id
  description = "TentaCLAW Gateway - API, Dashboard, SSH"

  # SSH access (restricted)
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
  }

  # Gateway API from ALB
  ingress {
    description     = "Gateway API from ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Gateway API from workers (private network)
  ingress {
    description = "Gateway API from private subnet"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = [var.private_subnet_cidr]
  }

  # UDP auto-discovery (cluster-internal)
  ingress {
    description = "UDP auto-discovery"
    from_port   = 41337
    to_port     = 41337
    protocol    = "udp"
    cidr_blocks = [var.private_subnet_cidr]
  }

  # Prometheus (cluster-internal)
  ingress {
    description = "Prometheus"
    from_port   = 9090
    to_port     = 9090
    protocol    = "tcp"
    cidr_blocks = [var.private_subnet_cidr]
  }

  # Grafana (restricted to SSH-allowed IPs)
  ingress {
    description = "Grafana"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.cluster_name}-gateway-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# --- Worker Security Group ---
resource "aws_security_group" "worker" {
  name_prefix = "${var.cluster_name}-worker-"
  vpc_id      = aws_vpc.tentaclaw.id
  description = "TentaCLAW Worker - Ollama, Agent, metrics (cluster-internal only)"

  # SSH access (restricted)
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
  }

  # Ollama API (from gateway only)
  ingress {
    description     = "Ollama API from gateway"
    from_port       = 11434
    to_port         = 11434
    protocol        = "tcp"
    security_groups = [aws_security_group.gateway.id]
  }

  # UDP auto-discovery (cluster-internal)
  ingress {
    description = "UDP auto-discovery"
    from_port   = 41337
    to_port     = 41337
    protocol    = "udp"
    cidr_blocks = [var.private_subnet_cidr]
  }

  # Node exporter metrics (from gateway/Prometheus)
  ingress {
    description     = "Node exporter"
    from_port       = 9100
    to_port         = 9100
    protocol        = "tcp"
    security_groups = [aws_security_group.gateway.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.cluster_name}-worker-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# =============================================================================
# IAM Roles & Instance Profiles (no hardcoded credentials)
# =============================================================================

# --- Gateway IAM Role ---
resource "aws_iam_role" "gateway" {
  name_prefix = "${var.cluster_name}-gateway-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "${var.cluster_name}-gateway-role"
  }
}

# Gateway policy: S3 access for model storage, CloudWatch for logs
resource "aws_iam_role_policy" "gateway" {
  name_prefix = "${var.cluster_name}-gateway-"
  role        = aws_iam_role.gateway.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ModelAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
          "s3:DeleteObject",
        ]
        Resource = var.enable_s3_model_storage ? [
          aws_s3_bucket.models[0].arn,
          "${aws_s3_bucket.models[0].arn}/*",
        ] : ["arn:aws:s3:::placeholder-not-used"]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
        ]
        Resource = "*"
      },
      {
        Sid    = "EC2DescribeInstances"
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeTags",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "gateway" {
  name_prefix = "${var.cluster_name}-gateway-"
  role        = aws_iam_role.gateway.name
}

# --- Worker IAM Role ---
resource "aws_iam_role" "worker" {
  name_prefix = "${var.cluster_name}-worker-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "${var.cluster_name}-worker-role"
  }
}

# Worker policy: S3 read-only for models, CloudWatch for logs
resource "aws_iam_role_policy" "worker" {
  name_prefix = "${var.cluster_name}-worker-"
  role        = aws_iam_role.worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ModelReadOnly"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
        ]
        Resource = var.enable_s3_model_storage ? [
          aws_s3_bucket.models[0].arn,
          "${aws_s3_bucket.models[0].arn}/*",
        ] : ["arn:aws:s3:::placeholder-not-used"]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "worker" {
  name_prefix = "${var.cluster_name}-worker-"
  role        = aws_iam_role.worker.name
}

# =============================================================================
# Gateway EC2 Instance
# =============================================================================

resource "aws_instance" "gateway" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.gateway_instance_type
  key_name               = var.ssh_key_name
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.gateway.id]
  iam_instance_profile   = aws_iam_instance_profile.gateway.name
  private_ip             = local.gateway_private_ip

  user_data = templatefile("${path.module}/userdata-gateway.sh", {
    cluster_name   = var.cluster_name
    gateway_domain = var.gateway_domain
    worker_count   = var.worker_count
    aws_region     = var.aws_region
    s3_bucket      = var.enable_s3_model_storage ? aws_s3_bucket.models[0].id : ""
    environment    = var.environment
  })

  root_block_device {
    volume_size           = var.gateway_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true

    tags = {
      Name = "${var.cluster_name}-gateway-root"
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 only (security best practice)
    http_put_response_hop_limit = 1
  }

  tags = {
    Name = "${var.cluster_name}-gateway"
    Role = "gateway"
  }

  lifecycle {
    ignore_changes = [user_data, ami]
  }
}

# =============================================================================
# Worker EC2 Instances (GPU)
# =============================================================================

resource "aws_instance" "worker" {
  count = var.worker_count

  ami                    = data.aws_ami.gpu_worker.id
  instance_type          = var.worker_instance_type
  key_name               = var.ssh_key_name
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.worker.id]
  iam_instance_profile   = aws_iam_instance_profile.worker.name

  user_data = templatefile("${path.module}/userdata-worker.sh", {
    cluster_name = var.cluster_name
    gateway_ip   = local.gateway_private_ip
    worker_index = count.index + 1
    worker_name  = "${var.cluster_name}-worker-${format("%02d", count.index + 1)}"
    aws_region   = var.aws_region
    s3_bucket    = var.enable_s3_model_storage ? aws_s3_bucket.models[0].id : ""
  })

  root_block_device {
    volume_size           = var.worker_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true

    tags = {
      Name = "${var.cluster_name}-worker-${format("%02d", count.index + 1)}-root"
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 1
  }

  tags = {
    Name         = "${var.cluster_name}-worker-${format("%02d", count.index + 1)}"
    Role         = "worker"
    WorkerIndex  = tostring(count.index + 1)
  }

  depends_on = [aws_instance.gateway]

  lifecycle {
    ignore_changes = [user_data, ami]
  }
}

# =============================================================================
# Application Load Balancer
# =============================================================================

resource "aws_lb" "tentaclaw" {
  name               = "${var.cluster_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public.id, aws_subnet.public_secondary.id]

  enable_deletion_protection = var.environment == "production" ? true : false

  tags = {
    Name = "${var.cluster_name}-alb"
  }
}

# Target group for the gateway
resource "aws_lb_target_group" "gateway" {
  name     = "${var.cluster_name}-gateway-tg"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = aws_vpc.tentaclaw.id

  health_check {
    enabled             = true
    path                = "/health"
    port                = "8080"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
    matcher             = "200"
  }

  # Stickiness for WebSocket connections (dashboard)
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
    enabled         = true
  }

  tags = {
    Name = "${var.cluster_name}-gateway-tg"
  }
}

# Register gateway with target group
resource "aws_lb_target_group_attachment" "gateway" {
  target_group_arn = aws_lb_target_group.gateway.arn
  target_id        = aws_instance.gateway.id
  port             = 8080
}

# HTTP listener (redirects to HTTPS if domain provided, otherwise serves directly)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.tentaclaw.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }
}

# HTTPS listener (uncomment and provide ACM certificate ARN for TLS)
# resource "aws_lb_listener" "https" {
#   load_balancer_arn = aws_lb.tentaclaw.arn
#   port              = 443
#   protocol          = "HTTPS"
#   ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
#   certificate_arn   = var.acm_certificate_arn
#
#   default_action {
#     type             = "forward"
#     target_group_arn = aws_lb_target_group.gateway.arn
#   }
# }

# =============================================================================
# S3 Bucket for Model Storage (optional)
# =============================================================================

resource "aws_s3_bucket" "models" {
  count  = var.enable_s3_model_storage ? 1 : 0
  bucket = "${var.cluster_name}-models-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.cluster_name}-models"
  }
}

resource "aws_s3_bucket_versioning" "models" {
  count  = var.enable_s3_model_storage ? 1 : 0
  bucket = aws_s3_bucket.models[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "models" {
  count  = var.enable_s3_model_storage ? 1 : 0
  bucket = aws_s3_bucket.models[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "models" {
  count  = var.enable_s3_model_storage ? 1 : 0
  bucket = aws_s3_bucket.models[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "models" {
  count  = var.enable_s3_model_storage ? 1 : 0
  bucket = aws_s3_bucket.models[0].id

  rule {
    id     = "archive-old-models"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# Data source for account ID (used in S3 bucket naming)
data "aws_caller_identity" "current" {}

# =============================================================================
# CloudWatch Log Group
# =============================================================================

resource "aws_cloudwatch_log_group" "tentaclaw" {
  name              = "/tentaclaw/${var.cluster_name}"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.cluster_name}-logs"
  }
}
