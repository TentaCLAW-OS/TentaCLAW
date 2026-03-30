# TentaCLAW OS -- Multi-Cloud GPU Deployment Guide

TentaCLAW runs anywhere you have compute. This guide covers the best cloud providers
for GPU inference, with cost comparisons, setup instructions, and hybrid strategies.

## Provider Comparison

| Provider | GPU | VRAM | Hourly Cost | Best For |
|----------|-----|------|-------------|----------|
| **Hetzner** | (CPU only) | N/A | ~0.01-0.08 EUR/hr | Gateway nodes, BitNet 1-bit models |
| **AWS** | A10G / A100 / H100 | 24-80 GB | $1.00-32.77/hr | Enterprise, compliance, autoscaling |
| **Vultr** | A100 / A16 | 16-80 GB | $0.65-2.55/hr | Simple API, good mid-tier option |
| **RunPod** | A100 / H100 / 4090 | 24-80 GB | $0.39-3.89/hr | Serverless GPU, pay-per-second |
| **Lambda Labs** | A100 / H100 | 80 GB | $1.10-2.49/hr | On-demand A100/H100, ML-focused |

> Prices as of early 2026. Always verify with provider's current pricing page.

---

## 1. Hetzner Cloud (Cheapest Gateway + CPU Workers)

**Best for**: Gateway nodes, CPU-only inference (BitNet 1-bit models), budget clusters.

Hetzner does not offer GPU cloud instances, but their CPU servers are the cheapest
in the industry and perfect for the TentaCLAW gateway or BitNet inference.

### Terraform Module

TentaCLAW ships a full Hetzner Terraform module at `deploy/terraform/` (root level).

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit with your Hetzner API token
terraform init && terraform apply
```

### Pricing

| Server Type | Specs | Monthly |
|-------------|-------|---------|
| cx22 (gateway) | 2 vCPU, 4 GB RAM | ~4 EUR |
| ccx33 (worker) | 8 vCPU, 32 GB RAM, AMD EPYC | ~45 EUR |
| ccx53 (worker) | 16 vCPU, 64 GB RAM | ~90 EUR |

**3-worker cluster**: ~141 EUR/month (~$155 USD)

### When to Use Hetzner

- Your gateway/coordinator node (always)
- BitNet 1-bit quantized models (CPU inference is viable)
- Development and staging clusters
- Budget-conscious production with CPU-only models

---

## 2. AWS (Enterprise, Autoscaling, Compliance)

**Best for**: Enterprise deployments, regulated industries, autoscaling, global presence.

AWS offers the broadest GPU selection and integrates with the entire AWS ecosystem
(IAM, VPC, CloudWatch, S3 model storage, EKS).

### Terraform Module

TentaCLAW ships a full AWS Terraform module at `deploy/terraform/aws/`.

```bash
cd deploy/terraform/aws
# Set credentials via environment, profile, or IAM role (never hardcode)
export AWS_PROFILE=my-profile

terraform init
terraform plan
terraform apply
```

### GPU Instance Types

| Instance | GPU | VRAM | vCPU | RAM | On-Demand $/hr | Spot $/hr |
|----------|-----|------|------|-----|-----------------|-----------|
| g5.xlarge | 1x A10G | 24 GB | 4 | 16 GB | $1.006 | ~$0.35 |
| g5.2xlarge | 1x A10G | 24 GB | 8 | 32 GB | $1.212 | ~$0.42 |
| g5.4xlarge | 1x A10G | 24 GB | 16 | 64 GB | $1.624 | ~$0.56 |
| g5.12xlarge | 4x A10G | 96 GB | 48 | 192 GB | $5.672 | ~$2.00 |
| p4d.24xlarge | 8x A100 | 320 GB | 96 | 1152 GB | $32.77 | ~$12.00 |
| p5.48xlarge | 8x H100 | 640 GB | 192 | 2048 GB | $98.32 | N/A |

### Cost Optimization

- **Spot Instances**: 60-90% savings for fault-tolerant inference workloads.
  TentaCLAW workers are stateless and can handle interruptions gracefully.
- **Reserved Instances**: 30-60% savings for steady-state production.
- **Savings Plans**: Flexible commitment discounts across instance families.

### Estimated Monthly Costs

| Configuration | On-Demand | Spot (est.) |
|---------------|-----------|-------------|
| 1 gateway (t3.medium) + 2 workers (g5.xlarge) | ~$1,500 | ~$560 |
| 1 gateway (t3.medium) + 4 workers (g5.xlarge) | ~$2,950 | ~$1,060 |
| 1 gateway (m6i.xlarge) + 2 workers (p4d.24xlarge) | ~$47,500 | ~$17,500 |

### When to Use AWS

- Enterprise/regulated environments (HIPAA, SOC2, FedRAMP)
- Need for autoscaling based on inference queue depth
- Integration with existing AWS infrastructure
- Global deployments across multiple regions
- S3-based centralized model storage

---

## 3. Vultr (Simple GPU Cloud)

**Best for**: Simple GPU provisioning, good API, mid-tier pricing.

Vultr offers GPU instances with a straightforward API and no long-term commitments.

### Setup (Manual or API)

```bash
# Install Vultr CLI
curl -sL https://github.com/vultr/vultr-cli/releases/latest/download/vultr-cli_linux_amd64.tar.gz | tar xz

# Create a GPU instance
vultr-cli instance create \
  --region ewr \
  --plan vcg-a100-1c-12g-80vram \
  --os 2284 \
  --label "tentaclaw-worker-01" \
  --ssh-keys "your-ssh-key-id"
```

### Pricing

| Plan | GPU | VRAM | vCPU | RAM | Monthly |
|------|-----|------|------|-----|---------|
| vcg-a16-1c-6g-16vram | 1x A16 | 16 GB | 6 | 16 GB | ~$470 |
| vcg-a100-1c-12g-80vram | 1x A100 | 80 GB | 12 | 120 GB | ~$1,840 |

### TentaCLAW Worker Setup on Vultr

After creating a Vultr instance, SSH in and run:

```bash
# Install TentaCLAW agent
curl -fsSL https://raw.githubusercontent.com/TentaCLAW-OS/tentaclaw-os/master/setup.sh | bash

# Or manual setup
git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git /opt/tentaclaw-os
cd /opt/tentaclaw-os/agent && npm ci --omit=dev && npm run build

# Configure the agent to point at your gateway
cat > /etc/tentaclaw/rig.conf << EOF
GATEWAY_URL=http://YOUR_GATEWAY_IP:8080
FARM_HASH=your-cluster-name
NODE_ID=$(hostname)
EOF

# Start the agent
systemctl enable tentaclaw-agent && systemctl start tentaclaw-agent
```

### When to Use Vultr

- Quick GPU provisioning without AWS complexity
- Good API for programmatic management
- No long-term commitment needed

---

## 4. RunPod (Serverless GPU, Pay-Per-Second)

**Best for**: Burst inference, serverless GPU, pay only for what you use.

RunPod is purpose-built for GPU workloads with serverless and on-demand options.
You pay per second of GPU time, making it ideal for variable workloads.

### Setup

```bash
# Install RunPod CLI
pip install runpod

# Create a GPU pod
runpod pod create \
  --name "tentaclaw-worker-01" \
  --gpu-type "NVIDIA A100 80GB" \
  --gpu-count 1 \
  --image "ubuntu:24.04" \
  --ports "11434/http,9100/http,41337/udp" \
  --env "TENTACLAW_GATEWAY_URL=http://YOUR_GATEWAY:8080" \
  --env "TENTACLAW_FARM_HASH=your-cluster"
```

### Pricing

| GPU | On-Demand $/hr | Spot $/hr | VRAM |
|-----|----------------|-----------|------|
| RTX 4090 | $0.69 | $0.39 | 24 GB |
| A100 80GB | $1.64 | $0.89 | 80 GB |
| H100 SXM | $3.89 | $2.49 | 80 GB |

### RunPod Serverless (Auto-Scale)

For variable workloads, use RunPod's serverless endpoints:

```python
# Deploy a TentaCLAW worker as a serverless endpoint
import runpod

def handler(event):
    # Forward inference request to local Ollama
    import requests
    response = requests.post(
        "http://localhost:11434/api/generate",
        json=event["input"]
    )
    return response.json()

runpod.serverless.start({"handler": handler})
```

### When to Use RunPod

- Variable/bursty inference workloads
- Experimentation with different GPU types
- Cost-optimized spot GPU for batch processing
- Quick prototyping (pods ready in seconds)

---

## 5. Lambda Labs (A100/H100 On-Demand)

**Best for**: ML-focused, on-demand A100/H100, simple pricing.

Lambda Labs offers bare-metal and cloud GPU instances optimized for ML workloads.
Pre-installed CUDA, cuDNN, and ML frameworks.

### Setup

```bash
# Lambda Cloud API
curl -X POST https://cloud.lambdalabs.com/api/v1/instance-operations/launch \
  -H "Authorization: Bearer $LAMBDA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "region_name": "us-east-1",
    "instance_type_name": "gpu_1x_a100_sxm4",
    "ssh_key_names": ["my-key"],
    "name": "tentaclaw-worker-01"
  }'
```

### Pricing

| Instance | GPU | VRAM | vCPU | RAM | $/hr |
|----------|-----|------|------|-----|------|
| gpu_1x_a100 | 1x A100 SXM4 | 40 GB | 30 | 200 GB | $1.10 |
| gpu_1x_a100_sxm4 | 1x A100 SXM4 | 80 GB | 30 | 200 GB | $1.29 |
| gpu_1x_h100_sxm5 | 1x H100 SXM5 | 80 GB | 26 | 200 GB | $2.49 |
| gpu_8x_a100 | 8x A100 SXM4 | 640 GB | 124 | 1800 GB | $8.80 |

### TentaCLAW Worker Setup on Lambda

Lambda instances come with NVIDIA drivers and CUDA pre-installed:

```bash
# SSH into your Lambda instance
ssh ubuntu@your-lambda-ip

# Install TentaCLAW (drivers already present)
curl -fsSL https://ollama.com/install.sh | sh
git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git /opt/tentaclaw-os
cd /opt/tentaclaw-os/agent && npm ci --omit=dev && npm run build

# Point at your gateway
export TENTACLAW_GATEWAY_URL=http://YOUR_GATEWAY:8080
export TENTACLAW_FARM_HASH=your-cluster
node dist/index.js
```

### When to Use Lambda Labs

- Need bare-metal A100/H100 performance
- ML-focused workloads (pre-installed CUDA stack)
- Simple, transparent pricing
- On-demand access without long-term commitments

---

## 6. Hybrid Architecture (Recommended)

**Best for**: Cost optimization, burst capacity, homelab + cloud.

The most cost-effective TentaCLAW deployment combines a self-hosted gateway with
cloud GPU workers that scale up and down based on demand.

### Architecture

```
  Your Network (homelab / office / colo)
  +-------------------------------------------+
  |  Gateway (always-on)                      |
  |  - TentaCLAW coordinator                  |
  |  - Dashboard + API                        |
  |  - Prometheus + Grafana                   |
  |  - Any old server or Raspberry Pi 5       |
  +-------------------------------------------+
        |                    |
        | WireGuard VPN      | WireGuard VPN
        |                    |
  +-------------+    +------------------+
  | Cloud GPU   |    | Cloud GPU        |
  | Worker(s)   |    | Worker(s)        |
  | Hetzner /   |    | RunPod /         |
  | Lambda Labs |    | AWS Spot         |
  +-------------+    +------------------+
    (always-on)        (burst / on-demand)
```

### How It Works

1. **Gateway runs at home** (free, always-on, you own the data).
2. **Permanent cloud workers** on the cheapest provider (Hetzner CPU for BitNet,
   Lambda Labs for GPU).
3. **Burst workers** spin up on RunPod or AWS Spot when queue depth exceeds a
   threshold, and shut down when idle.

### WireGuard VPN Setup (Cloud Workers to Home Gateway)

On the gateway (home):
```bash
# Install WireGuard
apt-get install -y wireguard

# Generate keys
wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey

# Configure WireGuard
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.100.0.1/24
ListenPort = 51820
PrivateKey = $(cat /etc/wireguard/privatekey)

# Cloud worker 1
[Peer]
PublicKey = WORKER_1_PUBLIC_KEY
AllowedIPs = 10.100.0.2/32

# Cloud worker 2
[Peer]
PublicKey = WORKER_2_PUBLIC_KEY
AllowedIPs = 10.100.0.3/32
EOF

systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0
```

On each cloud worker:
```bash
apt-get install -y wireguard
wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey

cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.100.0.2/24
PrivateKey = $(cat /etc/wireguard/privatekey)

[Peer]
PublicKey = GATEWAY_PUBLIC_KEY
Endpoint = YOUR_HOME_IP:51820
AllowedIPs = 10.100.0.0/24
PersistentKeepalive = 25
EOF

systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0
```

Then configure the TentaCLAW agent to use the VPN gateway IP:
```bash
# /etc/tentaclaw/rig.conf
GATEWAY_URL=http://10.100.0.1:8080
```

### Cost Comparison: Hybrid vs Full Cloud

| Setup | Monthly Cost | Notes |
|-------|-------------|-------|
| Full AWS (2x g5.xlarge) | ~$1,500 | On-demand |
| Full AWS Spot (2x g5.xlarge) | ~$560 | 60% interruption risk |
| Hybrid: home gw + 2x Lambda A100 | ~$1,900 | Best GPU perf |
| Hybrid: home gw + 2x RunPod spot 4090 | ~$570 | Great value |
| Hybrid: Hetzner gw + 2x Lambda A100 | ~$1,905 | No home server needed |
| Full Hetzner (CPU only, BitNet) | ~$141 | CPU inference only |

### Burst Scaling Script

Automate cloud worker provisioning based on inference queue depth:

```bash
#!/bin/bash
# deploy/scripts/burst-scale.sh
# Check gateway queue depth and spin up/down cloud workers

GATEWAY_URL="http://10.100.0.1:8080"
QUEUE_THRESHOLD=10
RUNPOD_API_KEY="${RUNPOD_API_KEY}"

QUEUE_DEPTH=$(curl -sf "$GATEWAY_URL/api/v1/queue" | jq '.depth // 0')

if [ "$QUEUE_DEPTH" -gt "$QUEUE_THRESHOLD" ]; then
  echo "Queue depth $QUEUE_DEPTH > threshold, scaling up..."
  # Spin up a RunPod spot instance
  runpod pod create --gpu-type "NVIDIA RTX 4090" --spot
elif [ "$QUEUE_DEPTH" -eq 0 ]; then
  echo "Queue empty, scaling down burst workers..."
  # Terminate spot workers
  runpod pod list --status running --label burst | xargs runpod pod stop
fi
```

---

## Provider Decision Matrix

| Criteria | Hetzner | AWS | Vultr | RunPod | Lambda |
|----------|---------|-----|-------|--------|--------|
| **Cost** | Lowest | Highest | Medium | Low (spot) | Medium |
| **GPU Availability** | None | Excellent | Good | Excellent | Limited |
| **Setup Complexity** | Low | High | Low | Low | Low |
| **Terraform Support** | Yes (module included) | Yes (module included) | Community | No | No |
| **Autoscaling** | Manual | Native (ASG) | API | Serverless | API |
| **Compliance** | EU GDPR | SOC2/HIPAA/FedRAMP | SOC2 | None | None |
| **Spot/Preemptible** | No | Yes (60-90% off) | No | Yes (40-50% off) | No |
| **Bare Metal** | Dedicated servers | Dedicated hosts | Bare metal | No | Yes |
| **Data Sovereignty** | EU (Germany/Finland) | Global | Global | US/EU | US |

## Recommendations

1. **Starting out / development**: Hetzner gateway + local GPU (cheapest path)
2. **Production (budget)**: Hetzner gateway + RunPod spot workers
3. **Production (enterprise)**: AWS full stack with Terraform module
4. **Maximum performance**: Lambda Labs H100 workers + any gateway
5. **Hybrid (recommended)**: Home gateway + cloud burst workers via WireGuard

---

## Next Steps

- [AWS Terraform Module](../aws/) -- Full AWS deployment with ALB, IAM, S3
- [Hetzner Terraform Module](../) -- Full Hetzner deployment (root terraform dir)
- [Cloud Deploy Guide](../../../docs/CLOUD-DEPLOY.md) -- Comprehensive deployment walkthrough
- [Getting Started](../../../docs/GETTING-STARTED.md) -- Local development setup
