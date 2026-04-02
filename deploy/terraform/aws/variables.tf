# =============================================================================
# TentaCLAW OS -- Terraform Variables (AWS)
# =============================================================================
#
# Override defaults via terraform.tfvars or environment variables:
#   export TF_VAR_ssh_key_name="my-key"
#   export TF_VAR_aws_region="us-west-2"
#   export TF_VAR_worker_count=5
#
# TentaCLAW says: "Variables are like tentacles -- flexible and far-reaching."
# =============================================================================

# -----------------------------------------------------------------------------
# Required Variables (no defaults -- must be provided)
# -----------------------------------------------------------------------------

variable "ssh_key_name" {
  description = "Name of the AWS EC2 key pair for SSH access. Must already exist in the target region."
  type        = string
}

# -----------------------------------------------------------------------------
# AWS Region
# -----------------------------------------------------------------------------
# Recommended regions for GPU instances (g5/p4d availability):
#   us-east-1     -- N. Virginia (best availability, cheapest spot)
#   us-west-2     -- Oregon (good GPU stock)
#   eu-west-1     -- Ireland (EU data residency)
#   ap-northeast-1 -- Tokyo (Asia-Pacific)
# -----------------------------------------------------------------------------

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Cluster Identity
# -----------------------------------------------------------------------------

variable "cluster_name" {
  description = "Name prefix for all resources (e.g., 'tentaclaw-prod'). Used in resource names and tags."
  type        = string
  default     = "tentaclaw"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.cluster_name))
    error_message = "Cluster name must be 3-25 lowercase alphanumeric characters or hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment environment tag (dev, staging, production)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}

# -----------------------------------------------------------------------------
# Instance Types
# -----------------------------------------------------------------------------
# Gateway (coordinator -- no GPU needed):
#   t3.medium  -- 2 vCPU,  4 GiB RAM  (small clusters, <10 workers)
#   t3.large   -- 2 vCPU,  8 GiB RAM  (medium clusters, 10-30 workers)
#   m6i.xlarge -- 4 vCPU, 16 GiB RAM  (large clusters, 30+ workers)
#
# Workers (GPU inference):
#   g5.xlarge   -- 1x NVIDIA A10G (24 GB), 4 vCPU,  16 GiB ($1.006/hr on-demand)
#   g5.2xlarge  -- 1x NVIDIA A10G (24 GB), 8 vCPU,  32 GiB ($1.212/hr)
#   g5.4xlarge  -- 1x NVIDIA A10G (24 GB), 16 vCPU, 64 GiB ($1.624/hr)
#   g5.12xlarge -- 4x NVIDIA A10G (96 GB), 48 vCPU, 192 GiB ($5.672/hr)
#   p4d.24xlarge -- 8x NVIDIA A100 (320 GB), 96 vCPU, 1152 GiB ($32.77/hr)
#
# Cost optimization:
#   - Use spot instances for non-critical workloads (60-90% savings)
#   - g5.xlarge spot price is typically ~$0.35-0.50/hr
# -----------------------------------------------------------------------------

variable "gateway_instance_type" {
  description = "EC2 instance type for the gateway node (no GPU needed)"
  type        = string
  default     = "t3.medium"
}

variable "worker_instance_type" {
  description = "EC2 instance type for GPU worker nodes"
  type        = string
  default     = "g5.xlarge"
}

variable "worker_count" {
  description = "Number of GPU worker instances to deploy"
  type        = number
  default     = 2

  validation {
    condition     = var.worker_count >= 1 && var.worker_count <= 50
    error_message = "Worker count must be between 1 and 50."
  }
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR block for the public subnet (ALB, NAT Gateway)"
  type        = string
  default     = "10.0.1.0/24"
}

variable "public_subnet_secondary_cidr" {
  description = "CIDR block for the secondary public subnet (required for ALB multi-AZ)"
  type        = string
  default     = "10.0.2.0/24"
}

variable "private_subnet_cidr" {
  description = "CIDR block for the private subnet (gateway + workers)"
  type        = string
  default     = "10.0.10.0/24"
}

# -----------------------------------------------------------------------------
# Security
# -----------------------------------------------------------------------------

variable "ssh_allowed_cidrs" {
  description = "CIDR blocks allowed to SSH into instances. ALWAYS restrict to your IP in production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
  # SECURITY: In production, restrict this to your IP:
  # default = ["203.0.113.50/32"]
}

variable "gateway_domain" {
  description = "Domain name for the gateway (used for TLS via ACM). Leave empty for IP-based access."
  type        = string
  default     = ""
}

# Uncomment if using HTTPS listener on ALB
# variable "acm_certificate_arn" {
#   description = "ARN of the ACM certificate for HTTPS. Create via AWS Certificate Manager."
#   type        = string
#   default     = ""
# }

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------

variable "gateway_volume_size" {
  description = "Root volume size for the gateway instance in GB"
  type        = number
  default     = 50

  validation {
    condition     = var.gateway_volume_size >= 20 && var.gateway_volume_size <= 1000
    error_message = "Gateway volume size must be between 20 and 1000 GB."
  }
}

variable "worker_volume_size" {
  description = "Root volume size for each worker instance in GB (models are stored here)"
  type        = number
  default     = 100

  validation {
    condition     = var.worker_volume_size >= 50 && var.worker_volume_size <= 2000
    error_message = "Worker volume size must be between 50 and 2000 GB."
  }
}

variable "enable_s3_model_storage" {
  description = "Create an S3 bucket for centralized model storage"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365], var.log_retention_days)
    error_message = "Log retention must be a valid CloudWatch retention period."
  }
}
