# =============================================================================
# TentaCLAW OS -- Terraform Outputs (Hetzner Cloud)
# =============================================================================
#
# After `terraform apply`, these values are printed and queryable:
#   terraform output gateway_ip
#   terraform output -json worker_ips
#   terraform output dashboard_url
#
# CLAWtopus says: "Output everything. Hide nothing. Octopuses are transparent."
# =============================================================================

# -----------------------------------------------------------------------------
# Gateway
# -----------------------------------------------------------------------------

output "gateway_ip" {
  description = "Public IPv4 address of the TentaCLAW gateway"
  value       = hcloud_server.gateway.ipv4_address
}

output "gateway_ipv6" {
  description = "Public IPv6 address of the TentaCLAW gateway"
  value       = hcloud_server.gateway.ipv6_address
}

output "gateway_private_ip" {
  description = "Private IP of the gateway on the cluster network"
  value       = hcloud_server_network.gateway.ip
}

output "gateway_status" {
  description = "Current status of the gateway server"
  value       = hcloud_server.gateway.status
}

# -----------------------------------------------------------------------------
# Workers
# -----------------------------------------------------------------------------

output "worker_ips" {
  description = "Public IPv4 addresses of all worker nodes"
  value       = [for s in hcloud_server.worker : s.ipv4_address]
}

output "worker_private_ips" {
  description = "Private IPs of all workers on the cluster network"
  value       = [for s in hcloud_server_network.worker : s.ip]
}

output "worker_names" {
  description = "Names of all worker servers"
  value       = [for s in hcloud_server.worker : s.name]
}

output "worker_statuses" {
  description = "Current status of each worker server"
  value       = { for s in hcloud_server.worker : s.name => s.status }
}

# -----------------------------------------------------------------------------
# URLs & Connection Info
# -----------------------------------------------------------------------------

output "dashboard_url" {
  description = "URL to access the TentaCLAW dashboard"
  value       = var.gateway_domain != "" ? "https://${var.gateway_domain}/dashboard/" : "http://${hcloud_server.gateway.ipv4_address}:8080/dashboard/"
}

output "api_url" {
  description = "Base URL for the TentaCLAW REST API"
  value       = var.gateway_domain != "" ? "https://${var.gateway_domain}/api/v1" : "http://${hcloud_server.gateway.ipv4_address}:8080/api/v1"
}

output "openai_compat_url" {
  description = "OpenAI-compatible API endpoint (point your LLM client here)"
  value       = var.gateway_domain != "" ? "https://${var.gateway_domain}/v1" : "http://${hcloud_server.gateway.ipv4_address}:8080/v1"
}

output "grafana_url" {
  description = "Grafana observability dashboard URL"
  value       = "http://${hcloud_server.gateway.ipv4_address}:3000"
}

output "prometheus_url" {
  description = "Prometheus metrics endpoint (cluster-internal)"
  value       = "http://${hcloud_server_network.gateway.ip}:9090"
}

# -----------------------------------------------------------------------------
# SSH Commands (convenience)
# -----------------------------------------------------------------------------

output "ssh_gateway" {
  description = "SSH command to connect to the gateway"
  value       = "ssh root@${hcloud_server.gateway.ipv4_address}"
}

output "ssh_workers" {
  description = "SSH commands to connect to each worker"
  value       = { for s in hcloud_server.worker : s.name => "ssh root@${s.ipv4_address}" }
}

# -----------------------------------------------------------------------------
# Network
# -----------------------------------------------------------------------------

output "network_id" {
  description = "Hetzner network ID for the cluster private network"
  value       = hcloud_network.tentaclaw.id
}

output "network_ip_range" {
  description = "IP range of the cluster private network"
  value       = hcloud_network.tentaclaw.ip_range
}

# -----------------------------------------------------------------------------
# Cluster Summary
# -----------------------------------------------------------------------------

output "cluster_summary" {
  description = "Quick overview of the deployed TentaCLAW cluster"
  value = {
    cluster_name = var.cluster_name
    environment  = var.environment
    location     = var.location
    gateway      = "${var.gateway_type} @ ${hcloud_server.gateway.ipv4_address}"
    workers      = "${var.worker_count}x ${var.worker_type}"
    dashboard    = var.gateway_domain != "" ? "https://${var.gateway_domain}/dashboard/" : "http://${hcloud_server.gateway.ipv4_address}:8080/dashboard/"
    api          = var.gateway_domain != "" ? "https://${var.gateway_domain}/v1" : "http://${hcloud_server.gateway.ipv4_address}:8080/v1"
  }
}
