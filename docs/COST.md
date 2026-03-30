# Cost Intelligence

Track your cluster's TCO, compare against cloud providers, and prove ROI.

## Dashboard

```bash
clawtopus cost

  COST INTELLIGENCE

  Power draw            450W
  Monthly electricity   $38.88
  Cost per M tokens     $0.03

  SAVINGS vs CLOUD
  vs OpenAI             $4,658
  vs Anthropic          $5,432
  vs Together           $890
```

## Configuration

```bash
# Set electricity rate
curl -X PUT http://gateway:8080/api/v1/cost/config \
  -d '{
    "electricityCostPerKwh": 0.12,
    "currency": "USD",
    "hardwareCosts": [
      { "nodeId": "gpu-rig-01", "purchasePrice": 4000, "purchaseDate": "2024-06-01", "depreciationYears": 3 }
    ]
  }'
```

## What's Tracked

| Metric | Description |
|--------|-------------|
| Power draw | Real-time watts from GPU + system |
| Electricity cost | $/kWh × actual consumption |
| Hardware amortization | Purchase price / depreciation period |
| Cost per token | (electricity + hardware) / tokens served |
| Cloud comparison | Self-hosted vs OpenAI, Anthropic, Together, RunPod |
| Hardware ROI | "RTX 4090 paid for itself in 47 days" |

## Budget Alerts

```bash
# Set monthly budget
curl -X PUT http://gateway:8080/api/v1/cost/budget \
  -d '{"monthlyLimit": 200}'

# Check status
clawtopus cost
# Shows: "Budget: $142 / $200 (71%) — On track"
```

## Cloud Burst Cost Tracking

When cloud burst is enabled, costs are tracked separately:

```bash
clawtopus burst savings
# This month: 95% local ($0), 5% cloud ($23)
# If 100% cloud: $460
# Saved: $437
```

---

*CLAWtopus says: "Per-token pricing is a scam. Here's the math to prove it."*
