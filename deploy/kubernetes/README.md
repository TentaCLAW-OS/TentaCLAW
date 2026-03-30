# TentaCLAW OS -- Kubernetes Deployment Guide

This directory contains everything needed to deploy TentaCLAW OS on Kubernetes,
either with raw manifests or with the Helm chart.

## Prerequisites

- Kubernetes cluster v1.25+
- `kubectl` configured to access your cluster
- (Helm path) Helm v3.12+
- (GPU nodes) NVIDIA GPU Operator or device plugin installed
- (Monitoring) prometheus-operator / kube-prometheus-stack (optional)

## Quick Start: Raw Manifests

Raw manifests live in `deploy/kubernetes/`. They are self-contained and require
no additional tooling beyond `kubectl`.

```bash
# 1. Create the namespace
kubectl apply -f deploy/kubernetes/namespace.yaml

# 2. Edit the secret with real credentials (NEVER commit real values)
#    Generate secure tokens:
#    openssl rand -hex 32
cp deploy/kubernetes/secret.yaml /tmp/tentaclaw-secret.yaml
# Edit /tmp/tentaclaw-secret.yaml with your real credentials
kubectl apply -f /tmp/tentaclaw-secret.yaml
rm /tmp/tentaclaw-secret.yaml

# 3. Apply config and workloads
kubectl apply -f deploy/kubernetes/configmap.yaml
kubectl apply -f deploy/kubernetes/gateway-deployment.yaml
kubectl apply -f deploy/kubernetes/gateway-service.yaml
kubectl apply -f deploy/kubernetes/agent-daemonset.yaml

# 4. (Optional) Monitoring
kubectl apply -f deploy/kubernetes/monitoring.yaml

# 5. Verify
kubectl -n tentaclaw get pods
kubectl -n tentaclaw get svc
```

### Label GPU Nodes

Agents only schedule on nodes with the `tentaclaw.io/gpu-node=true` label:

```bash
kubectl label node <gpu-node-name> tentaclaw.io/gpu-node=true
```

## Quick Start: Helm Chart

The Helm chart lives in `deploy/helm/tentaclaw/` and provides a fully
parameterized deployment with sensible defaults.

### Install

```bash
# Default installation
helm install tentaclaw ./deploy/helm/tentaclaw \
  --namespace tentaclaw \
  --create-namespace

# Production installation with custom values
helm install tentaclaw ./deploy/helm/tentaclaw \
  --namespace tentaclaw \
  --create-namespace \
  --set secrets.clusterSecret="$(openssl rand -hex 32)" \
  --set secrets.apiKey="$(openssl rand -hex 32)" \
  --set gateway.replicas=3 \
  --set ingress.enabled=true \
  --set ingress.hostname=api.tentaclaw.io \
  --set ingress.tls=true
```

### Upgrade

```bash
helm upgrade tentaclaw ./deploy/helm/tentaclaw \
  --namespace tentaclaw \
  --reuse-values \
  --set gateway.image=tentaclaw/gateway:v2.1.0
```

### Uninstall

```bash
helm uninstall tentaclaw --namespace tentaclaw
```

**Note:** PersistentVolumeClaims are not deleted on uninstall. Remove them
manually if you want to destroy all data:

```bash
kubectl -n tentaclaw delete pvc --all
```

### Custom Values File

Create a `values-production.yaml` for your environment:

```yaml
gateway:
  replicas: 3
  image: ghcr.io/tentaclaw-os/gateway:v2.0.0
  resources:
    limits:
      cpu: 4000m
      memory: 8Gi
  persistence:
    size: 50Gi
    storageClass: gp3

agent:
  image: ghcr.io/tentaclaw-os/agent:v2.0.0
  gpu:
    count: 2

ingress:
  enabled: true
  className: nginx
  hostname: api.tentaclaw.io
  tls: true
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod

secrets:
  clusterSecret: "<generated-secret>"
  apiKey: "<generated-api-key>"
  databaseUrl: "postgresql://user:pass@db.example.com:5432/tentaclaw"

monitoring:
  enabled: true
```

Then install with:

```bash
helm install tentaclaw ./deploy/helm/tentaclaw \
  --namespace tentaclaw \
  --create-namespace \
  -f values-production.yaml
```

## Key Configuration

| Parameter | Description | Default |
|---|---|---|
| `gateway.replicas` | Number of gateway instances | `1` |
| `gateway.image` | Gateway container image | `tentaclaw/gateway:latest` |
| `gateway.port` | HTTP port | `8080` |
| `gateway.persistence.enabled` | Enable PVC for SQLite data | `true` |
| `gateway.persistence.size` | PVC storage size | `10Gi` |
| `agent.enabled` | Deploy agent DaemonSet | `true` |
| `agent.image` | Agent container image | `tentaclaw/agent:latest` |
| `agent.gpu.enabled` | Request nvidia.com/gpu | `true` |
| `agent.gpu.count` | GPUs per agent pod | `1` |
| `monitoring.enabled` | Enable Prometheus resources | `true` |
| `monitoring.serviceMonitor` | Create ServiceMonitor | `true` |
| `ingress.enabled` | Create Ingress resource | `false` |
| `ingress.hostname` | Ingress hostname | `tentaclaw.local` |
| `ingress.tls` | Enable TLS | `false` |
| `secrets.clusterSecret` | Agent auth token | `CHANGE-ME-...` |
| `secrets.apiKey` | External API key | `CHANGE-ME-...` |

## Architecture

```
                    +-------------------+
                    |     Ingress       |  (optional)
                    +--------+----------+
                             |
                    +--------v----------+
                    |  Gateway Service  |  ClusterIP :8080
                    +--------+----------+
                             |
              +--------------+--------------+
              |              |              |
        +-----v----+  +-----v----+  +------v---+
        | Gateway   |  | Gateway  |  | Gateway  |   Deployment (N replicas)
        | Pod       |  | Pod      |  | Pod      |
        +-----------+  +----------+  +----------+
              |
              | gRPC / HTTP (cluster-internal)
              |
   +----------+----------+----------+
   |          |          |          |
+--v---+ +---v--+ +---v--+ +---v--+
| Agent| | Agent| | Agent| | Agent|   DaemonSet (one per GPU node)
| +GPU | | +GPU | | +GPU | | +GPU |
+------+ +------+ +------+ +------+
```

## Troubleshooting

### Pods stuck in Pending

```bash
# Check events for scheduling issues
kubectl -n tentaclaw describe pod <pod-name>

# Verify GPU node labels
kubectl get nodes -l tentaclaw.io/gpu-node=true

# Check NVIDIA device plugin is running
kubectl -n gpu-operator get pods
```

### Gateway not reachable

```bash
# Check service endpoints
kubectl -n tentaclaw get endpoints tentaclaw-gateway

# Port-forward for local debugging
kubectl -n tentaclaw port-forward svc/tentaclaw-gateway 8080:8080

# View gateway logs
kubectl -n tentaclaw logs -l app.kubernetes.io/component=gateway --tail=100
```

### Agent not connecting to gateway

```bash
# Verify the gateway URL the agent is using
kubectl -n tentaclaw exec <agent-pod> -- env | grep TENTACLAW_GATEWAY_URL

# Check agent logs
kubectl -n tentaclaw logs -l app.kubernetes.io/component=agent --tail=100

# Verify the cluster secret matches
kubectl -n tentaclaw get secret tentaclaw-secrets -o yaml
```
