# TentaCLAW OS -- Ansible Deployment

Deploy TentaCLAW to any set of servers -- bare-metal, cloud VMs, or a mix of both.

## Architecture

```
  Your Machine                    Remote Servers
  +-----------+                   +-------------------+
  |  Ansible  | --- SSH --->      |  Gateway Node     |
  |  Control  |                   |  (coordinator)    |
  +-----------+                   +-------------------+
       |                                  |
       +--- SSH --->  +-------------------+
       |              |  Worker Node 1    |
       |              |  (Ollama + Agent) |
       |              +-------------------+
       |
       +--- SSH --->  +-------------------+
       |              |  Worker Node 2    |
       |              |  (Ollama + Agent) |
       |              +-------------------+
       |
       +--- SSH --->  +-------------------+
                      |  Worker Node 3    |
                      |  (Ollama + Agent) |
                      +-------------------+
```

## What Gets Installed

### Gateway Node
- Node.js 22.x
- TentaCLAW Gateway (API + Dashboard + WebSocket)
- PostgreSQL (optional, default: SQLite)
- Nginx reverse proxy with optional TLS
- Prometheus node_exporter

### Worker Nodes
- Node.js 22.x
- Ollama (LLM inference runtime)
- GPU drivers (NVIDIA/AMD auto-detected)
- TentaCLAW Agent daemon
- `/etc/tentaclaw/rig.conf` configuration
- Prometheus node_exporter

## Prerequisites

1. **Ansible** >= 2.12 installed on your control machine:
   ```bash
   pip install ansible
   ```

2. **SSH access** to all target servers (key-based authentication recommended)

3. **Ubuntu 22.04+** or **Debian 12+** on target servers

4. **Root or sudo access** on target servers

## Quick Start

```bash
# 1. Navigate to the ansible directory
cd deploy/ansible

# 2. Copy and edit the inventory
cp inventory.example.ini inventory.ini
# Edit inventory.ini with your server IPs

# 3. Test connectivity
ansible all -i inventory.ini -m ping

# 4. Deploy everything
ansible-playbook -i inventory.ini playbook.yml
```

## Inventory Setup

Edit `inventory.ini` with your server details:

```ini
[gateway]
gateway-01 ansible_host=10.0.1.10 ansible_user=root

[workers]
worker-01 ansible_host=10.0.1.20 ansible_user=root worker_name=gpu-rig-01
worker-02 ansible_host=10.0.1.21 ansible_user=root worker_name=gpu-rig-02
worker-03 ansible_host=10.0.1.22 ansible_user=root worker_name=gpu-rig-03

[workers:vars]
gateway_url=http://10.0.1.10:8080
```

### Using a non-root user with sudo

```ini
[all:vars]
ansible_user=deploy
ansible_become=true
ansible_become_method=sudo
```

### Using a jump host / bastion

```ini
[all:vars]
ansible_ssh_common_args='-o ProxyJump=user@bastion.example.com'
```

## Selective Deployment

```bash
# Deploy gateway only
ansible-playbook -i inventory.ini playbook.yml --tags gateway

# Deploy agents only
ansible-playbook -i inventory.ini playbook.yml --tags agent

# Deploy to a single worker
ansible-playbook -i inventory.ini playbook.yml --limit worker-02

# Deploy common setup only (Node.js, packages)
ansible-playbook -i inventory.ini playbook.yml --tags common

# Skip GPU driver installation
ansible-playbook -i inventory.ini playbook.yml --skip-tags gpu

# Skip Ollama model pull
ansible-playbook -i inventory.ini playbook.yml --skip-tags models
```

## Configuration Variables

### Global variables (in inventory or group_vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `tentaclaw_repo` | GitHub URL | Git repository to clone |
| `tentaclaw_branch` | `master` | Branch or tag to deploy |
| `tentaclaw_install_dir` | `/opt/tentaclaw-os` | Installation directory |
| `node_version` | `22` | Node.js major version |
| `cluster_name` | `tentaclaw` | Cluster identifier |

### Gateway variables

| Variable | Default | Description |
|----------|---------|-------------|
| `tentaclaw_port` | `8080` | Gateway listen port |
| `tentaclaw_host` | `0.0.0.0` | Gateway bind address |
| `tentaclaw_db` | `sqlite` | Database backend (`sqlite` or `postgres`) |
| `tentaclaw_pg_url` | - | PostgreSQL connection URL |
| `gateway_domain` | - | Domain for TLS (empty = no TLS) |
| `acme_email` | - | Email for Let's Encrypt |

### Worker variables

| Variable | Default | Description |
|----------|---------|-------------|
| `gateway_url` | `http://gateway:8080` | Gateway URL for agent connection |
| `worker_name` | `inventory_hostname` | Node display name |
| `agent_interval` | `10` | Stats reporting interval (seconds) |
| `ollama_host` | `0.0.0.0:11434` | Ollama bind address |
| `default_model` | `qwen2.5:1.5b` | Default model to pull on setup |
| `farm_hash` | `tentaclaw` | Farm/cluster hash for grouping |
| `watchdog_gpu_temp_max` | `85` | GPU temperature threshold (Celsius) |
| `watchdog_action` | `throttle` | Watchdog action on overheat |

## Updating the Cluster

```bash
# Pull latest code and rebuild on all nodes
ansible-playbook -i inventory.ini playbook.yml

# Update only agents (e.g., after a code change)
ansible-playbook -i inventory.ini playbook.yml --tags agent --limit workers
```

## Adding a New Worker

1. Add the new server to `inventory.ini` under `[workers]`
2. Run the playbook with `--limit`:
   ```bash
   ansible-playbook -i inventory.ini playbook.yml --limit worker-04
   ```

## Troubleshooting

### Check service status
```bash
# On gateway
ssh root@gateway-ip 'systemctl status tentaclaw-gateway'
ssh root@gateway-ip 'journalctl -u tentaclaw-gateway -f'

# On worker
ssh root@worker-ip 'systemctl status tentaclaw-agent'
ssh root@worker-ip 'journalctl -u tentaclaw-agent -f'
ssh root@worker-ip 'systemctl status ollama'
```

### Verify connectivity
```bash
# From a worker, test gateway connectivity
ssh root@worker-ip 'curl -s http://gateway-ip:8080/health'

# From gateway, check registered nodes
ssh root@gateway-ip 'curl -s http://localhost:8080/api/v1/nodes | jq'
```

### Re-run with verbose output
```bash
ansible-playbook -i inventory.ini playbook.yml -vvv
```

## Directory Structure

```
deploy/ansible/
  playbook.yml               # Main playbook
  inventory.example.ini      # Example inventory (copy to inventory.ini)
  roles/
    gateway/
      tasks/main.yml         # Gateway installation tasks
    agent/
      tasks/main.yml         # Agent installation tasks
```
