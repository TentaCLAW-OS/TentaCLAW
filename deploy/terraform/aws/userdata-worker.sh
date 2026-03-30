#!/bin/bash
# =============================================================================
# TentaCLAW OS -- User Data Script for AWS GPU Worker EC2 Instance
# =============================================================================
#
# This script runs on first boot of each GPU worker instance via EC2 user data.
# It installs NVIDIA drivers, Ollama, the TentaCLAW agent, and node_exporter.
#
# Template variables (injected by Terraform templatefile):
#   ${cluster_name} -- Cluster name prefix
#   ${gateway_ip}   -- Private IP of the gateway instance
#   ${worker_index} -- This worker's index (1-based)
#   ${worker_name}  -- This worker's hostname
#   ${aws_region}   -- AWS region
#   ${s3_bucket}    -- S3 bucket name for models (empty = skip)
#
# Logs: /var/log/cloud-init-output.log
#       /var/log/tentaclaw-setup.log
#       journalctl -u tentaclaw-agent -f
# =============================================================================

set -euo pipefail
exec > >(tee /var/log/tentaclaw-setup.log) 2>&1

echo "=== TentaCLAW Worker ${worker_name} setup starting at $(date -u) ==="

# -----------------------------------------------------------------------------
# System Configuration
# -----------------------------------------------------------------------------

export DEBIAN_FRONTEND=noninteractive

# Set hostname
hostnamectl set-hostname "${worker_name}"

# Update system packages
apt-get update -qq
apt-get upgrade -y -qq

# Install base packages
apt-get install -y -qq \
  curl wget git jq unzip htop \
  ufw fail2ban \
  pciutils lm-sensors \
  apt-transport-https software-properties-common \
  awscli

# -----------------------------------------------------------------------------
# Security Hardening
# -----------------------------------------------------------------------------

# Enable fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Configure UFW
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 11434/tcp   # Ollama API (from gateway)
ufw allow 9100/tcp    # Node exporter (from Prometheus)
ufw allow 41337/udp   # TentaCLAW discovery
ufw --force enable

# Harden SSH
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload sshd

# -----------------------------------------------------------------------------
# NVIDIA GPU Drivers
# -----------------------------------------------------------------------------

echo "[setup] Detecting GPU hardware..."

if lspci | grep -qi nvidia; then
  echo "[setup] NVIDIA GPU detected, installing drivers..."

  # Install NVIDIA drivers via ubuntu-drivers
  apt-get install -y -qq ubuntu-drivers-common
  ubuntu-drivers autoinstall || true

  # Install NVIDIA Container Toolkit
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
    gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update -qq
  apt-get install -y -qq nvidia-container-toolkit || true

  # Verify GPU is accessible
  nvidia-smi || echo "[setup] WARN: nvidia-smi not yet available (may need reboot)"

  echo "[setup] NVIDIA drivers installed"
else
  echo "[setup] No NVIDIA GPU detected via lspci"
fi

# -----------------------------------------------------------------------------
# Node.js 22.x
# -----------------------------------------------------------------------------

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

echo "[setup] Node.js $(node --version) installed"

# -----------------------------------------------------------------------------
# Ollama (LLM Inference Runtime)
# -----------------------------------------------------------------------------

curl -fsSL https://ollama.com/install.sh | sh

# Configure Ollama to listen on all interfaces (gateway proxies requests)
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf << 'OV'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
OV

systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama

# Wait for Ollama to be ready
echo "[setup] Waiting for Ollama to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/ > /dev/null 2>&1; then
    echo "[setup] Ollama is ready"
    break
  fi
  sleep 2
done

# Pull a small default model for quick testing
ollama pull qwen2.5:1.5b || echo "[setup] WARN: could not pull default model"

echo "[setup] Ollama installed and running"

# -----------------------------------------------------------------------------
# Download Models from S3 (if bucket configured)
# -----------------------------------------------------------------------------

S3_BUCKET="${s3_bucket}"
if [ -n "$S3_BUCKET" ]; then
  echo "[setup] Checking S3 bucket for models..."
  mkdir -p /opt/tentaclaw-models

  # Sync models from S3 (IAM role provides credentials automatically)
  aws s3 sync "s3://$S3_BUCKET/models/" /opt/tentaclaw-models/ --region "${aws_region}" || \
    echo "[setup] WARN: S3 model sync failed or bucket empty"

  echo "[setup] S3 model sync complete"
fi

# -----------------------------------------------------------------------------
# Clone and Build TentaCLAW Agent
# -----------------------------------------------------------------------------

cd /opt
git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git
cd tentaclaw-os/agent

npm ci --omit=dev
npm run build

echo "[setup] TentaCLAW agent built"

# -----------------------------------------------------------------------------
# Agent Configuration
# -----------------------------------------------------------------------------

mkdir -p /etc/tentaclaw
chmod 700 /etc/tentaclaw

cat > /etc/tentaclaw/rig.conf << RIGEOF
# TentaCLAW Agent Configuration
# Auto-generated by Terraform user data
NODE_ID=${worker_name}
NODE_HOSTNAME=${worker_name}
FARM_HASH=${cluster_name}
GATEWAY_URL=http://${gateway_ip}:8080
AGENT_INTERVAL=10
WATCHDOG_ENABLED=1
WATCHDOG_GPU_TEMP_MAX=85
WATCHDOG_ACTION=throttle
CLOUD_PROVIDER=aws
AWS_REGION=${aws_region}
RIGEOF

# Environment file for the systemd service
cat > /etc/tentaclaw/agent.env << ENVEOF
TENTACLAW_GATEWAY_URL=http://${gateway_ip}:8080
TENTACLAW_NODE_ID=${worker_name}
TENTACLAW_HOSTNAME=${worker_name}
TENTACLAW_FARM_HASH=${cluster_name}
TENTACLAW_LOG_FORMAT=json
AWS_REGION=${aws_region}
S3_MODEL_BUCKET=${s3_bucket}
ENVEOF

chmod 600 /etc/tentaclaw/agent.env

# -----------------------------------------------------------------------------
# Systemd Service for Agent
# -----------------------------------------------------------------------------

cat > /etc/systemd/system/tentaclaw-agent.service << 'UNIT'
[Unit]
Description=TentaCLAW Agent - GPU Inference Node Daemon
Documentation=https://github.com/TentaCLAW-OS/tentaclaw-os
After=network-online.target ollama.service
Wants=network-online.target ollama.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/tentaclaw-os/agent
EnvironmentFile=/etc/tentaclaw/agent.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tentaclaw-agent

# Hardening
NoNewPrivileges=true
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable tentaclaw-agent
systemctl start tentaclaw-agent

echo "[setup] TentaCLAW agent service started"

# -----------------------------------------------------------------------------
# Node Exporter (metrics for Prometheus)
# -----------------------------------------------------------------------------

useradd --no-create-home --shell /bin/false node_exporter 2>/dev/null || true
NE_VERSION="1.7.0"
wget -q "https://github.com/prometheus/node_exporter/releases/download/v$NE_VERSION/node_exporter-$NE_VERSION.linux-amd64.tar.gz" \
  -O /tmp/node_exporter.tar.gz
tar xzf /tmp/node_exporter.tar.gz -C /tmp
cp "/tmp/node_exporter-$NE_VERSION.linux-amd64/node_exporter" /usr/local/bin/
rm -rf /tmp/node_exporter*

cat > /etc/systemd/system/node_exporter.service << 'NE'
[Unit]
Description=Prometheus Node Exporter
After=network-online.target

[Service]
User=node_exporter
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
NE

systemctl daemon-reload
systemctl enable node_exporter
systemctl start node_exporter

echo "[setup] Node exporter installed"

# -----------------------------------------------------------------------------
# NVIDIA DCGM Exporter (GPU metrics for Prometheus)
# -----------------------------------------------------------------------------

if command -v nvidia-smi &> /dev/null; then
  echo "[setup] Setting up NVIDIA GPU metrics exporter..."

  # Install DCGM
  wget -q https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb \
    -O /tmp/cuda-keyring.deb
  dpkg -i /tmp/cuda-keyring.deb || true
  apt-get update -qq
  apt-get install -y -qq datacenter-gpu-manager || echo "[setup] WARN: DCGM install failed"

  if command -v nv-hostengine &> /dev/null; then
    systemctl enable nvidia-dcgm
    systemctl start nvidia-dcgm
    echo "[setup] NVIDIA DCGM exporter running"
  fi
fi

# -----------------------------------------------------------------------------
# CloudWatch Agent (optional)
# -----------------------------------------------------------------------------

if command -v aws &> /dev/null; then
  wget -q https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb \
    -O /tmp/cwagent.deb
  dpkg -i /tmp/cwagent.deb || true
  rm -f /tmp/cwagent.deb

  cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << CWEOF
{
  "logs": {
    "logs_collected": {
      "journald": {
        "units": ["tentaclaw-agent", "ollama"],
        "collect_list": [{
          "unit": "tentaclaw-agent",
          "log_group_name": "/tentaclaw/${cluster_name}",
          "log_stream_name": "worker-${worker_name}/{instance_id}"
        }]
      }
    }
  }
}
CWEOF

  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config -m ec2 \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s || true

  echo "[setup] CloudWatch agent configured"
fi

# -----------------------------------------------------------------------------
# Cluster Configuration Marker
# -----------------------------------------------------------------------------

cat > /etc/tentaclaw/cluster.conf << CLUSTEREOF
# TentaCLAW Cluster Configuration
# Auto-generated by Terraform user data
CLUSTER_NAME=${cluster_name}
ROLE=worker
WORKER_INDEX=${worker_index}
GATEWAY_IP=${gateway_ip}
CLOUD_PROVIDER=aws
AWS_REGION=${aws_region}
CLUSTEREOF

# MOTD
cat > /etc/motd << MOTDEOF
============================================================
  TentaCLAW OS -- Worker Node (AWS)
  Name:    ${worker_name}
  Cluster: ${cluster_name}
  Gateway: http://${gateway_ip}:8080

  Agent logs:  journalctl -u tentaclaw-agent -f
  Ollama logs: journalctl -u ollama -f
  GPU status:  nvidia-smi
  Setup log:   /var/log/tentaclaw-setup.log
============================================================
MOTDEOF

echo "=== TentaCLAW Worker ${worker_name} setup complete at $(date -u) ==="
