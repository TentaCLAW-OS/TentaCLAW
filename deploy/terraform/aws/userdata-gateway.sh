#!/bin/bash
# =============================================================================
# TentaCLAW OS -- User Data Script for AWS Gateway EC2 Instance
# =============================================================================
#
# This script runs on first boot of the gateway instance via EC2 user data.
# It installs all dependencies, configures the TentaCLAW gateway, sets up
# Nginx reverse proxy, Prometheus, Grafana, and PostgreSQL.
#
# Template variables (injected by Terraform templatefile):
#   ${cluster_name}   -- Cluster name prefix
#   ${gateway_domain} -- Domain for TLS (empty = skip TLS)
#   ${worker_count}   -- Expected number of worker nodes
#   ${aws_region}     -- AWS region
#   ${s3_bucket}      -- S3 bucket name for models (empty = skip)
#   ${environment}    -- Deployment environment
#
# Logs: /var/log/cloud-init-output.log
#       journalctl -u tentaclaw-gateway -f
# =============================================================================

set -euo pipefail
exec > >(tee /var/log/tentaclaw-setup.log) 2>&1

echo "=== TentaCLAW Gateway setup starting at $(date -u) ==="

# -----------------------------------------------------------------------------
# System Configuration
# -----------------------------------------------------------------------------

export DEBIAN_FRONTEND=noninteractive

# Set hostname
hostnamectl set-hostname "${cluster_name}-gateway"

# Update system packages
apt-get update -qq
apt-get upgrade -y -qq

# Install base packages
apt-get install -y -qq \
  curl wget git jq unzip htop \
  ufw fail2ban \
  nginx certbot python3-certbot-nginx \
  postgresql postgresql-contrib \
  apt-transport-https software-properties-common \
  awscli

# -----------------------------------------------------------------------------
# Security Hardening
# -----------------------------------------------------------------------------

# Enable fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Configure UFW (allow SSH, HTTP, HTTPS, gateway API, Grafana)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 8080/tcp  # Gateway API (from ALB + private network)
ufw allow 3000/tcp  # Grafana
ufw allow 9090/tcp  # Prometheus (restrict in production)
ufw allow 41337/udp # TentaCLAW discovery (cluster-internal)
ufw --force enable

# Harden SSH: disable password auth, root login with keys only
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload sshd

# IMDSv2 enforcement (already set via Terraform, belt and suspenders)
# Instances use IAM roles, never hardcoded credentials

# -----------------------------------------------------------------------------
# Node.js 22.x
# -----------------------------------------------------------------------------

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

echo "[setup] Node.js $(node --version) installed"

# -----------------------------------------------------------------------------
# PostgreSQL Setup
# -----------------------------------------------------------------------------

# Generate a strong random password
PG_PASS=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)

sudo -u postgres psql -c "CREATE USER tentaclaw WITH PASSWORD '$PG_PASS';"
sudo -u postgres psql -c "CREATE DATABASE tentaclaw OWNER tentaclaw;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE tentaclaw TO tentaclaw;"

# Allow local connections with password
echo "host tentaclaw tentaclaw 127.0.0.1/32 md5" >> /etc/postgresql/*/main/pg_hba.conf
systemctl restart postgresql

# Store credentials securely
mkdir -p /etc/tentaclaw
chmod 700 /etc/tentaclaw

cat > /etc/tentaclaw/gateway.env << ENVEOF
# TentaCLAW Gateway Environment (auto-generated)
# DO NOT commit this file to version control
TENTACLAW_DB=postgres
TENTACLAW_PG_URL=postgres://tentaclaw:$PG_PASS@127.0.0.1:5432/tentaclaw
TENTACLAW_PORT=8080
TENTACLAW_HOST=0.0.0.0
TENTACLAW_CLUSTER_NAME=${cluster_name}
TENTACLAW_ENVIRONMENT=${environment}
TENTACLAW_LOG_FORMAT=json
AWS_REGION=${aws_region}
S3_MODEL_BUCKET=${s3_bucket}
ENVEOF

chmod 600 /etc/tentaclaw/gateway.env

echo "[setup] PostgreSQL configured"

# -----------------------------------------------------------------------------
# Clone and Build TentaCLAW
# -----------------------------------------------------------------------------

cd /opt
git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git
cd tentaclaw-os/gateway

npm ci --omit=dev
npm run build

echo "[setup] TentaCLAW gateway built"

# -----------------------------------------------------------------------------
# Systemd Service for Gateway
# -----------------------------------------------------------------------------

cat > /etc/systemd/system/tentaclaw-gateway.service << 'UNIT'
[Unit]
Description=TentaCLAW Gateway - AI Inference Cluster Coordinator
Documentation=https://github.com/TentaCLAW-OS/tentaclaw-os
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/tentaclaw-os/gateway
EnvironmentFile=/etc/tentaclaw/gateway.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tentaclaw-gateway

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/tentaclaw-os/gateway/data /var/log
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable tentaclaw-gateway
systemctl start tentaclaw-gateway

echo "[setup] TentaCLAW gateway service started"

# -----------------------------------------------------------------------------
# Nginx Reverse Proxy
# -----------------------------------------------------------------------------

cat > /etc/nginx/sites-available/tentaclaw << 'NGINX'
upstream gateway {
    server 127.0.0.1:8080;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Health check for ALB (no logging)
    location /health {
        proxy_pass http://gateway/health;
        proxy_http_version 1.1;
        access_log off;
    }

    # API and Dashboard
    location / {
        proxy_pass http://gateway;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;

        # WebSocket support for live dashboard
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/tentaclaw /etc/nginx/sites-enabled/tentaclaw
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "[setup] Nginx configured"

# -----------------------------------------------------------------------------
# TLS via Let's Encrypt (if domain is provided)
# -----------------------------------------------------------------------------

DOMAIN="${gateway_domain}"
if [ -n "$DOMAIN" ]; then
  sed -i "s/server_name _;/server_name $DOMAIN;/" /etc/nginx/sites-available/tentaclaw
  nginx -t && systemctl reload nginx

  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    -m "admin@$DOMAIN" --redirect || echo "[setup] WARN: certbot failed, continuing without TLS"

  # Auto-renewal
  echo "0 0,12 * * * root certbot renew --quiet --deploy-hook 'systemctl reload nginx'" > /etc/cron.d/certbot-renew
  echo "[setup] TLS configured for $DOMAIN"
fi

# -----------------------------------------------------------------------------
# Prometheus
# -----------------------------------------------------------------------------

apt-get install -y -qq prometheus

cat > /etc/prometheus/prometheus.yml << PROMEOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'tentaclaw-gateway'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/metrics'

  - job_name: 'node-exporter-gateway'
    static_configs:
      - targets: ['localhost:9100']

  - job_name: 'tentaclaw-workers'
    ec2_sd_configs:
      - region: ${aws_region}
        port: 9100
        filters:
          - name: "tag:Cluster"
            values: ["${cluster_name}"]
          - name: "tag:Role"
            values: ["worker"]
          - name: "instance-state-name"
            values: ["running"]

  - job_name: 'ollama-workers'
    ec2_sd_configs:
      - region: ${aws_region}
        port: 11434
        filters:
          - name: "tag:Cluster"
            values: ["${cluster_name}"]
          - name: "tag:Role"
            values: ["worker"]
          - name: "instance-state-name"
            values: ["running"]
    metrics_path: '/metrics'
PROMEOF

systemctl enable prometheus
systemctl restart prometheus

echo "[setup] Prometheus configured with EC2 service discovery"

# -----------------------------------------------------------------------------
# Grafana
# -----------------------------------------------------------------------------

wget -q -O /usr/share/keyrings/grafana.key https://apt.grafana.com/gpg.key
echo "deb [signed-by=/usr/share/keyrings/grafana.key] https://apt.grafana.com stable main" \
  > /etc/apt/sources.list.d/grafana.list
apt-get update -qq
apt-get install -y -qq grafana

mkdir -p /etc/grafana/provisioning/datasources
cat > /etc/grafana/provisioning/datasources/prometheus.yml << 'GRAF'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://localhost:9090
    isDefault: true
    editable: false
GRAF

systemctl enable grafana-server
systemctl start grafana-server

echo "[setup] Grafana installed"

# -----------------------------------------------------------------------------
# Node Exporter (self-monitoring)
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
# Data Directory
# -----------------------------------------------------------------------------

mkdir -p /opt/tentaclaw-os/gateway/data

# -----------------------------------------------------------------------------
# CloudWatch Agent (optional -- sends logs to CloudWatch)
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
        "units": ["tentaclaw-gateway", "nginx", "postgresql"],
        "collect_list": [{
          "unit": "tentaclaw-gateway",
          "log_group_name": "/tentaclaw/${cluster_name}",
          "log_stream_name": "gateway/{instance_id}"
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
# Logrotate
# -----------------------------------------------------------------------------

cat > /etc/logrotate.d/tentaclaw << 'LR'
/var/log/tentaclaw-*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
}
LR

# -----------------------------------------------------------------------------
# Cluster Configuration Marker
# -----------------------------------------------------------------------------

cat > /etc/tentaclaw/cluster.conf << CLUSTEREOF
# TentaCLAW Cluster Configuration
# Auto-generated by Terraform user data
CLUSTER_NAME=${cluster_name}
ROLE=gateway
CLOUD_PROVIDER=aws
AWS_REGION=${aws_region}
EXPECTED_WORKERS=${worker_count}
S3_BUCKET=${s3_bucket}
CLUSTEREOF

# MOTD
cat > /etc/motd << 'MOTD'
============================================================
  TentaCLAW OS -- Gateway Node (AWS)

  Dashboard:  http://localhost:8080/dashboard
  API:        http://localhost:8080/v1
  Grafana:    http://localhost:3000
  Prometheus: http://localhost:9090

  Logs: journalctl -u tentaclaw-gateway -f
  Setup log: /var/log/tentaclaw-setup.log
============================================================
MOTD

echo "=== TentaCLAW Gateway setup complete at $(date -u) ==="
