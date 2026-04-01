#!/bin/bash
# =============================================================================
# TentaCLAW — Install on all cluster nodes via SSH
# =============================================================================
# Usage: bash scripts/install-cluster.sh
# =============================================================================

NODES=(
    "192.168.1.69"
    "192.168.1.16"
    "192.168.1.177"
    "192.168.1.222"
)
SSH_USER="root"
SSH_PASS="Higgs1307!"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=no"

T='\033[38;2;0;212;170m'
P='\033[38;2;139;92;246m'
R='\033[0;31m'
B='\033[1m'
N='\033[0m'

if ! command -v sshpass &>/dev/null; then
    echo -e "${R}[ERROR]${N} sshpass not found. Install it:"
    echo "  apt install sshpass   # Debian/Ubuntu"
    echo "  yum install sshpass   # RHEL/CentOS"
    exit 1
fi

echo ""
echo -e "${T}${B}TentaCLAW Cluster Install${N}"
echo -e "${P}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo ""

for NODE in "${NODES[@]}"; do
    echo -e "${T}[${NODE}]${N} Starting install..."
    sshpass -p "$SSH_PASS" ssh $SSH_OPTS "${SSH_USER}@${NODE}" \
        'curl -fsSL tentaclaw.io/install | bash -s -- --no-wizard' \
        2>&1 | sed "s/^/  [${NODE}] /" &
done

echo ""
echo -e "${P}Installing on all nodes in parallel...${N}"
wait

echo ""
echo -e "${T}${B}Done! Check each node:${N}"
for NODE in "${NODES[@]}"; do
    echo -e "  ${P}http://${NODE}:8080/dashboard${N}  (or 8081 if 8080 was taken)"
done
echo ""
