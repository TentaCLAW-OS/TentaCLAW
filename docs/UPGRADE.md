# TentaCLAW OS Upgrade Guide

> **Upgrade your cluster without losing your tentacles.**

This guide covers how to safely upgrade TentaCLAW OS components: gateway, agents, CLI, and the OS itself.

---

## Table of Contents

- [Version Compatibility](#version-compatibility)
- [Pre-Upgrade Checklist](#pre-upgrade-checklist)
- [Backup Before Upgrade](#backup-before-upgrade)
- [Upgrade the Gateway](#upgrade-the-gateway)
- [Upgrade the Agents](#upgrade-the-agents)
- [Upgrade the CLI](#upgrade-the-cli)
- [Upgrade TentaCLAW OS (ISO Nodes)](#upgrade-tentaclaw-os-iso-nodes)
- [Database Migrations](#database-migrations)
- [Rollback Procedure](#rollback-procedure)
- [Version History](#version-history)

---

## Version Compatibility

TentaCLAW follows **semantic versioning**: `MAJOR.MINOR.PATCH`.

| Version Change | Compatibility | Action Required |
|---------------|---------------|-----------------|
| **Patch** (0.2.0 -> 0.2.1) | Fully compatible | Upgrade in any order |
| **Minor** (0.2.x -> 0.3.0) | Gateway-backward compatible | Upgrade gateway first, then agents |
| **Major** (0.x -> 1.0) | Breaking changes possible | Follow migration guide for that release |

### Component Compatibility Matrix

The gateway, agent, CLI, and MCP server communicate via the shared types contract. Keep them within one minor version of each other.

| Gateway | Agent | CLI | MCP | Status |
|---------|-------|-----|-----|--------|
| 0.2.x | 0.2.x | 0.2.x | 0.2.x | Fully compatible |
| 0.2.x | 0.1.x | 0.2.x | 0.2.x | Works (agent sends fewer fields) |
| 0.2.x | 0.2.x | 0.1.x | 0.1.x | Works (CLI missing new commands) |
| 0.3.x | 0.1.x | 0.3.x | 0.3.x | May break — upgrade agents |

**Rule of thumb**: Upgrade the gateway first, then agents, then CLI. The gateway is designed to accept stats from older agents gracefully.

---

## Pre-Upgrade Checklist

Before upgrading anything, run through this list:

```bash
# 1. Check current versions
curl http://localhost:8080/api/v1/version
clawtopus version
clawtopus status

# 2. Check cluster health
clawtopus health
clawtopus doctor

# 3. Check for active deployments or model pulls
clawtopus models
# Wait for any in-progress model pulls to finish

# 4. Check for active alerts
clawtopus alerts
# Resolve any critical alerts before upgrading

# 5. Note the current number of nodes and their status
clawtopus nodes
```

If everything looks healthy, proceed with the upgrade.

---

## Backup Before Upgrade

### Gateway Database

The gateway stores all cluster state in a SQLite database. Back it up before any upgrade.

```bash
# From source install
cp gateway/data/tentaclaw.db gateway/data/tentaclaw.db.backup-$(date +%Y%m%d)

# From Docker
docker cp tentaclaw-gateway-1:/app/gateway/data/tentaclaw.db ./tentaclaw.db.backup-$(date +%Y%m%d)

# Verify the backup is valid
sqlite3 ./tentaclaw.db.backup-* "SELECT count(*) FROM nodes;"
```

### Gateway Configuration

Back up any environment variables or config files:

```bash
# If using a .env file
cp gateway/.env gateway/.env.backup

# If using systemd, save the service file
cp /etc/systemd/system/tentaclaw-gateway.service ~/tentaclaw-gateway.service.backup
```

### Agent Configuration

On each agent node:

```bash
cp /etc/tentaclaw/rig.conf /etc/tentaclaw/rig.conf.backup
cp /etc/tentaclaw/agent.conf /etc/tentaclaw/agent.conf.backup 2>/dev/null
```

### Export Full Cluster Config

The gateway can export the entire cluster configuration:

```bash
curl http://localhost:8080/api/v1/config/export > cluster-config-backup.json
```

This includes nodes, flight sheets, schedules, notification channels, API keys, tags, and aliases. You can re-import it after a fresh install.

---

## Upgrade the Gateway

### From Source (git pull)

```bash
# 1. Stop the gateway
# Ctrl+C if running in foreground, or:
systemctl stop tentaclaw-gateway

# 2. Pull the latest code
cd /path/to/TentaCLAW
git fetch origin
git log --oneline HEAD..origin/master  # Review what's changing

# 3. Pull and install
git pull origin master
cd gateway && npm install

# 4. Run database migrations (if any)
# Migrations run automatically on startup. The gateway checks the DB schema
# version and applies any pending migrations before accepting connections.

# 5. Start the gateway
npm run dev
# Or: systemctl start tentaclaw-gateway

# 6. Verify
curl http://localhost:8080/health
curl http://localhost:8080/api/v1/version
```

### From Docker

```bash
# 1. Pull the latest image
docker compose pull gateway

# 2. Recreate the container (data volume persists)
docker compose up -d gateway

# 3. Verify
curl http://localhost:8080/health
docker logs tentaclaw-gateway-1 --tail 20
```

### Zero-Downtime Upgrade (Advanced)

For clusters that can't tolerate downtime:

1. Start a second gateway instance on a different port
2. Verify it works with the same database
3. Switch your reverse proxy / DNS to the new instance
4. Stop the old instance

```bash
# Start new gateway on port 8081
TENTACLAW_PORT=8081 npm run dev &

# Verify
curl http://localhost:8081/health

# Update nginx/reverse proxy to point to 8081
# Then stop the old gateway
```

Note: SQLite doesn't support concurrent writers well. For zero-downtime upgrades in production, consider this a quick switchover (seconds of overlap), not a long-running parallel setup.

---

## Upgrade the Agents

Agents are upgraded independently on each node. The gateway accepts connections from older agent versions, so you can roll out agent upgrades gradually.

### From Source

On each agent node:

```bash
# 1. Pull the latest code
cd /path/to/TentaCLAW
git pull origin master

# 2. Install dependencies
cd agent && npm install

# 3. Restart the agent
systemctl restart tentaclaw-agent
# Or kill and restart: npx tsx src/index.ts

# 4. Verify the node reconnects
clawtopus nodes  # Check the node's status and agent version
```

### From Docker

```bash
# On each agent node
docker pull tentaclaw/agent:latest
docker compose up -d agent
```

### Rolling Upgrade (Multiple Nodes)

For clusters with many nodes, upgrade one at a time:

```bash
# 1. Drain the node (stop routing inference to it)
clawtopus drain NODE-001

# 2. SSH to the node and upgrade
ssh gpu-rig-01
cd /path/to/TentaCLAW && git pull origin master
cd agent && npm install
systemctl restart tentaclaw-agent

# 3. Verify the node is healthy
clawtopus node NODE-001

# 4. Uncordon the node (resume inference routing)
clawtopus uncordon NODE-001

# 5. Repeat for the next node
clawtopus drain NODE-002
# ...
```

### Bulk Upgrade via Commands

If your nodes run the TentaCLAW OS ISO (with the built-in update mechanism):

```bash
# Send restart command to all nodes (after deploying new agent binary)
curl -X POST http://localhost:8080/api/v1/bulk/command \
  -H "Content-Type: application/json" \
  -d '{"node_ids":["*"],"action":"restart_agent"}'
```

---

## Upgrade the CLI

The CLI is a local tool on your workstation. Upgrade it independently.

### From npm

```bash
npm update -g clawtopus-cli
clawtopus version
```

### From Source

```bash
cd /path/to/TentaCLAW
git pull origin master
cd cli && npm install && npm run build
clawtopus version
```

The CLI is backward-compatible with older gateways. New CLI commands that require new gateway endpoints will show a helpful error if the gateway doesn't support them yet.

---

## Upgrade TentaCLAW OS (ISO Nodes)

Nodes running the TentaCLAW OS ISO from USB have a read-only root filesystem. To upgrade the OS:

### Option A: Re-flash the USB

The simplest approach for major OS upgrades:

```bash
# 1. Download the new ISO
wget https://github.com/TentaCLAW-OS/TentaCLAW-OS/releases/latest/download/TentaCLAW-OS-<version>-amd64.iso

# 2. Flash to USB
sudo dd if=TentaCLAW-OS-<version>-amd64.iso of=/dev/sdX bs=4M status=progress

# 3. Reboot the node from USB
# The node will re-register with the gateway using its existing Farm Hash
```

### Option B: In-Place Agent Update

For minor updates where only the agent changed:

```bash
# SSH to the node
ssh tentaclaw@<node-ip>

# Update just the agent binary
cd /opt/tentaclaw/agent
git pull origin master
npm install
systemctl restart tentaclaw-agent
```

### Option C: PXE Network Boot

If your nodes boot via PXE, update the PXE server's kernel and initrd:

```bash
# On the PXE server
cd /path/to/TentaCLAW/builder
make pxe
# Copy new artifacts to TFTP server
cp output/pxe/* /srv/tftp/tentaclaw/
```

Reboot nodes. They'll pull the new image from the network automatically.

---

## Database Migrations

The gateway's SQLite database schema evolves between versions. Migrations are **automatic** -- the gateway checks the schema version on startup and applies any pending migrations before accepting connections.

### How It Works

1. Gateway starts
2. Checks `PRAGMA user_version` in the SQLite database
3. Applies any migration scripts with a higher version number
4. Updates `PRAGMA user_version` to the new version
5. Starts accepting connections

### Manual Migration (If Needed)

If the automatic migration fails (rare), you can run it manually:

```bash
# Check current schema version
sqlite3 gateway/data/tentaclaw.db "PRAGMA user_version;"

# If the gateway logs show a specific migration error, check the migration scripts
ls gateway/src/migrations/

# Apply manually if needed (consult the release notes for the specific migration)
sqlite3 gateway/data/tentaclaw.db < gateway/src/migrations/002-add-tags.sql
```

### Fresh Database

If migrations are hopelessly stuck, you can start fresh and re-import:

```bash
# 1. Back up the old database
mv gateway/data/tentaclaw.db gateway/data/tentaclaw.db.old

# 2. Start the gateway (creates a fresh database)
npm run dev

# 3. Re-import cluster config (if you exported it)
curl -X POST http://localhost:8080/api/v1/config/import \
  -H "Content-Type: application/json" \
  -d @cluster-config-backup.json

# 4. Agents will re-register on their next stats push (within 10 seconds)
```

---

## Rollback Procedure

If an upgrade goes wrong, roll back to the previous version.

### Gateway Rollback

```bash
# 1. Stop the gateway
systemctl stop tentaclaw-gateway
# Or: Ctrl+C

# 2. Restore the database backup
cp gateway/data/tentaclaw.db.backup-YYYYMMDD gateway/data/tentaclaw.db

# 3. Check out the previous version
git log --oneline -5                    # Find the previous commit
git checkout <previous-commit-hash>

# 4. Reinstall dependencies
cd gateway && npm install

# 5. Start the gateway
npm run dev

# 6. Verify
curl http://localhost:8080/health
clawtopus status
```

### Docker Rollback

```bash
# 1. Stop the current container
docker compose down gateway

# 2. Use the previous image tag
# Edit docker-compose.yml to pin the previous version:
#   image: tentaclaw/gateway:0.1.0

# 3. Restore the database volume
docker cp ./tentaclaw.db.backup-YYYYMMDD tentaclaw-gateway-1:/app/gateway/data/tentaclaw.db

# 4. Start
docker compose up -d gateway
```

### Agent Rollback

```bash
# On each affected node
cd /path/to/TentaCLAW
git checkout <previous-commit-hash>
cd agent && npm install
systemctl restart tentaclaw-agent
```

### Full Cluster Rollback

If you need to roll back the entire cluster:

1. Roll back the gateway (restore DB + code)
2. Roll back agents one at a time (drain, rollback, uncordon)
3. Roll back the CLI on your workstation
4. Verify: `clawtopus health`, `clawtopus doctor`

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| **0.2.0** | 2026-03 | CLAWtopus CLI, inference playground, node tags, SSH keys, BitNet, auto-discovery, game engine bridge, 129+ tests |
| **0.1.0** | 2026-02 | Initial release: gateway, agent, dashboard, ISO builder, mock mode |

Check the [GitHub Releases](https://github.com/TentaCLAW-OS/TentaCLAW/releases) page for detailed changelogs.

---

## Upgrade Tips

1. **Always back up the database** before upgrading the gateway
2. **Upgrade gateway first**, then agents -- the gateway accepts older agent versions
3. **Drain nodes** before upgrading agents in production clusters
4. **Read the release notes** -- they document breaking changes and required actions
5. **Test on a mock cluster first** -- start a mock agent, upgrade, verify, then roll out to production nodes
6. **Export your config** (`/api/v1/config/export`) before any major upgrade -- it's your insurance policy

---

*CLAWtopus says: "Shed the old shell, keep all eight arms. Upgrade complete."*
