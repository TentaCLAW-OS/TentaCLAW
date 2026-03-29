# TentaCLAW OS Release Copy

## Release Title
**TentaCLAW OS v0.2.0 — HiveOS for AI inference clusters**

## Short Release Subtitle
Turn your pile of GPUs into a self-managing local AI cluster.

## GitHub Release Summary
TentaCLAW OS is **HiveOS for AI inference clusters**.

It gives local AI builders a missing operating layer: bootable node setup, LAN auto-discovery, cluster registration, dashboard visibility, model deployment, and a CLI to run the whole tank.

If you already own GPUs, this is the software layer that helps them behave like a cluster instead of a pile of machines.

**Eight arms. One mind.**

## What’s in v0.2.0

### Core platform
- HiveMind Gateway with dashboard, REST API, SSE, and OpenAI-compatible endpoints
- Agent daemon with auto-discovery, stats push, command execution, and mock mode
- CLAWtopus CLI for routing, deployment, cluster health, models, alerts, tags, and benchmarks
- Shared type contract across gateway, agent, and CLI

### Launch-ready features
- Inference Playground in the dashboard
- Node tagging for production / staging / inference grouping
- SSH key management via API
- Model pull progress tracking
- Daphney bridge SSE endpoint
- Model search with VRAM fit checks
- 52 passing tests across gateway and agent

## Why this exists
Local AI has matured fast.
Local AI operations have not.

A lot of people already have consumer GPUs, retired mining rigs, side machines, or homelab boxes that could run inference. The missing piece is software that makes them easy to boot, join, observe, and manage as one cluster.

That’s the job TentaCLAW OS is built to do.

## Quick Start

### Production node flow
1. Download the ISO
2. Flash it to USB
3. Boot your node
4. Let CLAWtopus handle discovery and registration
5. Deploy a model from the dashboard or CLI

### Dev flow
Run the gateway plus one or more mock agents to test the whole stack without needing real GPUs.

See:
- [README.md](../README.md)
- [docs/QUICKSTART.md](./QUICKSTART.md)
- [BUILD.md](../BUILD.md)

## Suggested Release Highlights Block
Use this near the top of the GitHub release page:

- **HiveOS for AI inference clusters**
- **Flash, boot, deploy**
- **Dashboard + CLI**
- **Auto-discovery on LAN**
- **Mock mode for testing without GPUs**
- **CLAWtopus included**

## One-Paragraph Release Version
TentaCLAW OS v0.2.0 is a major step toward a real operating layer for local AI clusters: gateway, agent, dashboard, CLI, LAN auto-discovery, node health, tags, alerts, model deployment, and a mock mode for testing the stack without GPUs. If HiveOS made mining rigs manageable, TentaCLAW OS aims to do the same for AI inference nodes.

## Social-Friendly Release Pull Quote
> TentaCLAW OS is HiveOS for AI inference clusters.

## CTA Lines
- Download it, boot a node, and see if your GPUs behave better with tentacles.
- Try the mock mode if you want the full stack without the hardware.
- If you run a homelab or local AI stack, we want your feedback.

## Comment Template for Release Thread
If you’re trying it, tell us:
- what hardware you used
- whether you ran ISO or mock mode
- what broke first
- what felt magical

That feedback is gold right now.
