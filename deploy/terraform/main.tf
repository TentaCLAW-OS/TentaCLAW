# =============================================================================
# TentaCLAW OS -- Hetzner Cloud Terraform Deployment
# =============================================================================
#
# Deploys a production TentaCLAW inference cluster on Hetzner Cloud:
#   - 1x Gateway server (coordinator, dashboard, API, Postgres, monitoring)
#   - Nx Worker servers (GPU inference agents with Ollama)
#   - Firewall rules (HTTP 8080, UDP 41337 discovery, SSH 22, HTTPS 443)
#   - Private network for secure inter-node communication
#   - Persistent volume for gateway data
#   - Cloud-init for fully automated TentaCLAW installation
#
# Usage:
#   cp terraform.tfvars.example terraform.tfvars
#   # Edit terraform.tfvars with your values
#   terraform init
#   terraform plan
#   terraform apply
#
# Or with environment variables:
#   export TF_VAR_hcloud_token="your-token-here"
#   export TF_VAR_ssh_key_name="my-key"
#   terraform init && terraform apply
#
# TentaCLAW says: "Eight arms in the cloud. Still self-hosted."
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

# =============================================================================
# Data Sources
# =============================================================================

# Look up the SSH key by name (must already exist in Hetzner console)
data "hcloud_ssh_key" "deploy" {
  name = var.ssh_key_name
}

# =============================================================================
# Networking -- Private Network for Cluster Communication
# =============================================================================

resource "hcloud_network" "tentaclaw" {
  name     = "${var.cluster_name}-network"
  ip_range = "10.0.0.0/16"

  labels = local.common_labels
}

resource "hcloud_network_subnet" "tentaclaw" {
  network_id   = hcloud_network.tentaclaw.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.1.0/24"
}

# =============================================================================
# Firewall -- Gateway (public-facing)
# =============================================================================

resource "hcloud_firewall" "gateway" {
  name = "${var.cluster_name}-gateway-fw"

  # SSH access
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_ips
  }

  # Gateway HTTP API + Dashboard (port 8080)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "8080"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS via Nginx reverse proxy
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTP for Let's Encrypt ACME challenge
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # UDP auto-discovery (port 41337, cluster-internal only)
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "41337"
    source_ips = ["10.0.0.0/16"]
  }

  # Grafana (optional, restrict to admin IPs)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "3000"
    source_ips = var.ssh_allowed_ips
  }

  # Prometheus (cluster-internal only)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "9090"
    source_ips = ["10.0.0.0/16"]
  }

  labels = local.common_labels
}

# =============================================================================
# Firewall -- Workers (cluster-internal)
# =============================================================================

resource "hcloud_firewall" "worker" {
  name = "${var.cluster_name}-worker-fw"

  # SSH access
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_ips
  }

  # Ollama API (cluster-internal -- gateway proxies requests)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "11434"
    source_ips = ["10.0.0.0/16"]
  }

  # UDP auto-discovery (port 41337)
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "41337"
    source_ips = ["10.0.0.0/16"]
  }

  # Node exporter metrics (cluster-internal)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "9100"
    source_ips = ["10.0.0.0/16"]
  }

  labels = local.common_labels
}

# =============================================================================
# Gateway Server
# =============================================================================

resource "hcloud_server" "gateway" {
  name        = "${var.cluster_name}-gateway"
  image       = var.os_image
  server_type = var.gateway_type
  location    = var.location
  ssh_keys    = [data.hcloud_ssh_key.deploy.id]

  user_data = templatefile("${path.module}/cloud-init-gateway.yaml", {
    cluster_name   = var.cluster_name
    gateway_domain = var.gateway_domain
    pg_password    = var.pg_password
    acme_email     = var.acme_email
    worker_count   = var.worker_count
  })

  firewall_ids = [hcloud_firewall.gateway.id]

  labels = merge(local.common_labels, {
    role = "gateway"
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  lifecycle {
    ignore_changes = [user_data]
  }
}

# Attach gateway to private network with static IP
resource "hcloud_server_network" "gateway" {
  server_id  = hcloud_server.gateway.id
  network_id = hcloud_network.tentaclaw.id
  ip         = "10.0.1.10"
}

# =============================================================================
# Worker Servers (GPU Inference Nodes)
# =============================================================================

resource "hcloud_server" "worker" {
  count = var.worker_count

  name        = "${var.cluster_name}-worker-${format("%02d", count.index + 1)}"
  image       = var.os_image
  server_type = var.worker_type
  location    = var.location
  ssh_keys    = [data.hcloud_ssh_key.deploy.id]

  user_data = templatefile("${path.module}/cloud-init-worker.yaml", {
    cluster_name = var.cluster_name
    gateway_ip   = "10.0.1.10"
    worker_index = count.index + 1
    worker_name  = "${var.cluster_name}-worker-${format("%02d", count.index + 1)}"
  })

  firewall_ids = [hcloud_firewall.worker.id]

  labels = merge(local.common_labels, {
    role         = "worker"
    worker_index = tostring(count.index + 1)
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  depends_on = [
    hcloud_server_network.gateway,
    hcloud_network_subnet.tentaclaw,
  ]

  lifecycle {
    ignore_changes = [user_data]
  }
}

# Attach workers to private network
resource "hcloud_server_network" "worker" {
  count = var.worker_count

  server_id  = hcloud_server.worker[count.index].id
  network_id = hcloud_network.tentaclaw.id
  ip         = "10.0.1.${20 + count.index}"
}

# =============================================================================
# Persistent Volume (gateway data -- Postgres, SQLite, models)
# =============================================================================

resource "hcloud_volume" "gateway_data" {
  name      = "${var.cluster_name}-gateway-data"
  size      = var.gateway_volume_size
  location  = var.location
  format    = "ext4"
  automount = true

  labels = merge(local.common_labels, {
    role = "gateway-data"
  })
}

resource "hcloud_volume_attachment" "gateway_data" {
  volume_id = hcloud_volume.gateway_data.id
  server_id = hcloud_server.gateway.id
  automount = true
}

# =============================================================================
# DNS (optional -- uncomment if using Hetzner DNS)
# =============================================================================

# data "hcloud_dns_zone" "main" {
#   name = var.gateway_domain
# }
#
# resource "hcloud_dns_record" "gateway_a" {
#   zone_id = data.hcloud_dns_zone.main.id
#   name    = "@"
#   type    = "A"
#   value   = hcloud_server.gateway.ipv4_address
#   ttl     = 300
# }
#
# resource "hcloud_dns_record" "gateway_aaaa" {
#   zone_id = data.hcloud_dns_zone.main.id
#   name    = "@"
#   type    = "AAAA"
#   value   = hcloud_server.gateway.ipv6_address
#   ttl     = 300
# }

# =============================================================================
# Local Values
# =============================================================================

locals {
  common_labels = {
    project     = "tentaclaw"
    cluster     = var.cluster_name
    managed_by  = "terraform"
    environment = var.environment
  }
}
