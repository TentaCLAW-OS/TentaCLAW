---
name: tentaclaw-gpu-cluster
description: Manage TentaCLAW GPU inference clusters — deploy models, check health, route inference, monitor nodes
triggers:
  - gpu cluster
  - deploy model
  - inference cluster
  - tentaclaw
  - gpu health
  - model deployment
  - cluster status
metadata:
  openclaw:
    requires:
      - curl
    allowed-tools:
      - Read
      - Write
      - Bash
---

# TentaCLAW GPU Cluster Management

You are managing a TentaCLAW OS GPU inference cluster. TentaCLAW coordinates multiple GPU nodes for distributed AI inference, handling model deployment, health monitoring, load balancing, and fault tolerance across heterogeneous GPU hardware.

## Setup

The TentaCLAW gateway runs at the URL in the `TENTACLAW_GATEWAY` environment variable (default: `http://localhost:8080`).

Before running any commands, verify connectivity:

```bash
curl -sf ${TENTACLAW_GATEWAY:-http://localhost:8080}/api/v1/health/score > /dev/null && echo "Gateway reachable" || echo "Gateway unreachable"
```

## Available Commands

### Check cluster status
```bash
curl -s $TENTACLAW_GATEWAY/api/v1/summary | jq
```

Returns an overview of the cluster: total nodes, loaded models, aggregate VRAM, active inference requests, and overall health score.

### List nodes
```bash
curl -s $TENTACLAW_GATEWAY/api/v1/nodes | jq
```

Returns all registered GPU nodes with their status, GPU model, VRAM capacity, VRAM usage, temperature, and currently loaded models.

### List loaded models
```bash
curl -s $TENTACLAW_GATEWAY/api/v1/models | jq '.models'
```

Returns all models currently loaded across the cluster, including which nodes host each model and their ready state.

### Deploy a model
```bash
curl -s -X POST $TENTACLAW_GATEWAY/api/v1/deploy \
  -H "Content-Type: application/json" \
  -d '{"model":"MODEL_NAME"}' | jq
```

Deploys a model to the cluster. The gateway selects the optimal node(s) based on available VRAM, GPU capability, and current load. Replace `MODEL_NAME` with the model identifier (e.g., `llama-3.1-8b-q4_k_m`, `mistral-7b-q5_k_m`).

Optional fields:
- `"quantization"`: Override quantization (e.g., `"Q4_K_M"`, `"Q5_K_S"`, `"Q8_0"`)
- `"node"`: Pin deployment to a specific node ID
- `"replicas"`: Number of replicas for high availability (default: 1)

### Undeploy a model
```bash
curl -s -X POST $TENTACLAW_GATEWAY/api/v1/undeploy \
  -H "Content-Type: application/json" \
  -d '{"model":"MODEL_NAME"}' | jq
```

### Check health
```bash
curl -s $TENTACLAW_GATEWAY/api/v1/health/score | jq
```

Returns the cluster health score (0-100) and per-node health breakdown. Scores below 70 indicate degraded performance; below 40 indicates critical issues.

### Run inference
```bash
curl -s -X POST $TENTACLAW_GATEWAY/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"MODEL","messages":[{"role":"user","content":"PROMPT"}]}'
```

OpenAI-compatible inference endpoint. The gateway routes the request to the best available node hosting the requested model. Replace `MODEL` with the deployed model name and `PROMPT` with the user's input.

Additional parameters:
- `"temperature"`: Sampling temperature (default: 0.7)
- `"max_tokens"`: Maximum tokens to generate
- `"stream"`: Set to `true` for streaming responses

### Search for models
```bash
curl -s "$TENTACLAW_GATEWAY/api/v1/model-search?q=QUERY" | jq
```

Searches the model registry for available models matching the query. Returns model name, parameter count, recommended quantization, and estimated VRAM requirements.

### Get model recommendations
```bash
curl -s $TENTACLAW_GATEWAY/api/v1/models/recommend | jq
```

Returns model recommendations based on the cluster's current available VRAM and GPU capabilities. Useful for discovering what models the cluster can handle.

### Check VRAM estimate
```bash
curl -s "$TENTACLAW_GATEWAY/api/v1/models/estimate-vram?model=MODEL&quantization=Q4_K_M" | jq
```

Estimates VRAM requirements for a model at a given quantization level. Use this before deploying to verify the cluster has sufficient capacity.

### View alerts
```bash
curl -s $TENTACLAW_GATEWAY/api/v1/alerts | jq
```

Returns active alerts: thermal warnings, VRAM pressure, node disconnections, inference errors, and model loading failures.

### View cluster topology
```bash
curl -s $TENTACLAW_GATEWAY/api/v1/topology | jq
```

Returns the full cluster topology: node interconnections, network bandwidth between nodes, and tensor parallelism groups.

### Get node details
```bash
curl -s $TENTACLAW_GATEWAY/api/v1/nodes/NODE_ID | jq
```

Returns detailed information for a specific node including GPU specs, running processes, loaded models, and performance metrics.

### View inference metrics
```bash
curl -s $TENTACLAW_GATEWAY/api/v1/metrics | jq
```

Returns cluster-wide inference metrics: requests per second, average latency, tokens per second, queue depth, and error rates.

## Rules

1. Always check cluster health before deploying models
2. Use the model recommendation endpoint to find what fits the current hardware
3. Always verify deployment success after deploying — check that the model appears in the models list with a ready state
4. Report GPU temperatures if they are above 85C as a warning
5. Use jq to format JSON output for readability
6. Before deploying, estimate VRAM to confirm the cluster has capacity
7. If health score is below 40, alert the user and investigate alerts before proceeding
8. When multiple models are requested, deploy them sequentially and verify each one
9. Always use the `TENTACLAW_GATEWAY` environment variable — never hardcode the gateway URL
10. If the gateway is unreachable, suggest checking that the TentaCLAW service is running and the gateway URL is correct
