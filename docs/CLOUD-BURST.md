# Cloud Burst

When your local cluster is full, TentaCLAW overflows to cloud GPU providers. Your users never know.

## How It Works

1. Request arrives at gateway
2. Local cluster is at capacity (all GPUs busy, queue full)
3. TentaCLAW routes to cloud provider (RunPod, Lambda, Together, Groq)
4. Response returns to user — same API, same format
5. `_tentaclaw.burst: true` in metadata tells you it was cloud-served

## Setup

```bash
# Add a cloud provider
curl -X POST http://gateway:8080/api/v1/burst/providers \
  -d '{"name": "runpod", "type": "runpod", "apiKey": "rp_xxx", "enabled": true}'

# Set burst policy
curl -X PUT http://gateway:8080/api/v1/burst/policy \
  -d '{
    "enabled": true,
    "triggerConditions": { "queueDepth": 10, "allNodesAtCapacity": true },
    "maxCostPerDay": 50,
    "preferLocal": true
  }'

# Check status
clawtopus burst status
clawtopus burst savings
```

## Supported Providers

| Provider | Models | Cost | Best For |
|----------|--------|------|----------|
| RunPod | All (OpenAI-compat) | $0.10-0.50/M tok | General inference |
| Lambda Labs | Llama, Mistral | $0.10-0.30/M tok | Large models |
| Together AI | 100+ models | $0.10-2.00/M tok | Wide selection |
| Groq | Llama, Mixtral | $0.05-0.30/M tok | Fastest latency |
| OpenRouter | 200+ models | Varies | Maximum compatibility |
| Custom | Any OpenAI-compat | Custom | Self-hosted cloud |

## Cost Controls

- **Max cost per hour**: Stop bursting when hourly limit hit
- **Max cost per day**: Daily spending cap
- **Prefer local**: Always try local cluster first
- **Provider priority**: Try cheapest provider first

## Savings Report

```bash
clawtopus burst savings
# This month: 95% local ($0), 5% cloud ($23)
# If 100% cloud: $460
# You saved: $437
```

---

*CLAWtopus says: "My cluster is full? Fine. I'll rent some muscle. But I prefer the family's GPUs."*
