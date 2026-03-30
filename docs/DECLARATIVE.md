# Declarative Deployments

Kubernetes-style desired state management for your AI cluster.

## Quick Start

```yaml
# deployment.yaml
apiVersion: tentaclaw.io/v1
kind: ModelDeployment
metadata:
  name: production-llama
  namespace: default
  labels:
    tier: production
    team: ml-ops
spec:
  model: llama3.1:8b
  quantization: Q4_K_M
  replicas: 3
  backend: auto
  routing:
    strategy: least-latency
    maxLatencyMs: 500
  sla:
    maxLatencyP95Ms: 300
    minAvailabilityPct: 99.9
  nodeSelector:
    gpu: "rtx-4090"
  priority: critical
```

```bash
# Apply the deployment
clawtopus apply -f deployment.yaml

# Check status
clawtopus deployments

# NAME              NAMESPACE  MODEL          PHASE    READY
# production-llama  default    llama3.1:8b    Running  3/3
```

## How It Works

1. You **declare** desired state in YAML
2. TentaCLAW's reconciliation engine **converges** actual state to match
3. Every 15 seconds, the engine checks: are replicas running? SLA met? Nodes healthy?
4. If something drifts — node fails, model crashes, demand spikes — TentaCLAW auto-corrects

## Reconciliation Loop

```
Desired: 3 replicas of llama3.1:8b
Actual:  2 replicas (node-03 went offline)
Action:  Deploy replica to node-04 (best available VRAM)
Result:  3/3 replicas running ✓
```

## Deployment Spec Fields

| Field | Type | Description |
|-------|------|-------------|
| model | string | Model name (Ollama or HuggingFace ID) |
| quantization | string | Q4_K_M, AWQ, GPTQ, FP16, etc. |
| replicas | number | Desired replica count |
| minReplicas | number | Autoscaler minimum (0 = scale-to-zero) |
| maxReplicas | number | Autoscaler maximum |
| backend | string | ollama, vllm, sglang, auto |
| routing.strategy | string | least-latency, round-robin, vram-headroom |
| sla.maxLatencyP95Ms | number | SLA target for p95 latency |
| nodeSelector | map | Label-based node selection |
| priority | string | critical, normal, low |

## Status Conditions

Each deployment tracks conditions:
- **Available** — At least 1 replica is ready
- **Progressing** — Replicas being deployed
- **Degraded** — Fewer ready replicas than desired
- **SLAMet** — Meeting latency/availability targets

## Migration from v2

Old flight sheets still work. The new declarative system adds:
- Automatic reconciliation (no manual re-deploy needed)
- SLA tracking and alerting
- Node affinity and anti-affinity
- Integration with autoscaler

---

*CLAWtopus says: "You declare. I reconcile. Kubernetes wished it could do inference this well."*
