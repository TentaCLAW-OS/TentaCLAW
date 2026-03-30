# Fine-Tuning Guide

Train models on your own data, on your own hardware, with one command.

## Quick Start

```bash
# Fine-tune Llama 3.1 8B with your data
clawtopus finetune create \
  --base meta-llama/Llama-3.1-8B-Instruct \
  --data ./customer-support.jsonl \
  --method qlora \
  --output my-company-llama

# Monitor training
clawtopus finetune status

# Deploy the fine-tuned adapter
clawtopus deploy my-company-llama
```

## Supported Methods

| Method | VRAM Needed | Speed | Quality | Best For |
|--------|------------|-------|---------|----------|
| **QLoRA** | ~14GB for 8B | Fast | Good | Consumer GPUs (RTX 3090, 4090) |
| **LoRA** | ~16GB for 8B | Fast | Very Good | When you have headroom |
| **Full** | ~32GB for 8B | Slow | Best | Multi-GPU, production models |

## Dataset Formats

### ShareGPT (recommended)
```json
{"conversations": [
  {"from": "human", "value": "What is your refund policy?"},
  {"from": "gpt", "value": "Our refund policy allows returns within 30 days..."}
]}
```

### Alpaca
```json
{"instruction": "Summarize this email", "input": "Dear team...", "output": "The email discusses..."}
```

### ChatML
```json
{"messages": [
  {"role": "system", "content": "You are a helpful assistant."},
  {"role": "user", "content": "Hello"},
  {"role": "assistant", "content": "Hi! How can I help?"}
]}
```

## Hardware Requirements

| Model Size | Method | Min VRAM | Recommended |
|-----------|--------|----------|-------------|
| 3B | QLoRA | 6GB | 8GB |
| 7-8B | QLoRA | 12GB | 16GB |
| 13B | QLoRA | 16GB | 24GB |
| 34B | QLoRA | 24GB | 48GB (2 GPUs) |
| 70B | QLoRA | 48GB | 80GB (2-4 GPUs) |

## Hyperparameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Learning Rate | 2e-4 | Lower = more stable, higher = faster |
| Epochs | 3 | More epochs = more memorization risk |
| Batch Size | 4 | Increase if you have VRAM headroom |
| LoRA Rank | 16 | Higher = more capacity, more VRAM |
| LoRA Alpha | 32 | Usually 2x rank |

## Adapter Management

Fine-tuned models are stored as LoRA adapters in CLAWHub:

```bash
# List adapters
clawtopus hub list --type adapter

# Deploy base model + adapter
clawtopus deploy llama3.1:8b --adapter my-company-adapter

# Hot-swap adapters per request
curl -X POST http://gateway:8080/v1/chat/completions \
  -H "X-TentaCLAW-Adapter: my-company-adapter" \
  -d '{"model": "llama3.1:8b", "messages": [...]}'
```

## Tips

- Start with QLoRA on a single GPU — it works surprisingly well
- 1000-5000 examples is usually enough for domain-specific fine-tuning
- Always hold out 10% of data for evaluation
- Use the built-in benchmark runner to compare base vs fine-tuned
- Fine-tune jobs are preemptible — they auto-pause when inference demand spikes

---

*CLAWtopus says: "Your data. Your model. Your hardware. No cloud fees. That's how the family does business."*
