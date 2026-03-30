# BitNet CPU Inference Guide

> **No GPU? No problem. CLAWtopus has CPUs for that.**

---

## What is BitNet?

BitNet is Microsoft's **1-bit large language model** architecture. Instead of storing each weight as a 16-bit or 32-bit float, BitNet uses ternary weights (-1, 0, 1). This means:

- **2-6x faster inference** on CPUs compared to FP16
- **~70% less energy** consumption
- **No GPU required** -- runs on any x86_64 CPU
- **Dramatically smaller** model files (a 3B param model is ~400MB)

BitNet models are not quantized versions of existing models. They are trained from scratch with 1-bit weights, so they don't suffer the quality degradation you see with aggressive quantization.

---

## Supported Models

| Model | Parameters | Size on Disk | Description |
|-------|-----------|-------------|-------------|
| `bitnet-b1.58-2B` | 2B | ~400 MB | Smaller model, faster inference, good for simple tasks |
| `bitnet-b1.58-8B` | 8B | ~1.5 GB | Larger model, better quality, still runs on CPU |

These are the Microsoft 1bitLLM models compiled for the BitNet inference engine (built on llama.cpp with custom 1-bit kernels).

---

## How BitNet Works in TentaCLAW

TentaCLAW treats BitNet as just another inference backend, alongside Ollama, vLLM, and llama.cpp. The integration is automatic:

1. **Auto-detection**: When an agent starts on a machine with no GPU (or where BitNet is explicitly installed), the agent detects the BitNet binary and reports `backend: { type: "bitnet", port: 8082 }` to the gateway.

2. **Dedicated port**: BitNet runs on **port 8082** (separate from Ollama on 11434). The agent manages the BitNet server lifecycle alongside other backends.

3. **Transparent routing**: The gateway routes inference requests to BitNet nodes the same way it routes to GPU nodes. If you request a BitNet model, the gateway finds a node running it and proxies the request.

4. **OpenAI-compatible**: BitNet serves a llama.cpp-compatible API, which means the same `/v1/chat/completions` endpoint works for both GPU and CPU inference.

```
Client Request                    TentaCLAW Gateway
    |                                   |
    |  POST /v1/chat/completions        |
    |  model: "bitnet-b1.58-2B"         |
    |---------------------------------->|
    |                                   |
    |          findBestNode("bitnet-b1.58-2B")
    |                                   |
    |          Routes to CPU node       |
    |          (port 8082)              |
    |                                   |
    |  <-- response ------------------- |
```

---

## Setup

### Automatic (recommended)

On nodes without a GPU, the TentaCLAW agent can install and start BitNet automatically. When you boot a TentaCLAW OS node with no detected GPU, the boot scripts check for BitNet and set it up if available.

### Manual Installation

BitNet builds from Microsoft's open-source repo:

```bash
# 1. Clone the repo
git clone https://github.com/Microsoft/BitNet.git /opt/bitnet

# 2. Install Python dependencies
cd /opt/bitnet
pip install -r requirements.txt

# 3. Build the inference engine (downloads model + compiles llama.cpp with BitNet kernels)
python setup_env.py --hf-repo 1bitLLM/bitnet_b1_58-3B -q i2_s
```

This produces the binary at `/opt/bitnet/build/bin/run_inference`.

The agent checks these paths for a BitNet binary:
- `/opt/bitnet/build/bin/run_inference`
- `/usr/local/bin/bitnet-server`
- `/opt/tentaclaw/bitnet/run_inference`

### Starting the Server

The agent manages the BitNet server automatically. But if you need to start it manually:

```bash
/opt/bitnet/build/bin/run_inference \
  --model bitnet-b1.58-2B \
  --threads $(nproc --ignore=2) \
  --port 8082
```

The agent reserves 2 CPU cores for the OS and uses the rest for inference.

---

## Deploying a BitNet Model

Via CLI:

```bash
clawtopus deploy bitnet-b1.58-2B
```

Via API:

```bash
curl -X POST http://localhost:8080/api/v1/deploy \
  -H "Content-Type: application/json" \
  -d '{"model": "bitnet-b1.58-2B"}'
```

The gateway will route this to a node running the BitNet backend.

---

## Running Inference

Once deployed, use the standard OpenAI-compatible endpoint:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bitnet-b1.58-2B",
    "messages": [{"role": "user", "content": "Explain 1-bit quantization."}]
  }'
```

Or via the CLI:

```bash
clawtopus chat --model bitnet-b1.58-2B
```

---

## Performance Expectations

BitNet inference is CPU-bound. Performance depends on core count and CPU generation.

| CPU | Threads | Model | Approximate tok/s |
|-----|---------|-------|--------------------|
| Ryzen 7 5800X (8C/16T) | 14 | bitnet-b1.58-2B | ~40-60 tok/s |
| Xeon E5-2690 v4 (14C/28T) | 26 | bitnet-b1.58-2B | ~30-50 tok/s |
| i7-13700K (16C/24T) | 22 | bitnet-b1.58-8B | ~15-25 tok/s |
| Ryzen 9 7950X (16C/32T) | 30 | bitnet-b1.58-8B | ~25-40 tok/s |

These are rough estimates. Real performance varies with prompt length, generation length, and system load.

---

## GPU vs CPU (BitNet) Inference

| | GPU (Ollama/vLLM) | CPU (BitNet) |
|---|---|---|
| **Hardware** | NVIDIA/AMD GPU required | Any x86_64 CPU |
| **Model types** | Any GGUF/safetensors model | BitNet 1-bit models only |
| **Model quality** | Full precision or quantized | 1-bit (trained from scratch, not quantized) |
| **Speed (8B model)** | 50-120 tok/s (RTX 3090) | 15-40 tok/s (modern CPU) |
| **VRAM/RAM usage** | 6-48 GB VRAM depending on model | 0.4-1.5 GB RAM |
| **Energy** | 150-350W per GPU | 65-125W total system |
| **Cost to add a node** | $500-2000 (used GPU) | $0 (any spare machine) |
| **Best for** | Large models, high throughput | Small/medium models, energy efficiency, spare hardware |

### When to use BitNet

- You have machines without GPUs sitting idle
- You want to add inference capacity without buying GPUs
- Energy cost matters (data center, homelab power bills)
- You need lightweight models for simple tasks (classification, summarization, basic chat)

### When to use GPU inference

- You need large models (70B+)
- You need maximum throughput
- You need the widest model compatibility
- Quality is the top priority

---

## Checking BitNet Status

Via CLI:

```bash
clawtopus backends
```

Look for nodes with `backend: bitnet` in the output.

Via API:

```bash
curl http://localhost:8080/api/v1/inference/backends
```

Nodes running BitNet will report:

```json
{
  "node_id": "NODE-003",
  "hostname": "cpu-worker-01",
  "backend": {
    "type": "bitnet",
    "port": 8082,
    "version": "1.0"
  },
  "gpu_count": 0,
  "models": ["bitnet-b1.58-2B"]
}
```

---

## Mixed Clusters

TentaCLAW handles heterogeneous clusters natively. You can have GPU nodes running Ollama alongside CPU nodes running BitNet. The gateway routes each request to the right backend based on which node has the requested model loaded.

```
                      TentaCLAW Gateway
                           |
              +------------+------------+
              |            |            |
         GPU Node 1   GPU Node 2   CPU Node 3
         (Ollama)     (Ollama)     (BitNet)
         RTX 4090     RTX 3090     Ryzen 7
         llama3:70b   llama3:8b    bitnet-b1.58-2B
```

A request for `llama3:70b` goes to Node 1. A request for `bitnet-b1.58-2B` goes to Node 3. The client doesn't need to know or care.

---

*CLAWtopus says: "1-bit weights, 8 arms, zero excuses."*
