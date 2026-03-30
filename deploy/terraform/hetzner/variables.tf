# =============================================================================
# TentaCLAW OS — Terraform Variables (Hetzner Cloud)
# =============================================================================
#
# Override defaults via terraform.tfvars or environment variables:
#   export TF_VAR_hcloud_token="your-token"
#   export TF_VAR_ssh_key_name="my-key"
#
# CLAWtopus says: "Variables are like tentacles — flexible and far-reaching."
# =============================================================================

# -----------------------------------------------------------------------------
# Required Variables (no defaults — must be provided)
# -----------------------------------------------------------------------------

variable "hcloud_token" {
  description = "Hetzner Cloud API token. Create at https://console.hetzner.cloud/"
  type        = string
  sensitive   = true
}

variable "ssh_key_name" {
  description = "Name of the SSH key already uploaded to Hetzner Cloud console"
  type        = string
}

# -----------------------------------------------------------------------------
# Cluster Identity
# -----------------------------------------------------------------------------

variable "cluster_name" {
  description = "Name prefix for all resources (e.g., 'tentaclaw-prod')"
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
# Server Types
# -----------------------------------------------------------------------------
# Hetzner Cloud server types: https://www.hetzner.com/cloud
#
# Gateway (coordinator — no GPU needed):
#   cx22  — 2 vCPU,  4GB RAM  (good for small clusters, <10 nodes)
#   cx32  — 4 vCPU,  8GB RAM  (medium clusters, 10-50 nodes)
#   cx42  — 8 vCPU, 16GB RAM  (large clusters, 50+ nodes)
#
# Workers (GPU inference):
#   ccx13 — 2 vCPU,  8GB RAM  (CPU-only, BitNet 1-bit models)
#   ccx33 — 8 vCPU, 32GB RAM  (general inference)
#   ccx53 — 16 vCPU, 64GB RAM (large models, multi-GPU)
#
# For dedicated GPU servers, use Hetzner's dedicated range or
# attach to bare-metal via the Ansible playbook instead.
# -----------------------------------------------------------------------------

variable "gateway_type" {
  description = "Hetzner server type for the gateway (coordinator)"
  type        = string
  default     = "cx22"
}

variable "worker_type" {
  description = "Hetzner server type for worker nodes (inference)"
  type        = string
  default     = "ccx33"
}

variable "worker_count" {
  description = "Number of worker nodes to deploy"
  type        = number
  default     = 3

  validation {
    condition     = var.worker_count >= 1 && var.worker_count <= 50
    error_message = "Worker count must be between 1 and 50."
  }
}

# -----------------------------------------------------------------------------
# Location
# -----------------------------------------------------------------------------
# Hetzner locations:
#   fsn1 — Falkenstein, Germany (default, good EU latency)
#   nbg1 — Nuremberg, Germany
#   hel1 — Helsinki, Finland
#   ash  — Ashburn, Virginia, USA
#   hil  — Hillsboro, Oregon, USA
# -----------------------------------------------------------------------------

variable "location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "fsn1"

  validation {
    condition     = contains(["fsn1", "nbg1", "hel1", "ash", "hil"], var.location)
    error_message = "Location must be a valid Hetzner datacenter: fsn1, nbg1, hel1, ash, hil."
  }
}

# -----------------------------------------------------------------------------
# OS Image
# -----------------------------------------------------------------------------

variable "os_image" {
  description = "Base OS image for servers (Ubuntu 24.04 recommended)"
  type        = string
  default     = "ubuntu-24.04"
}

# -----------------------------------------------------------------------------
# Networking & Security
# -----------------------------------------------------------------------------

variable "ssh_allowed_ips" {
  description = "CIDR blocks allowed to SSH into servers. Restrict to your IP for security."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
  # SECURITY: In production, restrict this to your IP:
  # default = ["203.0.113.50/32"]
}

variable "gateway_domain" {
  description = "Domain name for the gateway (used for TLS certificate). Leave empty to skip TLS."
  type        = string
  default     = ""
}

variable "acme_email" {
  description = "Email for Let's Encrypt TLS certificate registration"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------

variable "pg_password" {
  description = "PostgreSQL password for the TentaCLAW database"
  type        = string
  sensitive   = true
  default     = ""
  # If empty, cloud-init generates a random password
}

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------

variable "gateway_volume_size" {
  description = "Size of the persistent volume for gateway data (GB)"
  type        = number
  default     = 50

  validation {
    condition     = var.gateway_volume_size >= 10 && var.gateway_volume_size <= 10000
    error_message = "Volume size must be between 10 and 10000 GB."
  }
}
