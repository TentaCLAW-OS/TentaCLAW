# TentaCLAW + Continue.dev

Use your TentaCLAW GPU cluster as the AI backend for Continue.dev in VS Code.

## Setup (30 seconds)

1. Install [Continue](https://continue.dev) in VS Code
2. Open Continue settings (`~/.continue/config.json`)
3. Replace the model config with:

```json
{
  "models": [{
    "title": "TentaCLAW Cluster",
    "provider": "openai",
    "model": "llama3.1:8b",
    "apiBase": "http://YOUR-GATEWAY-IP:8080/v1"
  }]
}
```

4. Done. Your VS Code AI assistant now runs on your own GPUs.

## What Works

- Chat (Cmd+L) — Ask questions, generate code
- Tab autocomplete — Code suggestions as you type
- Codebase indexing — RAG over your project via embeddings
- Inline editing — Select code, ask to modify

## Tips

- Use `codellama:7b` for fast autocomplete
- Use `deepseek-r1:70b` for complex reasoning
- Use `nomic-embed-text` for codebase indexing
- TentaCLAW routes to the best node automatically

## Example Config

See `config.json` in this directory for a complete configuration.

---

*TentaCLAW says: "Your code editor. My GPUs. Zero API fees. Forever."*
