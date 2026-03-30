# Namespaces & Multi-Tenancy

Isolate teams, track usage, enforce quotas. Every enterprise needs this.

## Quick Start

```bash
# Create a namespace for your ML team
clawtopus namespace create ml-team

# Set resource quotas
curl -X PUT http://gateway:8080/api/v1/namespaces/ml-team/quota \
  -d '{"maxGpus": 4, "maxVramMb": 98304, "maxModels": 10, "maxRequestsPerMin": 1000}'

# Assign nodes to namespace
curl -X POST http://gateway:8080/api/v1/namespaces/ml-team/nodes \
  -d '{"nodeId": "gpu-rig-01"}'

# Deploy within namespace
clawtopus --namespace ml-team deploy llama3.1:8b

# View usage report
clawtopus --namespace ml-team usage
```

## Concepts

### Namespaces
A namespace is an isolated environment within your cluster. Each namespace has:
- Its own models and deployments
- Resource quotas (GPUs, VRAM, request rate)
- API keys scoped to the namespace
- Usage tracking for chargeback

### Default Namespace
All resources start in the `default` namespace. Existing setups work unchanged.

### Quotas

| Quota | Description | Example |
|-------|-------------|---------|
| maxGpus | Maximum GPUs across all deployments | 4 |
| maxVramMb | Maximum VRAM allocation | 98304 (96 GB) |
| maxModels | Maximum loaded models | 10 |
| maxRequestsPerMin | Rate limit | 1000 |
| maxStorageMb | Model storage quota | 102400 (100 GB) |

### Chargeback

Track per-namespace usage for internal billing:

```bash
# Monthly usage report
clawtopus --namespace ml-team usage --period 2026-03

# Export for finance
clawtopus --namespace ml-team usage --period 2026-03 --format csv > ml-team-march.csv
```

Fields tracked: GPU-hours, VRAM-hours, tokens generated, requests served, power (kWh), estimated cost.

## RBAC Integration

Namespace permissions integrate with the SSO/RBAC system:
- `namespace-admin` can manage models and API keys within their namespace
- `global-admin` manages namespaces and quotas
- API keys are scoped to a namespace

---

*CLAWtopus says: "Every family has territories. Every territory has a boss. Every boss has a budget."*
