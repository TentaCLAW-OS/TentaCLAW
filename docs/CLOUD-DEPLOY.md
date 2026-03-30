# TentaCLAW OS -- Cloud Deployment Guide

Comprehensive guide for deploying TentaCLAW on cloud infrastructure. Covers all
supported providers, cost estimates, security practices, and hybrid architectures.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [AWS Deployment](#aws-deployment)
- [Hetzner Deployment](#hetzner-deployment)
- [Vultr Deployment](#vultr-deployment)
- [RunPod Deployment](#runpod-deployment)
- [Lambda Labs Deployment](#lambda-labs-deployment)
- [Hybrid Deployment](#hybrid-deployment)
- [Security Best Practices](#security-best-practices)
- [Cost Comparison](#cost-comparison)
- [Monitoring & Observability](#monitoring--observability)
- [Scaling](#scaling)
- [Troubleshooting](#troubleshooting)

---

## Overview

TentaCLAW is designed as a distributed AI inference cluster. A typical deployment
consists of:

- **1x Gateway**: Coordinator node running the API, dashboard, job scheduler,
  Prometheus, and Grafana. Does not need a GPU.
- **Nx Workers**: GPU-equipped nodes running Ollama and the TentaCLAW agent.
  Each worker registers with the gateway and accepts inference requests.

```
            Internet
               |
          [Load Balancer]      (ALB on AWS, or Nginx on gateway)
               |
        +------+------+
        |   Gateway   |       t3.medium / cx22 / any 2+ vCPU server
        |  :8080 API  |       PostgreSQL, Prometheus, Grafana, Nginx
        +------+------+
               |  Private Network
       +-------+-------+-------+
       |       |       |       |
   [Worker] [Worker] [Worker] ...
   GPU+Ollama GPU+Ollama GPU+Ollama
   Agent      Agent      Agent
```

Workers are stateless. They can be added, removed, or replaced at any time.
The gateway handles discovery, load balancing, and health monitoring.

---

## Prerequisites

Before deploying to any cloud provider:

1. **Terraform** >= 1.5.0 installed ([download](https://www.terraform.io/downloads))
2. **Git** installed
3. **SSH key pair** generated (`ssh-keygen -t ed25519`)
4. Cloud provider account with payment method configured
5. **Domain name** (optional, for TLS)

```bash
# Verify Terraform
terraform --version

# Clone TentaCLAW
git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git
cd tentaclaw-os
```

---

## AWS Deployment

AWS offers the broadest GPU selection and enterprise features (IAM, VPC,
CloudWatch, autoscaling, compliance certifications).

### Architecture

```
                  Internet
                     |
              [Application LB]     (2 AZs, health checks)
                     |
        +------------+------------+
        |         VPC             |
        |  +------------------+   |
        |  | Public Subnet    |   |  NAT Gateway, ALB
        |  +------------------+   |
        |  +------------------+   |
        |  | Private Subnet   |   |  Gateway + Workers
        |  |  gw: 10.0.10.10 |   |
        |  |  w1: 10.0.10.x  |   |
        |  |  w2: 10.0.10.x  |   |
        |  +------------------+   |
        +-------------------------+
```

### Quick Start

```bash
cd deploy/terraform/aws

# Option A: Environment variables (recommended for CI/CD)
export AWS_PROFILE=my-profile  # or set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
export TF_VAR_ssh_key_name="my-key"

# Option B: terraform.tfvars file
cat > terraform.tfvars << 'EOF'
ssh_key_name          = "my-aws-key"
aws_region            = "us-east-1"
cluster_name          = "tentaclaw-prod"
environment           = "production"

# Instances
gateway_instance_type = "t3.medium"
worker_instance_type  = "g5.xlarge"
worker_count          = 2

# Storage
gateway_volume_size   = 50
worker_volume_size    = 100
enable_s3_model_storage = true

# Security (IMPORTANT: restrict to your IP)
ssh_allowed_cidrs     = ["YOUR.IP.HERE/32"]
EOF

# Deploy
terraform init
terraform plan    # Review changes
terraform apply   # Confirm with 'yes'

# Get your endpoints
terraform output dashboard_url
terraform output alb_dns
terraform output cluster_summary
```

### AWS GPU Instance Selection Guide

Choose based on model size and budget:

| Model Size | Recommended Instance | VRAM | Why |
|-----------|---------------------|------|-----|
| 1-3B params (Phi-3, Qwen 1.5B) | g5.xlarge | 24 GB A10G | Overkill but fast |
| 7-13B params (Llama 3, Mistral) | g5.xlarge | 24 GB A10G | Sweet spot |
| 30-34B params (CodeLlama 34B) | g5.2xlarge | 24 GB A10G | Needs more CPU/RAM |
| 70B params (Llama 3 70B) | g5.12xlarge | 96 GB (4x A10G) | Multi-GPU required |
| 70B+ or multi-model | p4d.24xlarge | 320 GB (8x A100) | Enterprise scale |

### AWS Cost Estimates

| Configuration | Monthly On-Demand | Monthly Spot (est.) |
|---------------|-------------------|---------------------|
| 1 gw (t3.medium) + 1 worker (g5.xlarge) | ~$760 | ~$290 |
| 1 gw (t3.medium) + 2 workers (g5.xlarge) | ~$1,490 | ~$560 |
| 1 gw (t3.medium) + 4 workers (g5.xlarge) | ~$2,950 | ~$1,060 |
| 1 gw (t3.large) + 2 workers (g5.12xlarge) | ~$8,200 | ~$3,000 |
| NAT Gateway | ~$32 + data | ~$32 + data |
| ALB | ~$16 + data | ~$16 + data |
| S3 (100 GB models) | ~$2.30 | ~$2.30 |
| CloudWatch Logs | ~$5-20 | ~$5-20 |

### Scaling on AWS

```bash
# Add more workers
terraform apply -var="worker_count=4"

# Upgrade worker GPU
terraform apply -var="worker_instance_type=g5.2xlarge"

# Remove workers (scale down)
terraform apply -var="worker_count=1"
```

### Teardown

```bash
# Destroy everything
terraform destroy

# Destroy workers only (keep gateway)
terraform destroy -target='aws_instance.worker'
```

---

## Hetzner Deployment

Hetzner offers the cheapest cloud servers in the industry. No GPU cloud instances,
but excellent for gateway nodes and CPU-based inference (BitNet 1-bit models).

### Quick Start

```bash
cd deploy/terraform  # Root terraform dir (Hetzner module)

export TF_VAR_hcloud_token="your-hetzner-api-token"
export TF_VAR_ssh_key_name="my-key"

terraform init
terraform plan
terraform apply
```

### Cost Estimates

| Configuration | Monthly |
|---------------|---------|
| 1 gw (cx22) + 3 workers (ccx33) | ~141 EUR |
| 1 gw (cx22) + 5 workers (ccx33) | ~229 EUR |
| 1 gw (cx32) + 3 workers (ccx53) | ~278 EUR |
| Volume (50 GB) | ~2 EUR |
| Network | Free |

See `deploy/terraform/README.md` for full Hetzner documentation.

---

## Vultr Deployment

Vultr offers GPU cloud instances with a simple API and no lock-in.

### Manual Setup

```bash
# 1. Create a GPU instance via Vultr dashboard or CLI
#    Region: EWR (New Jersey) or LAX (Los Angeles)
#    Plan: vcg-a100-1c-12g-80vram (1x A100 80GB)
#    OS: Ubuntu 24.04

# 2. SSH into the instance
ssh root@YOUR_VULTR_IP

# 3. Install TentaCLAW
curl -fsSL https://ollama.com/install.sh | sh

git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git /opt/tentaclaw-os
cd /opt/tentaclaw-os/agent
npm ci --omit=dev && npm run build

# 4. Configure agent
mkdir -p /etc/tentaclaw
cat > /etc/tentaclaw/rig.conf << EOF
GATEWAY_URL=http://YOUR_GATEWAY_IP:8080
FARM_HASH=your-cluster-name
NODE_ID=$(hostname)
NODE_HOSTNAME=$(hostname)
EOF

# 5. Create systemd service
cat > /etc/systemd/system/tentaclaw-agent.service << 'EOF'
[Unit]
Description=TentaCLAW Agent
After=network-online.target ollama.service

[Service]
Type=simple
WorkingDirectory=/opt/tentaclaw-os/agent
Environment=TENTACLAW_GATEWAY_URL=http://YOUR_GATEWAY_IP:8080
ExecStart=/usr/bin/node dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable tentaclaw-agent
systemctl start tentaclaw-agent
```

### Cost Estimates

| Plan | GPU | Monthly |
|------|-----|---------|
| vcg-a16-1c-6g-16vram | 1x A16 (16 GB) | ~$470 |
| vcg-a100-1c-12g-80vram | 1x A100 (80 GB) | ~$1,840 |

---

## RunPod Deployment

RunPod specializes in GPU compute with pay-per-second billing and spot pricing.

### On-Demand Pods

```bash
# Create a TentaCLAW worker pod
runpod pod create \
  --name "tentaclaw-worker-01" \
  --gpu-type "NVIDIA A100 80GB" \
  --gpu-count 1 \
  --image "ubuntu:24.04" \
  --volume-size 50 \
  --ports "11434/http,9100/http" \
  --env "TENTACLAW_GATEWAY_URL=http://YOUR_GATEWAY:8080" \
  --env "TENTACLAW_FARM_HASH=your-cluster"
```

### Setup Inside the Pod

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Install Node.js and TentaCLAW
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git

git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git /opt/tentaclaw-os
cd /opt/tentaclaw-os/agent
npm ci --omit=dev && npm run build

# Start agent
TENTACLAW_GATEWAY_URL=http://YOUR_GATEWAY:8080 \
TENTACLAW_FARM_HASH=your-cluster \
node dist/index.js
```

### Cost Estimates

| GPU | On-Demand $/hr | Spot $/hr | Monthly On-Demand | Monthly Spot |
|-----|----------------|-----------|-------------------|--------------|
| RTX 4090 (24 GB) | $0.69 | $0.39 | ~$500 | ~$281 |
| A100 80GB | $1.64 | $0.89 | ~$1,181 | ~$641 |
| H100 SXM (80 GB) | $3.89 | $2.49 | ~$2,801 | ~$1,793 |

---

## Lambda Labs Deployment

Lambda Labs offers on-demand GPU instances with pre-installed NVIDIA drivers
and CUDA stack. No driver installation needed.

### Quick Start

```bash
# Create instance via API
curl -X POST https://cloud.lambdalabs.com/api/v1/instance-operations/launch \
  -H "Authorization: Bearer $LAMBDA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "region_name": "us-east-1",
    "instance_type_name": "gpu_1x_a100_sxm4",
    "ssh_key_names": ["my-key"],
    "name": "tentaclaw-worker-01"
  }'

# SSH in (NVIDIA drivers pre-installed)
ssh ubuntu@LAMBDA_IP

# Verify GPU
nvidia-smi

# Install TentaCLAW
curl -fsSL https://ollama.com/install.sh | sh
git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git /opt/tentaclaw-os
cd /opt/tentaclaw-os/agent && npm ci --omit=dev && npm run build

# Run agent
TENTACLAW_GATEWAY_URL=http://YOUR_GATEWAY:8080 node dist/index.js
```

### Cost Estimates

| Instance | GPU | $/hr | Monthly |
|----------|-----|------|---------|
| gpu_1x_a100 | 1x A100 40GB | $1.10 | ~$792 |
| gpu_1x_a100_sxm4 | 1x A100 80GB | $1.29 | ~$929 |
| gpu_1x_h100_sxm5 | 1x H100 80GB | $2.49 | ~$1,793 |
| gpu_8x_a100 | 8x A100 80GB | $8.80 | ~$6,336 |

---

## Hybrid Deployment

The recommended production architecture: self-hosted gateway + cloud GPU workers.

### Why Hybrid?

1. **Gateway is cheap**: Runs on any 2+ vCPU server. Keep it on-prem or on Hetzner (~$4/mo).
2. **Data sovereignty**: Your API keys, logs, and metadata stay on your infrastructure.
3. **Burst scaling**: Spin up cloud GPUs only when needed, shut down when idle.
4. **Multi-provider**: Use the cheapest GPU available across providers.

### Architecture

```
  Your Infrastructure                    Cloud Providers
  +--------------------+         +---------------------------+
  |  Gateway           |  VPN    |  Permanent Workers        |
  |  (Hetzner / Home)  |<------->|  Lambda Labs 1x A100      |
  |  :8080 API         |         |  Agent + Ollama           |
  |  :3000 Grafana     |         +---------------------------+
  |  :9090 Prometheus  |         +---------------------------+
  +--------------------+  VPN    |  Burst Workers            |
                         <------->|  RunPod Spot 4090s        |
                                 |  (auto-scale on demand)   |
                                 +---------------------------+
```

### Step-by-Step Hybrid Setup

**1. Deploy the gateway** (Hetzner or homelab):

```bash
# Option A: Hetzner (recommended)
cd deploy/terraform
terraform apply -var="worker_count=0"  # Gateway only

# Option B: Homelab
docker compose up gateway
```

**2. Set up WireGuard VPN** for cloud-to-gateway connectivity:

```bash
# On the gateway
apt-get install -y wireguard
wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey

cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.100.0.1/24
ListenPort = 51820
PrivateKey = $(cat /etc/wireguard/privatekey)
EOF

systemctl enable wg-quick@wg0 && systemctl start wg-quick@wg0
```

**3. Add cloud workers** and connect via VPN:

```bash
# On each cloud worker
apt-get install -y wireguard
wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey

# Add peer on gateway
wg set wg0 peer WORKER_PUBLIC_KEY allowed-ips 10.100.0.2/32

# Configure worker VPN
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.100.0.2/24
PrivateKey = $(cat /etc/wireguard/privatekey)

[Peer]
PublicKey = GATEWAY_PUBLIC_KEY
Endpoint = GATEWAY_PUBLIC_IP:51820
AllowedIPs = 10.100.0.0/24
PersistentKeepalive = 25
EOF

systemctl enable wg-quick@wg0 && systemctl start wg-quick@wg0

# Configure TentaCLAW agent to use VPN
echo "GATEWAY_URL=http://10.100.0.1:8080" >> /etc/tentaclaw/rig.conf
```

---

## Security Best Practices

### Credentials

- **Never hardcode secrets** in Terraform files or user data scripts
- Use **IAM roles** (AWS) or **API tokens via environment variables** (Hetzner)
- Store Terraform state encrypted (S3 backend with encryption, or Terraform Cloud)
- Use `sensitive = true` for all secret variables
- Rotate API tokens and passwords regularly

### Network

- **Restrict SSH** to your IP address in production (`ssh_allowed_cidrs`)
- Workers should **not** be directly accessible from the internet
- Use **private subnets** (AWS) or **private networks** (Hetzner) for inter-node traffic
- Ollama (port 11434) should only be accessible from the gateway
- Use **WireGuard** for hybrid/cross-provider networking

### Instance Hardening

- **IMDSv2** enforced on all AWS instances (prevents SSRF credential theft)
- **fail2ban** enabled on all nodes (brute-force protection)
- **UFW/security groups** with deny-by-default
- **Encrypted root volumes** (AWS: EBS encryption, Hetzner: LUKS optional)
- **No root SSH login** with passwords (key-only)
- **Systemd hardening**: `NoNewPrivileges`, `ProtectSystem`, `PrivateTmp`

### TLS

- Use **Let's Encrypt** (free) via certbot for Hetzner/bare-metal
- Use **AWS Certificate Manager** (free) for ALB-terminated TLS on AWS
- Always redirect HTTP to HTTPS in production
- Enable **HSTS** headers

### Secrets Management

```bash
# Option 1: Environment variables (simple)
export TF_VAR_hcloud_token="your-token"

# Option 2: HashiCorp Vault (enterprise)
export VAULT_ADDR="https://vault.example.com"
vault kv get -field=token secret/tentaclaw/hetzner

# Option 3: AWS Secrets Manager
aws secretsmanager get-secret-value --secret-id tentaclaw/db-password

# Option 4: 1Password CLI
op read "op://Infrastructure/Hetzner/api-token"
```

---

## Cost Comparison

### Monthly cost for a 2-GPU-worker cluster

| Provider | Gateway | 2x GPU Workers | Total | Notes |
|----------|---------|----------------|-------|-------|
| Hetzner (CPU only) | $4 | $98 (ccx33, no GPU) | **$102** | BitNet/CPU models only |
| AWS On-Demand | $30 | $1,450 (g5.xlarge) | **$1,480** | Enterprise features |
| AWS Spot | $30 | $500 (g5.xlarge) | **$530** | Risk of interruption |
| Vultr | $30 | $3,680 (A100) | **$3,710** | Simple but expensive |
| RunPod On-Demand | $4 (Hetzner gw) | $2,362 (A100) | **$2,366** | Pay-per-second |
| RunPod Spot | $4 (Hetzner gw) | $1,282 (A100) | **$1,286** | Best cloud GPU value |
| Lambda Labs | $4 (Hetzner gw) | $1,858 (A100 80GB) | **$1,862** | Pre-installed drivers |
| Hybrid (home gw + RunPod 4090 spot) | $0 | $562 | **$562** | Best overall value |

### Break-even: Cloud vs Buying GPUs

| GPU | Cloud Cost/Month (cheapest) | Buy Price | Break-even |
|-----|----------------------------|-----------|------------|
| RTX 4090 | ~$281 (RunPod spot) | ~$1,600 | ~6 months |
| A100 80GB | ~$641 (RunPod spot) | ~$15,000 | ~23 months |
| H100 SXM | ~$1,793 (RunPod spot) | ~$30,000 | ~17 months |

> If you plan to run inference 24/7 for more than 6 months, buying GPUs and
> running TentaCLAW on bare metal is significantly cheaper.

---

## Monitoring & Observability

All TentaCLAW deployments include Prometheus and Grafana on the gateway.

### Accessing Metrics

```bash
# Grafana (default: admin/admin)
open http://GATEWAY_IP:3000

# Prometheus
open http://GATEWAY_IP:9090

# TentaCLAW API metrics
curl http://GATEWAY_IP:8080/metrics
```

### Key Metrics to Watch

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `tentaclaw_active_workers` | Number of connected workers | < expected count |
| `tentaclaw_queue_depth` | Pending inference requests | > 50 (scale up) |
| `tentaclaw_inference_duration_seconds` | Request latency | p99 > 30s |
| `node_gpu_temperature_celsius` | GPU temperature | > 85C |
| `node_gpu_utilization_percent` | GPU utilization | < 10% (scale down) |

### AWS CloudWatch Integration

The AWS Terraform module automatically configures CloudWatch agent to forward
gateway and agent logs. View them at:

```
AWS Console > CloudWatch > Log Groups > /tentaclaw/CLUSTER_NAME
```

---

## Scaling

### Horizontal Scaling (add workers)

```bash
# Terraform (AWS or Hetzner)
terraform apply -var="worker_count=5"

# Manual (any provider)
# Just deploy a new worker and point it at your gateway
TENTACLAW_GATEWAY_URL=http://GATEWAY_IP:8080 node dist/index.js
```

### Vertical Scaling (bigger GPUs)

```bash
# AWS: upgrade instance type
terraform apply -var="worker_instance_type=g5.12xlarge"

# Note: this destroys and recreates workers (stateless, so safe)
```

### Auto-Scaling (AWS)

For automatic scaling based on queue depth, consider wrapping workers in an
Auto Scaling Group with a custom CloudWatch metric:

```hcl
# Example: Auto Scaling Group for workers (add to main.tf)
# resource "aws_autoscaling_group" "workers" {
#   desired_capacity = 2
#   max_size         = 10
#   min_size         = 1
#   ...
# }
```

---

## Troubleshooting

### Worker not connecting to gateway

```bash
# On the worker, check agent logs
journalctl -u tentaclaw-agent -f

# Verify gateway is reachable
curl http://GATEWAY_IP:8080/health

# Check firewall rules
ufw status
# Or on AWS: check security group inbound rules
```

### GPU not detected by Ollama

```bash
# Check NVIDIA drivers
nvidia-smi

# If not found, install drivers
ubuntu-drivers autoinstall
reboot

# Verify Ollama sees the GPU
ollama run qwen2.5:1.5b "test"
```

### Terraform state issues

```bash
# Refresh state from actual infrastructure
terraform refresh

# Import an existing resource
terraform import aws_instance.gateway i-1234567890abcdef0

# Unlock state (if locked by failed operation)
terraform force-unlock LOCK_ID
```

### High latency

1. Check if GPU is thermal-throttling: `nvidia-smi -q -d TEMPERATURE`
2. Verify model fits in VRAM (quantize if needed)
3. Check network latency between gateway and workers: `ping WORKER_IP`
4. Consider moving workers closer to users geographically

### Cloud-init / user data not running

```bash
# Check cloud-init logs
cat /var/log/cloud-init-output.log
cat /var/log/tentaclaw-setup.log

# Re-run cloud-init (careful: may duplicate setup)
cloud-init clean
cloud-init init
```

---

## Further Reading

- [Multi-Cloud Provider Guide](../deploy/terraform/multicloud/README.md) -- Provider comparison and hybrid setup
- [AWS Terraform Module](../deploy/terraform/aws/) -- Full AWS module with ALB, IAM, S3
- [Hetzner Terraform Module](../deploy/terraform/) -- Full Hetzner module
- [Performance Tuning](./PERFORMANCE.md) -- Optimize inference throughput
- [Security Guide](./SECURITY.md) -- Hardening and compliance
- [Troubleshooting](./TROUBLESHOOTING.md) -- Common issues and fixes
