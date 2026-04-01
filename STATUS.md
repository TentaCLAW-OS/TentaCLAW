# TentaCLAW OS — Engineering Status

> Last updated: 2026-04-01 | Version: 0.3.0

Honest status of every component. If it's not listed as **Production**, assume it's not battle-tested yet.

---

## What Works Today

These components are tested, deployed on real hardware, and used in the primary workflow:

| Component | Status | Notes |
|-----------|--------|-------|
| **Gateway** | Production | Hono + SQLite. 215 REST endpoints. OpenAI-compatible API. |
| **Agent** | Production | Node daemon. Auto-discovers gateway via UDP/mDNS/subnet scan. |
| **Dashboard** | Production | React 19 + Vite. Real-time stats via SSE. |
| **CLI** | Production | `tentaclaw status`, `chat`, `nodes`, `models`. Core commands work. |
| **Install Script** | Production | `curl tentaclaw.io/install \| bash` — auto port, Vulkan detection, systemd services. |
| **Ollama Backend** | Production | Primary inference backend. GPU + CPU. Widest model support. |
| **Auto-Discovery** | Production | UDP broadcast (port 41338), mDNS, subnet scan, localhost fallback. |
| **Flight Sheets** | Production | Declarative model deployment across nodes. |
| **OpenAI API** | Production | `/v1/chat/completions`, `/v1/models`, streaming. Drop-in compatible. |

### Supported Hardware (Tested)

| Vendor | Status | Detection | Backend |
|--------|--------|-----------|---------|
| **NVIDIA** | Full | `nvidia-smi` + MIG + NVLink topology | CUDA via Ollama |
| **AMD (RDNA1+)** | Full | `lspci` + sysfs. Auto-selects Vulkan vs ROCm per architecture | Vulkan (RDNA1), ROCm (RDNA2+) |
| **Apple Silicon** | Full | `sysctl`. M1-M4 + Pro/Max/Ultra | Metal via MLX/Ollama |
| **CPU** | Full | Always available | Ollama CPU mode |
| **Intel Arc** | Planned | Detection stubbed | Not yet implemented |

---

## Experimental

Code exists and may work, but is not fully integrated or battle-tested:

| Component | Status | Notes |
|-----------|--------|-------|
| **vLLM backend** | Experimental | Agent detects vLLM on port 8000. Routing works. Not stress-tested. |
| **SGLang backend** | Experimental | Detection exists. Structured generation support. |
| **llama.cpp backend** | Experimental | Detection exists. GGUF model support. |
| **BitNet backend** | Experimental | CPU-only 1-bit inference. Detection on port 8082. |
| **MLX backend** | Experimental | Apple Silicon only. Metal acceleration. |
| **Namespaces** | Experimental | Multi-tenancy with quotas. 27K LOC. Not wired to main routes yet. |
| **MCP Server** | Experimental | AI agents manage cluster via tool calls. Basic implementation. |
| **TypeScript SDK** | Experimental | Programmatic gateway access. |
| **Observability** | Experimental | Prometheus metrics endpoint works. Grafana dashboards exist. |
| **Docker Compose** | Experimental | Gateway + agent containerized. |

---

## Not Yet Implemented

These exist as code files in `gateway/src/` but are **not imported** into the running gateway. They represent future work:

| Module | LOC | Purpose | Why it's here |
|--------|-----|---------|---------------|
| `billing.ts` | 11K | Stripe integration | Future paid tier |
| `sso.ts` | 42K | OAuth2/SAML auth | Enterprise feature |
| `federation.ts` | 34K | Multi-cluster mesh | Planned for v1.0 |
| `cloud-burst.ts` | 30K | Cloud overflow (RunPod, Lambda) | Planned hybrid cloud |
| `compliance.ts` | 11K | EU AI Act enforcement | Enterprise/regulatory |
| `security.ts` | 75K | mTLS, network policies | Parts used, full suite planned |
| `finetune.ts` | 42K | Fine-tuning orchestration | Future feature |
| `distributed.ts` | 26K | Tensor/pipeline parallelism | Large model sharding |
| `autonomous-ops.ts` | 11K | Self-healing playbooks | 5 autonomy levels defined |
| `chaos.ts` | 9K | Chaos engineering | Testing/reliability |
| `cost-intelligence.ts` | 23K | TCO tracking | Analytics feature |
| `declarative.ts` | 37K | YAML cluster config | Config-as-code |
| `scheduler.ts` | 33K | Cron task scheduling | Maintenance automation |
| `licensing.ts` | 29K | License management | Commercial licensing |
| `voice-agent.ts` | 10K | Speech processing | Whisper/TTS integration |

**Total unwired code: ~400K LOC across 15 modules.** These are written and waiting to be integrated.

---

## Test Suite

| Metric | Actual |
|--------|--------|
| Test files | 39 (36 gateway + 3 agent) |
| Tests passing | **1006** |
| Tests failing | 9 |
| Test runtime | ~18s |
| Coverage | Not yet measured |

Test infrastructure: Vitest with isolated in-memory SQLite per test file.

---

## CLAWHub Marketplace

| Category | Actual Count |
|----------|-------------|
| Adapters | 20 |
| Agents | 17 |
| Integrations | 26 |
| Themes | 10 |
| Stacks | 9 |
| Skills | 6 |
| Examples | 5 |
| Models (flight sheets) | 3 |
| **Total** | **96** |

---

## Known Architecture Debt

1. **Gateway monolith** — `index.ts` is 6,277 lines with 215 routes inline. Needs to be split into route modules.
2. **Database monolith** — `db.ts` is 3,746 lines with 128 exported functions. Needs domain-based splitting.
3. **No formal agent protocol** — Agent↔gateway contract is implicit in `shared/types.ts`. Needs versioning, HMAC signing, schema validation.
4. **UDP discovery is unauthenticated** — Any device on the LAN can impersonate a gateway.
5. **15 unwired modules** — ~400K LOC of feature code exists but isn't connected to the running system.

---

## The Core Path

> **Turn 2-10 mixed GPU machines into one OpenAI-compatible inference cluster in under 10 minutes.**

Everything in this repo either supports that outcome or is waiting for it to be rock-solid first.
