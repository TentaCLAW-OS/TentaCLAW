# Multi-Cluster Federation

Connect multiple TentaCLAW clusters as one unified system.

## Use Cases

- **Home + Office**: GPU rig at home, workstation at office, both in one API
- **Multi-Site**: Clusters in different datacenters with latency-based routing
- **Hybrid Cloud**: Local cluster + cloud burst cluster, federated
- **Team Isolation**: Each team gets their own cluster, federated for overflow

## Setup

```bash
# On the primary cluster, register remote clusters
curl -X POST http://gateway:8080/api/v1/federation/clusters \
  -d '{
    "name": "office-cluster",
    "gatewayUrl": "https://office.internal:8080",
    "location": "office",
    "apiKey": "office-cluster-api-key"
  }'

# Check federation status
clawtopus federation status

# List all models across all clusters
clawtopus federation models
```

## How Routing Works

1. Request arrives at primary gateway
2. Check local cluster first (always prefer local)
3. If model not available locally → check federated clusters
4. Route to cluster with: model loaded + lowest latency + most capacity
5. Response is transparent — user doesn't know which cluster served it

## Architecture

```
    ┌─────────────┐
    │   Client     │
    └──────┬──────┘
           │
    ┌──────▼──────┐         ┌──────────────┐
    │   Primary    │◄───────►│   Office      │
    │   Gateway    │  HTTP    │   Cluster     │
    │  (home)      │         │  (3 GPUs)     │
    │  5 GPUs      │         └──────────────┘
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Cloud      │
    │   Burst      │
    │  (RunPod)    │
    └─────────────┘
```

## Features

- **Automatic health checking** — Every 30s, verify remote clusters are alive
- **Model replication** — Auto-replicate popular models to multiple clusters
- **Split-brain safe** — Each cluster works independently during network partition
- **Cost-aware** — Prefer local, burst to cheapest remote
- **Latency-based** — Route to closest cluster for lowest latency

---

*CLAWtopus says: "One cluster is a business. Many clusters is an empire."*
