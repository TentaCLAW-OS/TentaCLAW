# TentaCLAW Python SDK

Python client for [TentaCLAW OS](https://tentaclaw.io) -- manage your GPU inference cluster from Python.

```
pip install tentaclaw
```

## Quick Start

```python
from tentaclaw import TentaCLAW

tc = TentaCLAW("http://localhost:8080")

# Check connectivity
assert tc.ping()

# Cluster overview
summary = tc.cluster.summary()
print(f"Nodes: {summary['online_nodes']}, GPUs: {summary['total_gpus']}")
```

## Chat Completions

TentaCLAW exposes an OpenAI-compatible `/v1/chat/completions` endpoint. The SDK wraps it with a clean interface:

```python
# Simple chat
response = tc.chat("llama3.1:8b", "Explain GPU clustering in one paragraph")
print(response.content)
print(f"Tokens used: {response.usage}")

# With system prompt
response = tc.chat(
    "deepseek-r1:70b",
    "What is VRAM fragmentation?",
    system_prompt="You are a GPU infrastructure expert. Be concise.",
    temperature=0.3,
)
print(response.content)
```

### Streaming

```python
for chunk in tc.chat("llama3.1:8b", "Tell me a story about a GPU farm", stream=True):
    print(chunk, end="", flush=True)
print()
```

## Model Management

```python
# List deployed models
models = tc.models.list()

# Deploy a model
tc.models.deploy("deepseek-r1:70b")

# Deploy to a specific node
tc.models.deploy("llama3.1:8b", node_id="node-gpu-01")

# Search available models
results = tc.models.search("codellama")

# Get VRAM estimate before deploying
estimate = tc.models.estimate_vram("mixtral:8x7b", quantization="Q4_K_M")
print(f"Estimated VRAM: {estimate['vram_mb']} MB")

# Get recommendations based on available VRAM
recs = tc.models.recommend(vram_mb=24000)
```

## Node Management

```python
# List all nodes
nodes = tc.nodes.list()
for node in nodes:
    print(f"{node['node_id']}: {node['status']}")

# Get node details
node = tc.nodes.get("node-gpu-01")

# Register a new node
tc.nodes.register(
    node_id="node-gpu-03",
    farm_hash="abc123",
    hostname="gpu-server-03.local",
    gpu_count=4,
)

# Tag nodes for organization
tc.nodes.add_tag("node-gpu-01", "production")
tags = tc.nodes.tags("node-gpu-01")
```

## Cluster Health and Monitoring

```python
# Health score (0-100)
health = tc.cluster.health()
print(f"Cluster health: {health['score']}/100")

# Detailed health breakdown
detailed = tc.cluster.health_detailed()

# Capacity overview
capacity = tc.cluster.capacity()

# Power consumption
power = tc.cluster.power()

# Export full cluster config
config = tc.cluster.export_config()
```

## Alerts

```python
# List active alerts
alerts = tc.alerts.list()

# Create an alert rule
tc.alerts.create_rule(
    name="High GPU temp",
    metric="gpu_temperature",
    operator=">",
    threshold=85.0,
    severity="critical",
)

# List alert rules
rules = tc.alerts.rules()
```

## Embeddings

```python
# Generate embeddings
result = tc.embed("nomic-embed-text", "TentaCLAW manages GPU clusters")

# Batch embeddings
result = tc.embed("nomic-embed-text", [
    "First document",
    "Second document",
    "Third document",
])
```

## Authentication

If your TentaCLAW gateway requires an API key:

```python
tc = TentaCLAW("http://localhost:8080", api_key="your-api-key")
```

## Error Handling

```python
from tentaclaw import TentaCLAW, TentaCLAWError

tc = TentaCLAW("http://localhost:8080")

try:
    tc.models.deploy("nonexistent-model:latest")
except TentaCLAWError as e:
    print(f"Status: {e.status_code}")
    print(f"Path: {e.path}")
    print(f"Message: {e.message}")
```

## Configuration

| Parameter     | Default                  | Description                    |
|---------------|--------------------------|--------------------------------|
| `gateway_url` | `http://localhost:8080`  | TentaCLAW gateway URL          |
| `api_key`     | `None`                   | Bearer token for auth          |
| `timeout`     | `30`                     | Request timeout in seconds     |

## Requirements

- Python 3.9+
- `requests` >= 2.28.0

## License

Apache 2.0
