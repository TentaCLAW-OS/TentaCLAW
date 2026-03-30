# TentaCLAW OS -- Terraform Deployment (Hetzner Cloud)

Deploy a production TentaCLAW AI inference cluster on Hetzner Cloud with a single `terraform apply`.

## Architecture

```
                     Internet
                        |
                   [Hetzner FW]
                        |
              +-------------------+
              |  Gateway (cx22)   |  <-- Nginx + TLS + Dashboard + API
              |  10.0.1.10        |  <-- PostgreSQL + Prometheus + Grafana
              +-------------------+
                   |  Private Network (10.0.1.0/24)
          +--------+--------+--------+
          |        |        |        |
      [Worker]  [Worker]  [Worker]  ...
      10.0.1.20 10.0.1.21 10.0.1.22
      Ollama    Ollama    Ollama
      Agent     Agent     Agent
```

## What Gets Deployed

| Component | Server | Details |
|-----------|--------|---------|
| **Gateway** | 1x `cx22` | TentaCLAW Gateway, PostgreSQL, Nginx, Prometheus, Grafana |
| **Workers** | Nx `ccx33` | TentaCLAW Agent, Ollama, GPU drivers (auto-detected), node_exporter |
| **Network** | Private | 10.0.0.0/16 for cluster communication |
| **Firewall** | Per-role | Gateway: 22, 80, 443, 8080, 3000. Workers: 22, 11434, 41337 (internal) |
| **Volume** | 50 GB | Persistent storage for gateway data |

## Prerequisites

1. A [Hetzner Cloud](https://console.hetzner.cloud/) account
2. An API token (Settings > API Tokens > Generate)
3. An SSH key uploaded to Hetzner Cloud (Security > SSH Keys)
4. [Terraform](https://www.terraform.io/downloads) >= 1.5.0 installed locally

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git
cd tentaclaw-os/deploy/terraform

# 2. Initialize Terraform
terraform init

# 3. Set your credentials
export TF_VAR_hcloud_token="your-hetzner-api-token"
export TF_VAR_ssh_key_name="your-ssh-key-name"

# 4. Preview the deployment
terraform plan

# 5. Deploy
terraform apply
```

## Configuration

### Using terraform.tfvars (recommended)

Create a `terraform.tfvars` file:

```hcl
hcloud_token  = "your-hetzner-api-token"
ssh_key_name  = "my-ssh-key"

# Cluster settings
cluster_name  = "tentaclaw-prod"
environment   = "production"
worker_count  = 3
location      = "fsn1"

# Server types
gateway_type  = "cx22"   # 2 vCPU, 4GB RAM
worker_type   = "ccx33"  # 8 vCPU, 32GB RAM

# Optional: TLS
gateway_domain = "cluster.example.com"
acme_email     = "admin@example.com"

# Optional: PostgreSQL (auto-generated if empty)
pg_password = ""

# Security: restrict SSH to your IP
ssh_allowed_ips = ["203.0.113.50/32"]
```

### Using environment variables

```bash
export TF_VAR_hcloud_token="your-token"
export TF_VAR_ssh_key_name="my-key"
export TF_VAR_worker_count=5
export TF_VAR_location="ash"
```

## Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `hcloud_token` | Yes | - | Hetzner Cloud API token |
| `ssh_key_name` | Yes | - | SSH key name in Hetzner console |
| `cluster_name` | No | `tentaclaw` | Name prefix for all resources |
| `environment` | No | `production` | Environment tag (dev/staging/production) |
| `gateway_type` | No | `cx22` | Server type for gateway |
| `worker_type` | No | `ccx33` | Server type for workers |
| `worker_count` | No | `3` | Number of worker nodes (1-50) |
| `location` | No | `fsn1` | Datacenter (fsn1/nbg1/hel1/ash/hil) |
| `os_image` | No | `ubuntu-24.04` | Base OS image |
| `ssh_allowed_ips` | No | `["0.0.0.0/0"]` | CIDR blocks for SSH access |
| `gateway_domain` | No | `""` | Domain for TLS (empty = no TLS) |
| `acme_email` | No | `""` | Email for Let's Encrypt |
| `pg_password` | No | `""` | PostgreSQL password (auto-generated if empty) |
| `gateway_volume_size` | No | `50` | Persistent volume size in GB |

## Outputs

After `terraform apply`, useful outputs are available:

```bash
# Get the gateway IP
terraform output gateway_ip

# Get all worker IPs
terraform output -json worker_ips

# Get the dashboard URL
terraform output dashboard_url

# Get SSH commands
terraform output ssh_gateway
terraform output -json ssh_workers

# Full cluster summary
terraform output cluster_summary
```

## Post-Deployment

### Verify the cluster

```bash
# SSH into the gateway
ssh root@$(terraform output -raw gateway_ip)

# Check services
systemctl status tentaclaw-gateway
systemctl status nginx
systemctl status postgresql
systemctl status prometheus
systemctl status grafana-server

# Check agent connectivity
curl http://localhost:8080/api/v1/nodes
```

### Access the dashboard

```bash
# Via direct IP
open http://$(terraform output -raw gateway_ip):8080/dashboard/

# Or via domain (if TLS configured)
open $(terraform output -raw dashboard_url)
```

### Access Grafana

```bash
open http://$(terraform output -raw gateway_ip):3000
# Default: admin / admin (change on first login)
```

## Scaling

```bash
# Scale up: add more workers
terraform apply -var="worker_count=5"

# Scale down: reduce workers (last ones are destroyed)
terraform apply -var="worker_count=2"

# Upgrade server type
terraform apply -var="worker_type=ccx53"
```

## Teardown

```bash
# Destroy everything
terraform destroy

# Or destroy workers only (keep gateway)
terraform destroy -target='hcloud_server.worker'
```

## Security Notes

- Restrict `ssh_allowed_ips` to your IP in production
- PostgreSQL only listens on localhost
- Worker Ollama ports (11434) are only accessible via private network
- The gateway firewall blocks all traffic except SSH, HTTP, HTTPS, and internal metrics
- All cloud-init scripts run fail2ban for brute-force protection
- TLS is handled by certbot with auto-renewal

## Cost Estimate (Hetzner Cloud)

| Component | Type | Monthly Cost (approx) |
|-----------|------|-----------------------|
| Gateway | cx22 | ~4 EUR |
| Worker x3 | ccx33 | ~45 EUR each |
| Volume 50GB | - | ~2 EUR |
| Network | - | Free |
| **Total (3 workers)** | | **~141 EUR/month** |

Prices as of 2025. Check [hetzner.com/cloud](https://www.hetzner.com/cloud) for current pricing.
