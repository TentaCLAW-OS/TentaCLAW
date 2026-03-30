# CLAWHub Stacks

Stacks are bundled deployment manifests that install entire inference pipelines with a single command. Instead of configuring individual models, backends, and services one at a time, a stack gives you a complete, tested, ready-to-run AI setup.

## What is a Stack?

A stack is a `.clawhub.yaml` manifest with `type: stack` that declares:

- **Components** -- the models, their backends, replica counts, and GPU memory requirements
- **Config** -- pipeline-specific settings (chunking params, voice pipeline config, routing rules, etc.)
- **Cluster requirements** -- minimum VRAM needed to run the full stack

Stacks are opinionated but configurable. They ship with sensible defaults so you can deploy immediately and tune later.

## Available Stacks

| Stack | Description | Min VRAM |
|-------|-------------|----------|
| `@tentaclaw/homelab-starter-stack` | One small model, perfect for beginners | 8 GB |
| `@tentaclaw/rag-stack` | Embedding + chat + reranker for RAG pipelines | 24 GB |
| `@tentaclaw/code-assistant-stack` | Chat + autocomplete + embeddings with Continue.dev | 16 GB |
| `@tentaclaw/voice-ai-stack` | Whisper STT + chat + Kokoro TTS | 16 GB |
| `@tentaclaw/multi-modal-stack` | Text + vision + image gen + voice | 24 GB |
| `@tentaclaw/enterprise-chat-stack` | 70B chat + routing + rate limiting + API keys | 128 GB |
| `@tentaclaw/research-stack` | 70B reasoning + web search + citations | 64 GB |
| `@tentaclaw/privacy-stack` | Air-gapped, encrypted, HIPAA-ready | 16 GB |

## Usage

### Deploy a stack

```bash
tentaclaw stack deploy @tentaclaw/rag-stack
```

### Deploy with overrides

```bash
tentaclaw stack deploy @tentaclaw/rag-stack \
  --set chat-model.replicas=4 \
  --set config.chunk_size=1024
```

### Preview what a stack will deploy

```bash
tentaclaw stack plan @tentaclaw/rag-stack
```

This shows the components, resource requirements, and whether your cluster has enough VRAM before deploying anything.

### Check stack status

```bash
tentaclaw stack status @tentaclaw/rag-stack
```

### Tear down a stack

```bash
tentaclaw stack destroy @tentaclaw/rag-stack
```

## Stack Manifest Structure

Every stack manifest follows this structure:

```yaml
name: "@tentaclaw/my-stack"
version: "1.0.0"
type: stack
title: "Human-Readable Title"
description: "What this stack does."
license: MIT
author:
  name: Your Name
publisher: tentaclaw

stack:
  components:
    - name: component-name
      model: "model-name:tag"
      backend: ollama | auto | vllm | llama-cpp
      replicas: 1
      resources: { gpuMemory: "8Gi" }
      description: "What this component does."

  config:
    # Stack-specific configuration
    key: value

  minimum_cluster_vram: "24GB"
  estimated_total_vram: "20GB"
```

### Key fields

- **`type: stack`** -- identifies this as a stack manifest (as opposed to a model, skill, or agent)
- **`stack.components`** -- the list of models/services to deploy
  - `backend: auto` lets TentaCLAW pick the best available backend
  - `replicas` controls horizontal scaling
  - `resources.gpuMemory` declares the GPU memory each replica needs
- **`stack.config`** -- arbitrary configuration passed to the stack's runtime
- **`minimum_cluster_vram`** -- the smallest cluster that can run this stack
- **`estimated_total_vram`** -- expected VRAM usage across all components

## Creating Custom Stacks

1. Create a `.clawhub.yaml` file with `type: stack`
2. Define your components and config
3. Test locally with `tentaclaw stack plan ./my-stack.clawhub.yaml`
4. Deploy with `tentaclaw stack deploy ./my-stack.clawhub.yaml`
5. Publish to CLAWHub with `tentaclaw publish ./my-stack.clawhub.yaml`

## Recommended Path

If you are just getting started:

1. Start with **homelab-starter-stack** to verify your setup works
2. Move to **rag-stack** or **code-assistant-stack** once you want more capability
3. Scale to **enterprise-chat-stack** or **research-stack** when you need production-grade deployments
