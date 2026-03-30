# LoRA Adapter Marketplace

Fine-tuned model adapters you can hot-swap on any base model.

## What Are Adapters?

A LoRA adapter is a small file (50-200MB) that modifies a base model's behavior for a specific domain. Instead of downloading a whole new model, you:

1. Load the base model once (e.g., Llama 3.1 8B)
2. Swap adapters per-request based on the task

## Available Adapters

| Adapter | Base Model | Domain | Quality Boost |
|---------|-----------|--------|---------------|
| customer-service | llama3.1:8b | Support responses | +12% on CSAT |
| legal-language | llama3.1:8b | Legal documents | +18% precision |
| medical-terminology | llama3.1:8b | Clinical text | +15% accuracy |
| code-python | deepseek-r1:8b | Python generation | +10% pass rate |
| code-typescript | deepseek-r1:8b | TypeScript | +11% pass rate |
| sql-expert | llama3.1:8b | SQL queries | +20% correct |
| financial-analysis | llama3.1:70b | Finance reports | +14% accuracy |
| creative-writing | llama3.1:8b | Fiction/creative | +25% human pref |
| concise-responses | llama3.1:8b | Short answers | 40% shorter |
| tutoring | llama3.1:8b | Education | +22% comprehension |

## Install & Use

```bash
# Install an adapter
clawtopus hub install @tentaclaw/adapter-customer-service

# List installed adapters
clawtopus adapters

# Use adapter in API request
curl -X POST http://gateway:8080/v1/chat/completions \
  -H "X-TentaCLAW-Adapter: customer-service" \
  -d '{"model": "llama3.1:8b", "messages": [...]}'

# Hot-swap adapters per request — no model reload needed!
```

## How Hot-Swap Works

1. Base model stays loaded in GPU memory
2. LoRA adapter weights are tiny (~50MB)
3. On request with adapter header, weights are merged on-the-fly
4. Different requests can use different adapters simultaneously
5. vLLM supports this natively with `--enable-lora`

## Create Your Own

```bash
# Fine-tune to create an adapter
clawtopus finetune create \
  --base llama3.1:8b \
  --data ./my-domain-data.jsonl \
  --method qlora \
  --output my-custom-adapter

# Publish to CLAWHub
cd my-custom-adapter
clawtopus hub publish
```

---

*CLAWtopus says: "One base model. Twenty personalities. That's efficiency."*
