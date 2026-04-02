# =============================================================================
# TentaCLAW OS -- Terraform Outputs (AWS)
# =============================================================================
#
# After `terraform apply`, these values are printed and queryable:
#   terraform output gateway_url
#   terraform output -json worker_ips
#   terraform output alb_dns
#
# TentaCLAW says: "Output everything. Hide nothing. Octopuses are transparent."
# =============================================================================

# -----------------------------------------------------------------------------
# Gateway
# -----------------------------------------------------------------------------

output "gateway_private_ip" {
  description = "Private IP of the TentaCLAW gateway instance"
  value       = aws_instance.gateway.private_ip
}

output "gateway_instance_id" {
  description = "EC2 instance ID of the gateway"
  value       = aws_instance.gateway.id
}

output "gateway_url" {
  description = "URL to access the TentaCLAW gateway (via ALB)"
  value       = "http://${aws_lb.tentaclaw.dns_name}"
}

# -----------------------------------------------------------------------------
# Workers
# -----------------------------------------------------------------------------

output "worker_ips" {
  description = "Private IPs of all GPU worker instances"
  value       = [for w in aws_instance.worker : w.private_ip]
}

output "worker_instance_ids" {
  description = "EC2 instance IDs of all worker instances"
  value       = [for w in aws_instance.worker : w.id]
}

output "worker_names" {
  description = "Names of all worker instances"
  value       = [for w in aws_instance.worker : w.tags["Name"]]
}

# -----------------------------------------------------------------------------
# Load Balancer
# -----------------------------------------------------------------------------

output "alb_dns" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.tentaclaw.dns_name
}

output "alb_zone_id" {
  description = "Route 53 zone ID of the ALB (for DNS alias records)"
  value       = aws_lb.tentaclaw.zone_id
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = aws_lb.tentaclaw.arn
}

# -----------------------------------------------------------------------------
# URLs & Connection Info
# -----------------------------------------------------------------------------

output "dashboard_url" {
  description = "URL to access the TentaCLAW dashboard"
  value       = "http://${aws_lb.tentaclaw.dns_name}/dashboard/"
}

output "api_url" {
  description = "Base URL for the TentaCLAW REST API"
  value       = "http://${aws_lb.tentaclaw.dns_name}/api/v1"
}

output "openai_compat_url" {
  description = "OpenAI-compatible API endpoint (point your LLM client here)"
  value       = "http://${aws_lb.tentaclaw.dns_name}/v1"
}

# -----------------------------------------------------------------------------
# SSH Commands (via SSM or bastion -- workers are in private subnet)
# -----------------------------------------------------------------------------

output "ssh_gateway" {
  description = "SSH to gateway via SSM Session Manager (no bastion needed)"
  value       = "aws ssm start-session --target ${aws_instance.gateway.id}"
}

output "ssh_workers" {
  description = "SSH to workers (connect through gateway as jump host)"
  value = {
    for w in aws_instance.worker :
    w.tags["Name"] => "ssh -J ec2-user@${aws_instance.gateway.private_ip} ubuntu@${w.private_ip}"
  }
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

output "vpc_id" {
  description = "VPC ID for the TentaCLAW cluster"
  value       = aws_vpc.tentaclaw.id
}

output "private_subnet_id" {
  description = "Private subnet ID (gateway + workers)"
  value       = aws_subnet.private.id
}

output "gateway_security_group_id" {
  description = "Security group ID for the gateway (use for additional rules)"
  value       = aws_security_group.gateway.id
}

output "worker_security_group_id" {
  description = "Security group ID for workers (use for additional rules)"
  value       = aws_security_group.worker.id
}

# -----------------------------------------------------------------------------
# S3 (if enabled)
# -----------------------------------------------------------------------------

output "s3_model_bucket" {
  description = "S3 bucket name for model storage (empty if disabled)"
  value       = var.enable_s3_model_storage ? aws_s3_bucket.models[0].id : ""
}

output "s3_model_bucket_arn" {
  description = "S3 bucket ARN for model storage (empty if disabled)"
  value       = var.enable_s3_model_storage ? aws_s3_bucket.models[0].arn : ""
}

# -----------------------------------------------------------------------------
# Cluster Summary
# -----------------------------------------------------------------------------

output "cluster_summary" {
  description = "Quick overview of the deployed TentaCLAW cluster"
  value = {
    cluster_name = var.cluster_name
    environment  = var.environment
    region       = var.aws_region
    gateway      = "${var.gateway_instance_type} (${aws_instance.gateway.private_ip})"
    workers      = "${var.worker_count}x ${var.worker_instance_type}"
    alb          = aws_lb.tentaclaw.dns_name
    dashboard    = "http://${aws_lb.tentaclaw.dns_name}/dashboard/"
    api          = "http://${aws_lb.tentaclaw.dns_name}/v1"
    s3_bucket    = var.enable_s3_model_storage ? aws_s3_bucket.models[0].id : "disabled"
  }
}
