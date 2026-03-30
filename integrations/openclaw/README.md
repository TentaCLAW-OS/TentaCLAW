# TentaCLAW GPU Cluster Skill for OpenClaw

Manage TentaCLAW GPU inference clusters through natural language in OpenClaw. Deploy models, monitor node health, route inference requests, and manage your entire GPU cluster without leaving your terminal.

## Prerequisites

- A running [TentaCLAW OS](https://github.com/TentaCLAW-OS/tentaclaw-os) gateway (v0.1.0+)
- `curl` and `jq` installed on your system
- OpenClaw with skill support enabled

## Installation

### Option A: Install from CLAWHub (recommended)

```bash
clawhub install tentaclaw-gpu-cluster
```

This downloads and installs the skill into your OpenClaw skills directory automatically.

### Option B: Manual installation

Copy the `SKILL.md` file to your OpenClaw skills directory:

```bash
# Linux / macOS
cp SKILL.md ~/.openclaw/skills/tentaclaw-gpu-cluster.md

# Windows
copy SKILL.md %USERPROFILE%\.openclaw\skills\tentaclaw-gpu-cluster.md
```

Or clone the full integration:

```bash
git clone https://github.com/TentaCLAW-OS/tentaclaw-os.git
cp tentaclaw-os/integrations/openclaw/SKILL.md ~/.openclaw/skills/tentaclaw-gpu-cluster.md
```

## Configuration

Set the `TENTACLAW_GATEWAY` environment variable to point at your TentaCLAW gateway:

```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
export TENTACLAW_GATEWAY="http://localhost:8080"
```

For remote clusters:

```bash
export TENTACLAW_GATEWAY="http://192.168.1.100:8080"
```

Verify the connection:

```bash
curl -s $TENTACLAW_GATEWAY/api/v1/health/score | jq
```

You should see a JSON response with the cluster health score.

## Usage Examples

Once installed, you can manage your TentaCLAW cluster using natural language in OpenClaw:

### Cluster overview

> "How's my GPU cluster doing?"

> "Show me the cluster status"

> "What nodes are in the cluster?"

### Model deployment

> "Deploy llama 3.1 8B to my cluster"

> "What models can my hardware run?"

> "How much VRAM would mistral-7b need at Q4_K_M?"

> "Deploy the recommended models for my cluster"

### Health monitoring

> "Check GPU temperatures across the cluster"

> "Are there any alerts on the cluster?"

> "What's the health score?"

> "Show me the cluster topology"

### Inference

> "Run a test inference on llama — ask it to explain quantum computing"

> "What models are currently loaded and ready?"

> "What's the inference latency looking like?"

### Capacity planning

> "What models fit my hardware?"

> "Estimate VRAM for llama-3.1-70b at Q4_K_M"

> "Search for coding models I can deploy"

## Helper Scripts

The `scripts/` directory includes standalone shell scripts for common operations:

| Script | Description |
|--------|-------------|
| `scripts/check-health.sh` | Quick cluster health check with node details and alerts |
| `scripts/deploy-model.sh` | Deploy a model with pre-flight VRAM and health checks |

### Running the scripts

```bash
# Health check
./scripts/check-health.sh

# Deploy a model
./scripts/deploy-model.sh llama-3.1-8b-q4_k_m

# Deploy with specific quantization
./scripts/deploy-model.sh mistral-7b Q5_K_M
```

## How It Works

The skill teaches OpenClaw how to interact with the TentaCLAW gateway REST API. When you ask a question about your GPU cluster, OpenClaw:

1. Matches your intent against the skill's trigger phrases
2. Translates your natural language request into the appropriate API call(s)
3. Executes the commands against your TentaCLAW gateway
4. Formats and explains the results

The skill uses the OpenAI-compatible `/v1/chat/completions` endpoint for inference, so any tooling built for OpenAI's API works seamlessly with TentaCLAW.

## Troubleshooting

### "Gateway unreachable"

- Verify the TentaCLAW gateway is running: `systemctl status tentaclaw-gateway`
- Check the `TENTACLAW_GATEWAY` environment variable is set correctly
- Ensure there are no firewall rules blocking the gateway port (default: 8080)

### "No models available"

- The cluster has no models deployed yet. Ask OpenClaw: "What models can my hardware run?" then deploy one.

### Skill not triggering

- Verify the skill file is in the correct directory: `ls ~/.openclaw/skills/`
- Restart OpenClaw after adding the skill
- Use explicit trigger phrases like "gpu cluster" or "tentaclaw"

## License

This integration is part of [TentaCLAW OS](https://github.com/TentaCLAW-OS/tentaclaw-os) and is released under the same license as the parent project.
