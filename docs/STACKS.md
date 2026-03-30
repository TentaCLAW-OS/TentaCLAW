# CLAWHub Stacks — One-Click Deployment Bundles

Deploy an entire AI stack with one command.

## Available Stacks

| Stack | VRAM | What You Get |
|-------|------|-------------|
| **Homelab Starter** | 8 GB | Gemma 4B — perfect for beginners |
| **Code Assistant** | 16 GB | DeepSeek R1 + autocomplete + embeddings + Continue.dev config |
| **Voice AI** | 16 GB | Whisper STT + LLM + Kokoro TTS — full voice pipeline |
| **Privacy/HIPAA** | 16 GB | Air-gapped, encrypted, zero telemetry, compliant |
| **RAG Pipeline** | 24 GB | Embed + chat (x2) + reranker — complete RAG |
| **Multi-Modal** | 24 GB | Chat + vision + image gen + audio |
| **Research** | 64 GB | DeepSeek R1 70B + web search + citations |
| **Enterprise Chat** | 128 GB | 70B (x2) + routing + rate limits + model aliases |

## Install

```bash
# Install a stack
clawtopus hub install @tentaclaw/rag-stack

# Preview what a stack deploys
clawtopus stacks

# See stack details
clawtopus hub info @tentaclaw/voice-ai-stack
```

## How Stacks Work

A stack is a CLAWHub package of type `stack` that bundles multiple model deployments + configuration. When installed:

1. Each component model is deployed to the best available node
2. Configuration (routing rules, aliases, rate limits) is applied
3. The stack appears as a single unit in the dashboard
4. Remove the stack to clean up all components

---

*CLAWtopus says: "One command. Eight models. Zero configuration. That's a stack."*
