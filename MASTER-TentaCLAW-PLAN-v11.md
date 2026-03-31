# TentaCLAW OS — MASTER PLAN v11: 5,000 Phases, 300 Waves

> **"Turn scattered GPUs into one inference pool."**
>
> Brand: **TentaCLAW** | Mascot: **CLAWtopus** 🐙
> Website: **www.TentaCLAW.io** | GitHub: **TentaCLAW-OS/TentaCLAW**
> Tagline: **Eight arms. One mind. Zero compromises.**
> Motto: **"Per-token pricing is a scam."**
> Version: 11.0 | Date: March 31, 2026
>
> The most comprehensive product roadmap for an open-source AI infrastructure
> project. Informed by deep research: 17 competitors, $312B market by 2034,
> 97M MCP installs, NVIDIA Dynamo 1.0, SGLang 29% faster than vLLM,
> OpenClaw's 8 viral primitives, EU AI Act (Aug 2, 2026), and a live
> 4-node Proxmox cluster with 9 AMD GPUs and 104GB VRAM.

---

## Version Codenames (Cephalopod Anatomy 🐙)

| Version | Codename | Body Part | Theme | Milestone |
|---------|----------|-----------|-------|-----------|
| v1.0 | **Sucker** | Suction cups — grip and hold | Launch + Trust + Community | 1K stars, 50 installs |
| v2.0 | **Ink** | Defensive ink cloud — speed and escape | Performance + Backends | SGLang/Dynamo, 10K stars |
| v3.0 | **Chromatophore** | Color-changing cells — adaptation | Enterprise + Compliance | First $, EU AI Act ready |
| v4.0 | **Mantle** | Main body — strength and structure | Kubernetes + Cloud | K8s operator, AWS Marketplace |
| v5.0 | **Beak** | Sharp beak — precision and power | Multimodal + Marketplace | Vision/audio/video, CLAWHub 2.0 |
| v6.0 | **Siphon** | Jet propulsion — speed at scale | Scale + Federation | 1000-node, global routing |
| v7.0 | **Hectocotylus** | Specialized arm — reproduction | Training + MLOps | Fine-tuning, RLHF, model CI/CD |
| v8.0 | **Nautilus** | Ancient spiral shell — endurance | Daphney + World Domination | $100M ARR, TentaCon, IPO |

---

## What's Already Built (v0.x — Pre-Launch)

- Gateway: 29 modules, 150+ API endpoints, 782 tests, Hono server
- Dashboard: Proxmox-style React SPA, 12 tabs, login, drag-and-drop, CLAWtopus personality
- CLI: 111 commands, sparklines, progress bars, box-drawing, personality system
- Agent: GPU detection (NVIDIA/AMD/Intel), watchdog, self-healing, auto-discovery
- Website: tentaclaw.io landing page with terminal demo, features, pricing
- Installer: one-line install + setup wizard + quickstart script
- CI/CD: 3 GitHub Actions workflows
- Documentation: API reference (200+ endpoints), deployment guide, architecture overview
- Launch materials: Show HN, Reddit, Discord, demo script, tweets
- Security: posture doc, safe defaults, threat model
- LIVE CLUSTER: 4 Proxmox nodes, 9 AMD GPUs, 104GB VRAM, 20 models, Health A (100/100)

---

## Research Foundation

### Market (March 2026)
- AI inference market: $117B (2026) → $312-536B by 2034
- On-prem breakeven: 4 months (was 12-18). 18x cost advantage per M tokens
- GPUStack (4.7K stars) is closest competitor. Ollama at 52M downloads is single-node
- MCP: 97M monthly installs. A2A v0.3 stable. Both table stakes
- EU AI Act: full enforcement August 2, 2026. Compliance = revenue

### Technical (March 2026)
- NVIDIA Dynamo 1.0: inference OS standard. 7x Blackwell boost. Adopted by AWS/Azure/GCP
- SGLang: 29% faster than vLLM. RadixAttention: 85-95% cache hit rate
- Disaggregated inference: separate prefill/decode pools. NIXL 96% latency reduction
- llm-d: CNCF sandbox. K8s-native distributed inference. 87.4% cache hit
- LMCache: de facto KV cache standard. 15x throughput with vLLM
- Kubernetes DRA: GA in v1.34. Fine-grained GPU scheduling
- AMD MI350 shipping. MI400 coming H2 2026 (432GB HBM4)

### Growth (March 2026)
- OpenClaw: 210K stars. 8 viral primitives. 30-day launch cadence
- Cursor: $2B ARR. Downstream inference demand exploding
- PLG: 5% free-to-paid conversion median. Time-to-first-value under 30 mins
- NVentures: 30 deals in 2025. They fund tools that sell more GPUs
- Seed: $2-5M at $15-25M for AI infra with product + community
- Category creation: "Inference Cluster OS" — nobody owns it yet

---

## Part 1: Waves 1-100 (~1,667 Phases)

---

# SECTION 1: v1.0 "SUCKER" — Launch + Trust + Community (Waves 1-40)

*Grip the market. Earn trust on Day 0. Build the community that builds TentaCLAW.*

---

### Wave 1: Safe Defaults Hardening (Phases 1-17)
*Day 0 security: every install must be safe-by-default, even for users who never read docs.*

- [ ] Phase 1: Audit all network bind addresses — change any `0.0.0.0` defaults to `127.0.0.1` for single-node installs, require explicit `--bind 0.0.0.0` for cluster mode
- [ ] Phase 2: Generate cryptographically random cluster secret on first `tentaclaw init` — 256-bit, stored in `~/.tentaclaw/cluster.key` with `0600` permissions
- [ ] Phase 3: Enable authentication by default — gateway refuses unauthenticated requests unless `--no-auth` flag is explicitly passed (with a warning printed to stderr)
- [ ] Phase 4: Write unit tests for auth enforcement: verify 401 on missing token, 403 on invalid token, 200 on valid token — 15 test cases covering all API groups
- [ ] Phase 5: Add rate limiting defaults — 60 req/min per IP for unauthenticated endpoints, 600 req/min for authenticated, configurable in `config.yaml`
- [ ] Phase 6: Implement API key hashing — store SHA-256 hashes in the database, never plaintext; verify by hashing incoming keys and comparing
- [ ] Phase 7: Add TLS certificate auto-generation for inter-node communication — self-signed CA created on `tentaclaw init`, node certs signed by cluster CA
- [ ] Phase 8: Write integration test: spin up 2-node cluster, verify all inter-node traffic is encrypted (packet capture shows no plaintext model data)
- [ ] Phase 9: Set secure HTTP headers on all gateway responses — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` when TLS enabled
- [ ] Phase 10: Audit all CLI commands for secret leakage — ensure API keys, tokens, and cluster secrets are never logged or printed to stdout (mask with `****`)
- [ ] Phase 11: Implement config file permission checks — warn if `config.yaml` or `cluster.key` has world-readable permissions, refuse to start if `cluster.key` is `0644` or wider
- [ ] Phase 12: Add input validation on all API endpoints — reject payloads > 10MB, validate JSON schema, sanitize string fields against injection
- [ ] Phase 13: Write fuzz tests for API input validation — 500 randomly generated payloads per endpoint, verify no crashes or unhandled exceptions
- [ ] Phase 14: Disable debug mode by default — require `--debug` flag, ensure debug endpoints (`/debug/pprof`, `/debug/vars`) are not exposed in production mode
- [ ] Phase 15: Add security checklist to installer output — after `tentaclaw init`, print 5-point checklist: auth enabled, TLS configured, secrets stored, firewall reminder, update reminder
- [ ] Phase 16: Write `docs/security/safe-defaults.md` documenting every security default and how to customize
- [ ] Phase 17: Commit "security: safe defaults hardening — auth, TLS, rate limiting, input validation"

---

### Wave 2: Signed Releases & Supply Chain (Phases 18-33)
*Every binary and container image must be verifiable. Trust starts at download.*

- [ ] Phase 18: Generate GPG signing key for TentaCLAW releases — 4096-bit RSA, publish public key to `keys.tentaclaw.io` and GitHub
- [ ] Phase 19: Add GPG signature generation to CI release pipeline — sign every `.tar.gz`, `.deb`, `.rpm`, `.apk` artifact
- [ ] Phase 20: Generate SHA-256 checksums file (`CHECKSUMS.sha256`) for every release, GPG-sign the checksums file itself
- [ ] Phase 21: Add signature verification to the one-line installer — download public key, verify checksum file signature, verify binary checksum before execution
- [ ] Phase 22: Implement Sigstore cosign signing for container images — sign every Docker image pushed to `ghcr.io/tentaclaw-os/tentaclaw`
- [ ] Phase 23: Add SBOM (Software Bill of Materials) generation to CI — output SPDX format SBOM for every release, attach to GitHub Release
- [ ] Phase 24: Write verification guide: `docs/security/verify-releases.md` with step-by-step GPG and cosign verification instructions
- [ ] Phase 25: Implement `tentaclaw verify` CLI command — verify the running binary's checksum against published checksums, report if tampered
- [ ] Phase 26: Add dependency pinning audit — verify all npm/pip/go dependencies use exact versions or lock files, no floating ranges
- [ ] Phase 27: Set up Dependabot for automated dependency update PRs — configure for weekly scans, auto-merge patch updates after CI passes
- [ ] Phase 28: Add `SECURITY.md` to repository root with CVE reporting instructions, PGP-encrypted email for sensitive disclosures, 90-day disclosure policy
- [ ] Phase 29: Implement reproducible builds — document build environment, verify two independent builds from same commit produce identical binaries
- [ ] Phase 30: Add container image provenance attestation using SLSA Level 2 — GitHub Actions workflow with provenance builder
- [ ] Phase 31: Write integration test: download release from GitHub, verify GPG signature, verify SHA-256, install, verify `tentaclaw verify` passes
- [ ] Phase 32: Add binary transparency log — publish release hashes to Sigstore Rekor for independent auditability
- [ ] Phase 33: Commit "security: signed releases — GPG, cosign, SBOM, reproducible builds, SLSA L2"

---

### Wave 3: Threat Model for Shared Hardware Clusters (Phases 34-49)
*Clusters with untrusted nodes need defense in depth. Model this before launch.*

- [ ] Phase 34: Document threat actors: malicious node operator, compromised agent process, network eavesdropper, rogue API consumer, insider with cluster access
- [ ] Phase 35: Map attack surfaces: agent-to-gateway communication, model weights in transit, KV cache data between nodes, API key storage, GPU memory residue
- [ ] Phase 36: Analyze GPU memory isolation risks — document that GPU memory is not isolated between processes by default, recommend one-model-per-GPU deployment
- [ ] Phase 37: Implement model weight integrity verification — SHA-256 hash of model files stored in gateway DB, agent verifies hash before loading
- [ ] Phase 38: Add node attestation protocol — new nodes must present a one-time join token, gateway verifies before accepting the node into the cluster
- [ ] Phase 39: Write test: attempt to join cluster with invalid token, verify gateway rejects with 403 and logs the attempt
- [ ] Phase 40: Implement API key scope restrictions — keys can be scoped to specific models, namespaces, or operations (read-only vs generate)
- [ ] Phase 41: Add audit logging for security-sensitive operations — node join/leave, API key creation/revocation, model load/unload, config changes
- [ ] Phase 42: Write test: verify audit log captures all 8 security event types with timestamp, actor, action, and result fields
- [ ] Phase 43: Document network segmentation recommendations — separate management plane (gateway API) from data plane (inference traffic) with firewall rules
- [ ] Phase 44: Implement request signing — each API request includes HMAC signature, gateway verifies integrity before processing
- [ ] Phase 45: Add secrets rotation mechanism — `tentaclaw rotate-secret` command generates new cluster secret, rolls it to all nodes with zero-downtime
- [ ] Phase 46: Write test: rotate cluster secret while inference is running, verify no dropped requests during rotation window
- [ ] Phase 47: Document compliance mapping: NIST 800-53 controls covered by TentaCLAW defaults, gaps that require user configuration
- [ ] Phase 48: Publish threat model as `docs/security/threat-model.md` with architecture diagrams, STRIDE analysis, and mitigation status
- [ ] Phase 49: Commit "security: threat model — shared hardware clusters, GPU isolation, node attestation, audit logging"

---

### Wave 4: CVE Reporting & Incident Response (Phases 50-65)
*Professional vulnerability handling earns enterprise trust faster than any feature.*

- [ ] Phase 50: Set up `security@tentaclaw.io` email alias with PGP encryption, forwarding to core maintainers
- [ ] Phase 51: Create private GitHub Security Advisories workflow — draft advisory, assign CVE via GitHub CNA, coordinate patch
- [ ] Phase 52: Write vulnerability disclosure policy: 7-day acknowledgment SLA, 90-day fix window, coordinated disclosure with reporter credit
- [ ] Phase 53: Implement `tentaclaw security-scan` CLI command — check running version against known CVEs from GitHub Advisory Database
- [ ] Phase 54: Add vulnerability database sync — gateway periodically fetches advisory feed from `api.tentaclaw.io/advisories`, warns operator of unpatched CVEs
- [ ] Phase 55: Create incident response playbook: detection → triage (P0-P3) → containment → fix → release → post-mortem template
- [ ] Phase 56: Write test: mock a CVE advisory feed, verify `tentaclaw security-scan` correctly identifies the vulnerable version and recommends upgrade
- [ ] Phase 57: Set up automated security scanning in CI — run `npm audit`, `trivy` container scan, and `semgrep` SAST on every PR
- [ ] Phase 58: Configure Trivy to scan Docker images for HIGH/CRITICAL CVEs — fail CI if any found, with allowlist for known false positives
- [ ] Phase 59: Add Semgrep rules for TentaCLAW-specific patterns — detect hardcoded secrets, insecure crypto, unvalidated user input in route handlers
- [ ] Phase 60: Implement security patch fast-track process — P0 vulnerabilities get patched and released within 24 hours, skip normal release cycle
- [ ] Phase 61: Create security response team rotation — 2 maintainers on-call per week for security reports, documented in `SECURITY.md`
- [ ] Phase 62: Write tabletop exercise: simulate a critical RCE vulnerability report, practice the full incident response flow
- [ ] Phase 63: Add security release notes template — affected versions, severity, attack vector, CVSS score, mitigation, upgrade instructions
- [ ] Phase 64: Publish first security status page at `status.tentaclaw.io` — shows current security posture, latest scan results, advisory feed
- [ ] Phase 65: Commit "security: CVE process — reporting, scanning, incident response, fast-track patches"

---

### Wave 5: Security Testing & Penetration (Phases 66-82)
*Prove the security posture with automated and manual testing before launch.*

- [ ] Phase 66: Write API fuzzing harness using `restler-fuzzer` — auto-generate requests from OpenAPI spec, run for 1 hour, report crashes
- [ ] Phase 67: Run OWASP ZAP dynamic scan against gateway API — test for XSS, CSRF, injection, broken auth; fix all HIGH findings
- [ ] Phase 68: Test authentication bypass attempts: expired tokens, malformed JWTs, SQL injection in auth headers, timing attacks on token comparison
- [ ] Phase 69: Test rate limiter bypass: X-Forwarded-For spoofing, connection reuse, distributed IPs; verify rate limiter is robust
- [ ] Phase 70: Test cluster join security: replay attacks with captured join tokens, brute force token guessing, man-in-the-middle on join handshake
- [ ] Phase 71: Test TLS configuration: verify no SSL 3.0/TLS 1.0/1.1, no weak ciphers, proper certificate chain validation, HSTS headers
- [ ] Phase 72: Audit WebSocket connections — verify authentication required for `/ws` endpoints, test for cross-site WebSocket hijacking
- [ ] Phase 73: Test file upload security (model uploads): path traversal in filenames, zip bomb detection, malicious GGUF header parsing
- [ ] Phase 74: Write memory safety tests — verify no buffer overflows in binary protocol parsers, test with ASAN-enabled builds
- [ ] Phase 75: Test privilege escalation: viewer role attempting admin operations, namespace-scoped key accessing other namespaces
- [ ] Phase 76: Implement automated nightly security regression suite — all security tests run on `main` branch, Slack alert on failures
- [ ] Phase 77: Document all security test results in `docs/security/test-results.md` with date, findings, remediations
- [ ] Phase 78: Create security scorecard — grade A-F across 10 categories (auth, crypto, input validation, secrets, network, etc.)
- [ ] Phase 79: Achieve 100% fix rate on HIGH/CRITICAL findings before v1.0 launch — document any accepted risks with justification
- [ ] Phase 80: Write `SECURITY-AUDIT.md` summarizing all testing performed, tools used, findings fixed, residual risks
- [ ] Phase 81: Set up HackerOne or Huntr bug bounty program for post-launch — define scope, severity tiers, reward amounts ($50-$5000)
- [ ] Phase 82: Commit "security: penetration testing — fuzzing, OWASP ZAP, auth bypass, privilege escalation, scorecard A"

---

### Wave 6: Show HN Launch — Day 0 (Phases 83-99)
*The single most important day. Every detail matters. Ship, monitor, respond.*

- [ ] Phase 83: Write Show HN post — 3 paragraphs: problem (per-token pricing, single-node limits), solution (cluster OS, 9 GPUs, 20 models), ask (try it, star it, tell us what sucks)
- [ ] Phase 84: Prepare HN post metadata — title: "Show HN: TentaCLAW — Turn Scattered GPUs into One Inference Pool (open-source)", 60 chars
- [ ] Phase 85: Write HN launch comment — technical deep dive: architecture, benchmark numbers, how it compares to Ollama/GPUStack/vLLM, what's next
- [ ] Phase 86: Pre-stage Reddit posts — r/LocalLLaMA (focus on AMD GPU support, 20 models), r/selfhosted (focus on Proxmox integration, Docker Compose)
- [ ] Phase 87: Write Twitter/X launch thread — 8 tweets: hook → problem → demo GIF → benchmark → architecture → vs competitors → call to action → thank you
- [ ] Phase 88: Record 90-second terminal demo GIF — `tentaclaw init` → add node → load model → chat → show dashboard → cluster health
- [ ] Phase 89: Final pre-launch checklist: README polished, quickstart works on clean Ubuntu 24.04, all CI green, website live, Discord invite link works
- [ ] Phase 90: Deploy `tentaclaw.io` website — verify terminal demo loads, pricing page shows, GitHub star count badge updates
- [ ] Phase 91: Set up real-time monitoring for launch day — Grafana dashboard showing: GitHub stars, npm downloads, website visitors, Discord joins, API errors
- [ ] Phase 92: Post Show HN at 8:00 AM ET Monday — optimal posting time based on HN front-page analysis
- [ ] Phase 93: Post Reddit r/LocalLLaMA within 30 minutes of HN post going live
- [ ] Phase 94: Post Twitter thread immediately after Reddit
- [ ] Phase 95: Monitor HN comments every 15 minutes for first 6 hours — respond to every technical question within 30 minutes
- [ ] Phase 96: Monitor GitHub Issues — triage bug reports within 1 hour, label with priority, assign to team member
- [ ] Phase 97: Track launch metrics hourly: stars, forks, clones, website unique visitors, installer downloads, Discord members
- [ ] Phase 98: Write launch day retrospective by midnight — what worked, what broke, top feedback themes, immediate action items
- [ ] Phase 99: Commit "docs: launch day retrospective and metrics"

---

### Wave 7: Launch Day +1-3 — Fix Everything (Phases 100-116)
*The install friction window. Every bug reported in first 72 hours gets fixed immediately.*

- [ ] Phase 100: Triage all GitHub Issues opened in first 24 hours — categorize: install failures, config confusion, missing docs, feature requests, actual bugs
- [ ] Phase 101: Fix top 3 install friction issues identified from launch feedback — target same-day patch release
- [ ] Phase 102: Add missing error messages for common install failures — CUDA not found, Docker not running, port already in use, insufficient disk space
- [ ] Phase 103: Improve `tentaclaw doctor` output based on real user failure modes — add checks for GPU driver version, container runtime, network connectivity
- [ ] Phase 104: Update README FAQ section with answers to the top 10 questions from HN/Reddit comments
- [ ] Phase 105: Fix any broken links on tentaclaw.io discovered by users clicking through the site
- [ ] Phase 106: Respond to every HN comment that hasn't been answered — even if just acknowledging feedback with a timeline
- [ ] Phase 107: Respond to every Reddit comment across r/LocalLLaMA and r/selfhosted — personal, technical, grateful
- [ ] Phase 108: Push patch release v0.x.1 fixing all critical install bugs — announce in Discord and on the HN thread
- [ ] Phase 109: Write "Getting Started" troubleshooting addendum — 10 most common issues from launch with exact fix commands
- [ ] Phase 110: Set up automated crash reporting opt-in — ask users to share anonymous crash reports to help prioritize fixes
- [ ] Phase 111: Review all Discord messages from new members — answer questions, note patterns in confusion
- [ ] Phase 112: Identify top 5 "I wish it had..." feature requests from launch feedback — add to public roadmap
- [ ] Phase 113: Write thank-you post on Discord — acknowledge community, share metrics (stars, installs, messages), preview what's next
- [ ] Phase 114: Update quickstart guide based on observed failure patterns — add platform-specific notes for Ubuntu, Fedora, macOS, WSL2
- [ ] Phase 115: Cherry-pick urgent fixes into release branch, tag v0.x.2 patch
- [ ] Phase 116: Commit "fix: launch day +1-3 patches — install friction, error messages, docs"

---

### Wave 8: Launch Day +4-7 — Discord & Community (Phases 117-133)
*Stand up the community infrastructure that will outlast any launch spike.*

- [ ] Phase 117: Finalize Discord server structure — channels: #general, #support, #show-your-cluster, #feature-requests, #development, #benchmarks, #off-topic
- [ ] Phase 118: Create Discord roles: @Core Team, @Contributor, @Champions, @Enterprise, with distinct colors and permissions
- [ ] Phase 119: Deploy CLAWtopus Welcome Bot — greet new members with onboarding message, link to quickstart, suggest #show-your-cluster
- [ ] Phase 120: Write CLAWtopus bot personality — friendly, slightly sarcastic, uses octopus puns, responds to `!help`, `!status`, `!benchmark`
- [ ] Phase 121: Create cluster badge generator at `tentaclaw.io/badge` — input node/GPU/VRAM count, output SVG badge for README
- [ ] Phase 122: Add `tentaclaw badge` CLI command — generates Markdown badge snippet for the running cluster, copy-paste into README
- [ ] Phase 123: Launch #show-your-cluster channel with the Proxmox reference cluster as first post — include photo, specs, dashboard screenshot
- [ ] Phase 124: Set up GitHub Discussions — categories: Q&A, Ideas, Show & Tell, Announcements; migrate long-form HN conversations
- [ ] Phase 125: Write contributor guide: `CONTRIBUTING.md` with setup instructions, code style, PR process, review expectations
- [ ] Phase 126: Label 20 issues as `good-first-issue` across gateway, dashboard, CLI, agent, and docs — write detailed descriptions with hints
- [ ] Phase 127: Push third patch release v0.x.3 with accumulated fixes from the week
- [ ] Phase 128: Write comparison blog post: "TentaCLAW vs Ollama vs GPUStack vs vLLM — When to Use What"
- [ ] Phase 129: Set up community metrics dashboard — track Discord DAU, GitHub issues opened/closed ratio, PR merge time, contributor count
- [ ] Phase 130: Create Discord #announcements channel (read-only) — post weekly updates every Friday
- [ ] Phase 131: Host first Discord voice office hours — 30-minute casual call, demo new fixes, answer questions live
- [ ] Phase 132: Send personal DMs to 5 most active community members thanking them, gauge interest in Champions program
- [ ] Phase 133: Commit "community: Discord server, badge generator, contributor guide, good-first-issues"

---

### Wave 9: Launch Day +8-14 — Content & Outreach (Phases 134-150)
*Sustain momentum beyond the launch spike with content that compounds.*

- [ ] Phase 134: Write blog post: "Why We Built TentaCLAW — Per-Token Pricing is a Scam" — personal story, cost comparison table, open-source philosophy
- [ ] Phase 135: Create cost comparison calculator at `tentaclaw.io/calculator` — input model, usage, compare self-hosted TentaCLAW vs OpenAI/Anthropic/Together
- [ ] Phase 136: Produce 5-minute YouTube demo video — professional narration over terminal + dashboard, cover install to first chat in under 3 minutes
- [ ] Phase 137: Identify 10 YouTube creators in self-hosted / homelab / AI space — prepare personalized outreach emails with cluster-on-loan offer
- [ ] Phase 138: Write technical blog post: "How TentaCLAW Routes Requests Across 9 GPUs" — architecture deep dive with diagrams
- [ ] Phase 139: Submit to DevOps Weekly, TLDR newsletter, and Console.dev — write custom descriptions for each audience
- [ ] Phase 140: Post second Reddit wave — r/homelab (focus on Proxmox integration), r/MachineLearning (focus on research cluster use case)
- [ ] Phase 141: Create comparison infographic: single-GPU (Ollama) vs multi-GPU (TentaCLAW) — visual showing request routing, model concurrency
- [ ] Phase 142: Write tutorial: "Self-Host 20 AI Models on Your Proxmox Cluster with TentaCLAW" — step-by-step with screenshots
- [ ] Phase 143: Set up RSS feed for blog at `tentaclaw.io/blog/rss` — ensure all blog posts are auto-syndicated
- [ ] Phase 144: Create LinkedIn announcement post targeting enterprise/DevOps audience — different tone than HN/Reddit
- [ ] Phase 145: Write Hacker News follow-up comment on original Show HN — "Week 2 update: X stars, Y installs, here's what we fixed"
- [ ] Phase 146: Record 60-second TikTok/Shorts-format demo — fast cuts, "set up an AI cluster in 60 seconds" hook
- [ ] Phase 147: Submit to Awesome Self-Hosted and Awesome LLM lists on GitHub — PR with proper categorization
- [ ] Phase 148: Write SEO-optimized landing pages: "self-hosted AI inference", "GPU cluster management", "open source vLLM alternative"
- [ ] Phase 149: Set up Google Search Console and verify sitemap for tentaclaw.io — target 10 relevant keywords
- [ ] Phase 150: Commit "content: blog posts, cost calculator, YouTube outreach, comparison content"

---

### Wave 10: Launch Day +15-21 — Product Hunt & Growth (Phases 151-167)
*Second launch vector. Different audience. Enterprise-angle content.*

- [ ] Phase 151: Prepare Product Hunt launch — hero image (CLAWtopus with GPU cluster), tagline, 5 screenshots, maker comment
- [ ] Phase 152: Schedule Product Hunt launch for Tuesday 12:01 AM PT — coordinate with 3 hunters for upvotes in first hour
- [ ] Phase 153: Write Product Hunt maker comment — focus on the "why now": AI costs, GPU availability, enterprise demand
- [ ] Phase 154: Create animated GIF gallery for Product Hunt — 4 GIFs: install, dashboard, CLI commands, cluster scaling
- [ ] Phase 155: Launch on Product Hunt — monitor comments, respond within 30 minutes, share with Discord community
- [ ] Phase 156: Write enterprise-angle blog post: "Why Your Company Should Own Its AI Infrastructure" — cost, control, compliance, latency
- [ ] Phase 157: Create ROI calculator at `tentaclaw.io/roi` — input: team size, model usage, current API spend → output: TentaCLAW savings with breakeven timeline
- [ ] Phase 158: Write whitepaper: "The Case for Self-Hosted AI Inference" — 10 pages, cite market research, cost analysis, architecture comparison
- [ ] Phase 159: Set up Calendly link for enterprise demo requests — 30-minute slot, linked from website enterprise page
- [ ] Phase 160: Design and publish pricing page — Community (free, unlimited nodes), Pro ($29/node/month, priority support), Enterprise ($49/node/month, SSO/RBAC/SLA)
- [ ] Phase 161: Implement telemetry opt-in — anonymous usage stats (node count, GPU count, model count, request volume) to help prioritize features
- [ ] Phase 162: Add "Powered by TentaCLAW" footer badge option — users can add to their projects, links back to tentaclaw.io
- [ ] Phase 163: Write case study template — prepare for first customer stories with problem/solution/results format
- [ ] Phase 164: Publish weekly metrics update on Discord and Twitter — stars, installs, contributors, community size
- [ ] Phase 165: Reach out to 5 AI/DevOps podcast hosts for guest appearances — prepare talking points and demo flow
- [ ] Phase 166: Analyze Product Hunt results — upvotes, comments, traffic spike, conversion to installs/stars
- [ ] Phase 167: Commit "growth: Product Hunt launch, enterprise content, pricing page, telemetry"

---

### Wave 11: Launch Day +22-30 — Contest & v1.0 Prep (Phases 168-184)
*Convert launch energy into sustained contribution. Prep for v1.0 tag.*

- [ ] Phase 168: Launch "CLAWtopus Challenge" — 30-day contest: best cluster setup, best integration, best benchmark, best bug fix
- [ ] Phase 169: Define contest prizes — CLAWtopus sticker packs, contributor t-shirts, "Founding Contributor" badge in Discord, $500 hardware credit for winner
- [ ] Phase 170: Create contest submission form at `tentaclaw.io/challenge` — upload screenshot/video, describe setup, link to PR if code contribution
- [ ] Phase 171: Announce contest on all channels — HN comment, Reddit post, Twitter thread, Discord announcement, Product Hunt update
- [ ] Phase 172: Design CLAWtopus sticker sheet — 6 designs: default octopus, octopus-with-GPU, octopus-coding, "per-token-pricing-is-a-scam", cluster badge, logo
- [ ] Phase 173: Design contributor t-shirt — CLAWtopus on front, "I helped build the inference OS" on back, GitHub username on sleeve
- [ ] Phase 174: Set up swag fulfillment pipeline — Printful integration, shipping to top 20 contributors, tracked delivery
- [ ] Phase 175: Create "Founding Contributors" wall on tentaclaw.io — avatar, name, GitHub link for everyone who contributed before v1.0
- [ ] Phase 176: Run contributor sprint — pair with 5 new contributors on their first PR, review within 2 hours, merge within 24 hours
- [ ] Phase 177: Write launch retrospective blog post: "Our First 30 Days — What Worked, What Didn't, What's Next"
- [ ] Phase 178: Compile all launch metrics into dashboard — 30-day trends: stars, installs, contributors, issues, PRs, Discord members
- [ ] Phase 179: Identify top 10 feature requests from community feedback — rank by votes, feasibility, strategic alignment
- [ ] Phase 180: Create public roadmap at `tentaclaw.io/roadmap` — interactive, community can vote on features
- [ ] Phase 181: Judge CLAWtopus Challenge entries — community voting + core team selection, announce winners
- [ ] Phase 182: Ship prizes to contest winners — stickers, t-shirts, hardware credits, Discord badges
- [ ] Phase 183: Begin v1.0 feature freeze discussion — define what must be in v1.0 vs what can wait for v1.1
- [ ] Phase 184: Commit "community: CLAWtopus Challenge, swag pipeline, founding contributors, public roadmap"

---

### Wave 12: CLAWtopus Champions Program (Phases 185-200)
*Power users who evangelize TentaCLAW. Give them status, access, and reasons to stay.*

- [ ] Phase 185: Define Champions program criteria — 3+ PRs merged OR 50+ helpful Discord messages OR published TentaCLAW content OR running 5+ node cluster
- [ ] Phase 186: Recruit first 5 Champions from launch community — personal outreach to most active members, explain benefits and expectations
- [ ] Phase 187: Create private #champions Discord channel — early access to releases, direct line to core team, input on roadmap
- [ ] Phase 188: Give Champions `@Champion` Discord role — distinct color (gold), appears above regular members in sidebar
- [ ] Phase 189: Create Champions profile page on tentaclaw.io — photo, bio, cluster setup, contribution areas
- [ ] Phase 190: Set up monthly Champions call — 1 hour, share upcoming features, get feedback, discuss community health
- [ ] Phase 191: Give Champions early access to beta releases — 1 week before public release, their feedback shapes final polish
- [ ] Phase 192: Create Champions referral tracking — unique invite links, track how many users each Champion brings in
- [ ] Phase 193: Design Champion-exclusive swag — special edition CLAWtopus hoodie, laptop sticker with "Champion" badge
- [ ] Phase 194: Empower Champions to triage issues — give them GitHub triage role, train on labeling and prioritization
- [ ] Phase 195: Write Champions handbook — expectations (2 hours/week), benefits, communication norms, escalation paths
- [ ] Phase 196: Set up Champions leaderboard — track contributions across code, community, content; display on website
- [ ] Phase 197: Plan first Champions meetup — virtual or in-person at a tech conference, team dinner, roadmap preview
- [ ] Phase 198: Create Champions quarterly review process — check engagement, graduate inactive members, recruit replacements
- [ ] Phase 199: Write blog post: "Meet the TentaCLAW Champions" — introduce each Champion, their story, their cluster
- [ ] Phase 200: Commit "community: Champions program — recruitment, perks, handbook, leaderboard"

---

### Wave 13: Weekly Office Hours & Events (Phases 201-216)
*Predictable community touchpoints that build habit and loyalty.*

- [ ] Phase 201: Establish weekly office hours schedule — every Thursday 4 PM ET on Discord voice, 30 minutes, open to all
- [ ] Phase 202: Create office hours format — 5 min update from core team, 10 min demo/deep-dive, 15 min open Q&A
- [ ] Phase 203: Set up Discord Stage channel for office hours — better audio quality, raise-hand feature for questions
- [ ] Phase 204: Record every office hours session — upload to YouTube as "TentaCLAW Office Hours" playlist for async viewers
- [ ] Phase 205: Write show notes for each office hours — summary, links mentioned, questions answered, action items
- [ ] Phase 206: Create monthly "State of the Tentacle" blog post — metrics, achievements, roadmap progress, community spotlight
- [ ] Phase 207: Organize monthly themed office hours — "Performance Deep Dive", "AMD GPU Special", "Enterprise Q&A", "Contributor Onboarding"
- [ ] Phase 208: Set up community showcase rotation — invite 1 community member per month to demo their cluster setup on office hours
- [ ] Phase 209: Create #events Discord channel — post all upcoming events, office hours, release dates, community calls
- [ ] Phase 210: Implement Discord event reminders — bot posts reminder 1 hour before each event with join link
- [ ] Phase 211: Host first "Cluster Show & Tell" event — community members screen-share their setups, 5 minutes each, vote on coolest cluster
- [ ] Phase 212: Create virtual conference plan for "TentaCon v0" — half-day event in 6 months, talks + workshops + community awards
- [ ] Phase 213: Set up newsletter at `tentaclaw.io/newsletter` — monthly email: changelog highlights, community stories, tips & tricks
- [ ] Phase 214: Write first newsletter issue — launch recap, v1.0 preview, Champion spotlight, "tip of the month"
- [ ] Phase 215: Integrate newsletter signup into installer post-install message — opt-in, one-click
- [ ] Phase 216: Commit "community: office hours, events, newsletter, Cluster Show & Tell"

---

### Wave 14: Cluster Badge & Viral Artifact Generator (Phases 217-232)
*Shareable artifacts that spread TentaCLAW organically through READMEs and social media.*

- [ ] Phase 217: Build badge generator API endpoint — `GET /api/badge?nodes=4&gpus=9&vram=104GB` returns SVG badge image
- [ ] Phase 218: Design 5 badge styles — minimal (text only), neon (glowing border), terminal (green-on-black), pride (rainbow gradient), dark (GitHub dark mode)
- [ ] Phase 219: Add cluster health indicator to badge — green/yellow/red dot based on cluster health score
- [ ] Phase 220: Implement badge caching — CDN-cached SVG with 5-minute TTL, ETag for browser caching
- [ ] Phase 221: Build badge generator web UI at `tentaclaw.io/badge` — interactive form, live preview, copy Markdown/HTML/URL
- [ ] Phase 222: Add `tentaclaw badge --format svg|png|md` CLI command — generate badge from live cluster stats, save to file or copy to clipboard
- [ ] Phase 223: Build benchmark card generator — input benchmark results, output shareable card image with tok/s, TTFT, model name, GPU info
- [ ] Phase 224: Design benchmark card template — CLAWtopus watermark, dark theme, highlight the impressive metric, comparison bar chart
- [ ] Phase 225: Implement `tentaclaw benchmark --share` flag — run benchmark, generate shareable card, upload to `share.tentaclaw.io/b/<hash>`
- [ ] Phase 226: Build "My Cluster" screenshot tool — capture dashboard state as clean PNG with CLAWtopus branding, optimized for social sharing
- [ ] Phase 227: Add one-click share buttons — Twitter, Reddit, LinkedIn — with pre-filled text and attached image/badge
- [ ] Phase 228: Implement Open Graph meta tags for shared links — `share.tentaclaw.io` URLs render rich previews on Twitter/Slack/Discord
- [ ] Phase 229: Build dashboard widget for embeddable cluster status — `<iframe>` snippet that shows live cluster health, model count, GPU utilization
- [ ] Phase 230: Write tests: verify badge SVG renders correctly for edge cases (0 GPUs, 100 nodes, very long model names, unicode characters)
- [ ] Phase 231: Add badge to TentaCLAW's own README — showcase the reference cluster badge as a living example
- [ ] Phase 232: Commit "feat: viral artifacts — cluster badge, benchmark card, screenshot tool, one-click share"

---

### Wave 15: Sticker & Swag Design System (Phases 233-248)
*Physical artifacts create emotional connection and real-world visibility.*

- [ ] Phase 233: Commission CLAWtopus character sheet from illustrator — 6 poses: default, coding, lifting GPU, sleeping, celebrating, angry at cloud bills
- [ ] Phase 234: Design die-cut sticker set — 3" circular logo, 2" CLAWtopus poses, "Per-Token Pricing is a Scam" bumper sticker
- [ ] Phase 235: Design laptop sticker pack — 10 designs: logo variants, CLAWtopus poses, taglines, inside jokes ("GPU whisperer", "cache me outside")
- [ ] Phase 236: Design contributor t-shirt v2 — front: CLAWtopus hugging a GPU rack, back: "I turned scattered GPUs into one inference pool"
- [ ] Phase 237: Design conference booth banner — 6' retractable banner with CLAWtopus, key metrics, QR code to quickstart
- [ ] Phase 238: Set up Printful storefront at `shop.tentaclaw.io` — t-shirts, stickers, mugs, hoodies; profit goes to project fund
- [ ] Phase 239: Create "Founding Contributor" exclusive sticker — limited edition holographic, numbered, only for pre-v1.0 contributors
- [ ] Phase 240: Design CLAWtopus enamel pin — 1.25" hard enamel, gold border, gift to Champions and conference speakers
- [ ] Phase 241: Create swag request form for meetup organizers — free sticker packs for anyone hosting a TentaCLAW talk
- [ ] Phase 242: Design seasonal CLAWtopus variants — summer (sunglasses), winter (scarf), Halloween (pirate), holiday (Santa hat)
- [ ] Phase 243: Create GitHub profile badge — "TentaCLAW Contributor" badge image for README profiles
- [ ] Phase 244: Design CLAWtopus emoji set for Discord — 20 custom emojis: happy, sad, thinking, celebrating, GPU-on-fire, cache-hit, etc.
- [ ] Phase 245: Upload custom emojis to Discord server — make available to all members, document usage in #welcome
- [ ] Phase 246: Create animated CLAWtopus Lottie animation for website — waving tentacle on homepage, subtle and delightful
- [ ] Phase 247: Write brand guidelines document: logo usage, colors (#1a1a2e primary, #e94560 accent, #0f3460 dark), typography, mascot do's/don'ts
- [ ] Phase 248: Commit "brand: sticker designs, swag store, emoji set, brand guidelines"

---

### Wave 16: Installer Testing — Ubuntu (Phases 249-264)
*Ubuntu is the #1 server distro. The installer must be flawless on every supported version.*

- [ ] Phase 249: Set up CI matrix for Ubuntu testing — 20.04 LTS, 22.04 LTS, 24.04 LTS, 24.10 (latest) with Docker and bare-metal variants
- [ ] Phase 250: Test one-line installer on Ubuntu 20.04 — verify curl pipe, dependency resolution, binary placement in `/usr/local/bin`
- [ ] Phase 251: Fix Ubuntu 20.04 compatibility issues — older glibc, Python 3.8, missing `libstdc++` symbols; pin minimum versions or bundle
- [ ] Phase 252: Test one-line installer on Ubuntu 22.04 — verify NVIDIA driver detection, CUDA toolkit compatibility, container runtime setup
- [ ] Phase 253: Test one-line installer on Ubuntu 24.04 — verify `apt` package installation, systemd service creation, log integration with `journalctl`
- [ ] Phase 254: Test Docker Compose deployment on Ubuntu — verify `docker compose up` starts gateway + agent + dashboard, health checks pass within 60s
- [ ] Phase 255: Test GPU passthrough on Ubuntu with NVIDIA — verify `nvidia-smi` visible inside container, CUDA compute works, GPU metrics collected
- [ ] Phase 256: Test GPU passthrough on Ubuntu with AMD ROCm — verify `rocm-smi` visible inside container, ROCm compute works, GPU metrics collected
- [ ] Phase 257: Test systemd service installation — `tentaclaw-gateway.service` and `tentaclaw-agent.service` start on boot, restart on crash, log to journal
- [ ] Phase 258: Test `tentaclaw uninstall` on Ubuntu — verify clean removal: binaries, config files, systemd services, container images, data directories
- [ ] Phase 259: Test multi-node cluster formation on Ubuntu — 3 VMs, verify node discovery, model distribution, cross-node inference routing
- [ ] Phase 260: Test Ubuntu minimal (server) install — no desktop packages, verify CLI-only operation works without X11 dependencies
- [ ] Phase 261: Write Ubuntu-specific troubleshooting section in docs — common issues: AppArmor blocking containers, UFW firewall rules, snap Docker vs apt Docker
- [ ] Phase 262: Add Ubuntu-specific optimizations to installer — detect hugepages support, recommend IOMMU for GPU passthrough, configure kernel parameters
- [ ] Phase 263: Run all 782 existing tests on Ubuntu 20.04/22.04/24.04 — verify zero platform-specific failures
- [ ] Phase 264: Commit "test: Ubuntu installer verification — 20.04, 22.04, 24.04, Docker, bare-metal, GPU passthrough"

---

### Wave 17: Installer Testing — Debian, Fedora, Arch (Phases 265-281)
*Cover the long tail of Linux distros. Each has unique package managers and conventions.*

- [ ] Phase 265: Test one-line installer on Debian 11 (Bullseye) — verify compatibility with older packages, backports for modern dependencies
- [ ] Phase 266: Test one-line installer on Debian 12 (Bookworm) — verify `apt` installation, systemd integration, default Python 3.11 compatibility
- [ ] Phase 267: Test Debian minimal install — verify no `sudo` assumption (Debian default), detect and use `su` or guide user to install sudo
- [ ] Phase 268: Test one-line installer on Fedora 39 — verify `dnf` package installation, SELinux compatibility, firewalld port configuration
- [ ] Phase 269: Test one-line installer on Fedora 40 — verify latest kernel compatibility, Wayland-only (for dashboard if relevant), NVIDIA driver via RPM Fusion
- [ ] Phase 270: Test Fedora SELinux compatibility — verify containers can access GPU devices, write SELinux policy module if needed
- [ ] Phase 271: Test one-line installer on Arch Linux — verify `pacman` package detection, rolling release kernel compatibility, AUR package feasibility study
- [ ] Phase 272: Create AUR package `tentaclaw-bin` — PKGBUILD for binary release, submit to AUR, test with `yay` and `paru`
- [ ] Phase 273: Test on NixOS — create `flake.nix` with TentaCLAW package, verify GPU passthrough with NixOS GPU modules
- [ ] Phase 274: Test on Rocky Linux 9 / AlmaLinux 9 — enterprise RHEL clones, verify RPM package installation, EL9 compatibility
- [ ] Phase 275: Test on openSUSE Tumbleweed — verify `zypper` package installation, NVIDIA driver via openSUSE repos
- [ ] Phase 276: Create `.deb` package with proper dependencies — `tentaclaw_1.0.0_amd64.deb`, test with `dpkg -i` and `apt install ./`
- [ ] Phase 277: Create `.rpm` package with proper dependencies — `tentaclaw-1.0.0-1.x86_64.rpm`, test with `dnf install ./`
- [ ] Phase 278: Test all distros with both NVIDIA and AMD GPUs — matrix of 8 distros x 2 GPU vendors = 16 test configurations
- [ ] Phase 279: Create distro compatibility matrix page on docs — table showing tested versions, known issues, special instructions per distro
- [ ] Phase 280: Add distro detection to installer — auto-detect distro and version, select appropriate package manager and installation path
- [ ] Phase 281: Commit "test: multi-distro installer — Debian, Fedora, Arch, Rocky, openSUSE, NixOS, .deb/.rpm packages"

---

### Wave 18: Docker Compose & Container Polish (Phases 282-297)
*Docker Compose is the fastest path to "it works". Make it bulletproof.*

- [ ] Phase 282: Audit `docker-compose.yml` — verify service dependencies, health checks, restart policies, volume mounts, network configuration
- [ ] Phase 283: Add Docker Compose profiles — `default` (gateway + agent), `full` (+ dashboard + monitoring), `dev` (+ hot reload + debug ports)
- [ ] Phase 284: Implement Docker health checks for all services — gateway: HTTP `/health`, agent: process check + GPU access, dashboard: HTTP 200
- [ ] Phase 285: Add GPU runtime auto-detection in Docker Compose — detect `nvidia-container-toolkit` or `rocm`, configure runtime accordingly
- [ ] Phase 286: Create `docker-compose.cluster.yml` — overlay for multi-node deployment with environment variables for node role and gateway address
- [ ] Phase 287: Write Docker Compose quickstart guide — copy-paste 3 commands to running cluster: `git clone`, `docker compose up -d`, `curl localhost:8080/health`
- [ ] Phase 288: Optimize Docker image sizes — multi-stage builds, strip debug symbols, use `alpine` or `distroless` base, target < 200MB for gateway
- [ ] Phase 289: Add Docker image layer caching in CI — cache `node_modules`, Python packages, and build artifacts to speed up image builds
- [ ] Phase 290: Test Docker Compose on Docker Desktop (macOS) — verify GPU passthrough limitations are documented, CPU-only mode works
- [ ] Phase 291: Test Docker Compose on Docker Desktop (Windows/WSL2) — verify WSL2 GPU passthrough with NVIDIA, document limitations
- [ ] Phase 292: Add `.env.example` file — document all environment variables with descriptions, defaults, and valid values
- [ ] Phase 293: Implement Docker secret support — read API keys and cluster secrets from Docker secrets instead of environment variables
- [ ] Phase 294: Add `docker compose logs --follow` integration with CLAWtopus personality — formatted, colorized log output
- [ ] Phase 295: Test Docker Compose upgrade path — `docker compose pull && docker compose up -d` preserves data volumes, no downtime
- [ ] Phase 296: Write Docker Compose troubleshooting guide — common issues: port conflicts, volume permissions, GPU not detected, OOM kills
- [ ] Phase 297: Commit "docker: Compose polish — profiles, health checks, GPU auto-detect, optimized images, secrets"

---

### Wave 19: ARM64 & Mac Support (Phases 298-314)
*Mac users drive open-source adoption. Jetson/RPi enable edge deployments.*

- [ ] Phase 298: Set up CI cross-compilation for ARM64 (aarch64-linux) — GitHub Actions with QEMU or native ARM runner
- [ ] Phase 299: Build and test ARM64 Docker images — multi-arch manifest for `linux/amd64` and `linux/arm64`
- [ ] Phase 300: Test on NVIDIA Jetson Orin — verify CUDA support, GPU detection, model loading with JetPack 6
- [ ] Phase 301: Test on Raspberry Pi 5 — CPU-only inference with llama.cpp backend, verify 4-bit quantized models run at usable speed
- [ ] Phase 302: Test on Apple Silicon (M1/M2/M3/M4) — verify Metal GPU detection, llama.cpp Metal backend, GPU metrics collection
- [ ] Phase 303: Implement macOS installer — Homebrew formula: `brew install tentaclaw`, verify tap setup and update mechanism
- [ ] Phase 304: Write Homebrew formula with proper dependencies — `llama.cpp`, `cmake`, ARM64 native build, no Rosetta requirement
- [ ] Phase 305: Test macOS cluster participation — Mac as agent node joining a Linux gateway, verify cross-platform node communication
- [ ] Phase 306: Add Apple Metal GPU metrics — VRAM usage, GPU utilization, thermal throttling via IOKit framework
- [ ] Phase 307: Test on AWS Graviton (ARM64) — verify gateway and agent run on `c7g` instances, benchmark CPU inference performance
- [ ] Phase 308: Test on Ampere Altra (ARM64) — cloud ARM64 bare-metal, verify NVIDIA GPU passthrough on ARM64 hosts
- [ ] Phase 309: Implement architecture-specific binary downloads — installer detects `uname -m`, downloads correct binary (amd64/arm64)
- [ ] Phase 310: Add ARM64 to all CI test matrices — every test that runs on amd64 must also pass on arm64
- [ ] Phase 311: Test on Oracle Cloud ARM instances (free tier) — document as cost-effective gateway deployment option
- [ ] Phase 312: Write ARM64 deployment guide — Jetson, RPi, Mac, AWS Graviton with performance expectations for each platform
- [ ] Phase 313: Benchmark ARM64 vs x86_64 CPU inference — compare tok/s on Llama-3.2-3B with llama.cpp on equivalent core counts
- [ ] Phase 314: Commit "platform: ARM64 support — Jetson, RPi, Mac Silicon, Graviton, multi-arch Docker"

---

### Wave 20: PXE Boot & Bare-Metal Provisioning (Phases 315-330)
*Enterprise clusters need zero-touch provisioning. Boot from network, join cluster automatically.*

- [ ] Phase 315: Design PXE boot image — minimal Linux with TentaCLAW agent pre-installed, auto-discovers gateway via mDNS
- [ ] Phase 316: Implement `tentaclaw pxe-server` command — serves boot image over TFTP/HTTP, configurable DHCP options
- [ ] Phase 317: Create iPXE script for chainloading — boot from BIOS/UEFI → iPXE → download TentaCLAW boot image → start agent
- [ ] Phase 318: Implement auto-join on PXE boot — agent reads cluster secret from kernel command line or DHCP option, joins gateway automatically
- [ ] Phase 319: Add GPU inventory on first boot — agent detects all GPUs, reports to gateway, node appears in dashboard within 30 seconds of boot
- [ ] Phase 320: Test PXE boot on 4 Proxmox nodes — verify all nodes boot, detect GPUs, join cluster, become ready for inference
- [ ] Phase 321: Implement boot image customization — `tentaclaw pxe-build` with options for network config, GPU drivers, custom scripts
- [ ] Phase 322: Add NVIDIA driver inclusion in boot image — bundle NVIDIA 550+ drivers, auto-load on GPU detection
- [ ] Phase 323: Add AMD ROCm driver inclusion in boot image — bundle ROCm 6.x drivers, auto-load for supported AMD GPUs
- [ ] Phase 324: Implement diskless boot mode — agent runs entirely from RAM, no local storage required, stateless nodes
- [ ] Phase 325: Add USB boot option — `tentaclaw burn-usb` creates bootable USB with same auto-join behavior for non-PXE environments
- [ ] Phase 326: Test bare-metal provisioning at scale — simulate 10 simultaneous PXE boots, verify all join within 2 minutes
- [ ] Phase 327: Write PXE boot guide — network requirements, DHCP configuration, BIOS settings, troubleshooting TFTP/HTTP issues
- [ ] Phase 328: Implement node decommissioning — `tentaclaw node drain <id>` migrates workloads, then `tentaclaw node remove <id>` cleanly removes
- [ ] Phase 329: Add hardware inventory tracking — CPU, RAM, disk, GPU, NIC details stored in gateway DB, displayed in dashboard
- [ ] Phase 330: Commit "feat: PXE boot provisioning — zero-touch bare-metal, auto-join, diskless mode, USB boot"

---

### Wave 21: Doctor Command & Diagnostics (Phases 331-347)
*One command to diagnose every common problem. Saves support time exponentially.*

- [ ] Phase 331: Implement `tentaclaw doctor` framework — plugin-based check system, each check returns pass/warn/fail with remediation message
- [ ] Phase 332: Add check: GPU driver version — verify NVIDIA driver >= 550 or ROCm >= 6.0, warn on older versions with upgrade instructions
- [ ] Phase 333: Add check: CUDA/ROCm runtime — verify `nvidia-smi` or `rocm-smi` returns valid output, diagnose common failure modes
- [ ] Phase 334: Add check: container runtime — verify Docker >= 24.0 or Podman >= 4.0 is running, GPU runtime is configured
- [ ] Phase 335: Add check: network connectivity — verify gateway port is reachable from agent, check for firewall blocking, test DNS resolution
- [ ] Phase 336: Add check: disk space — verify sufficient space for model storage (warn at <10GB, fail at <1GB), check tmpdir space
- [ ] Phase 337: Add check: memory — verify sufficient RAM for gateway (4GB minimum), check swap configuration, detect OOM risk
- [ ] Phase 338: Add check: port availability — verify required ports (8080, 8081, 9090) are not in use by other processes
- [ ] Phase 339: Add check: config validity — parse `config.yaml`, verify all required fields present, validate values against schema
- [ ] Phase 340: Add check: TLS certificates — verify certs are valid, not expired, CA chain is complete, key permissions are correct
- [ ] Phase 341: Add check: cluster connectivity — from agent, verify gateway is reachable, authentication works, node is registered
- [ ] Phase 342: Add check: model accessibility — verify model files exist, checksums match, file permissions allow reading
- [ ] Phase 343: Implement `tentaclaw doctor --fix` mode — auto-remediate issues where possible (install missing packages, fix permissions, open ports)
- [ ] Phase 344: Add `tentaclaw doctor --json` output — machine-readable results for integration with monitoring systems
- [ ] Phase 345: Add `tentaclaw doctor` to post-install automatically — run after `tentaclaw init`, highlight any issues before first use
- [ ] Phase 346: Write tests for doctor command — mock each failure mode, verify correct detection and remediation message
- [ ] Phase 347: Commit "feat: doctor command — 12 diagnostic checks, auto-fix mode, JSON output"

---

### Wave 22: Dashboard Visual Polish (Phases 348-364)
*The dashboard is the first thing users see after install. It must feel premium.*

- [ ] Phase 348: Audit all dashboard animations — remove janky transitions, ensure 60fps on mid-range hardware, add `prefers-reduced-motion` respect
- [ ] Phase 349: Implement consistent loading skeletons — shimmer effect matching component layout for every async data fetch
- [ ] Phase 350: Fix dark mode inconsistencies — audit every component for proper dark/light theme colors, test with both themes
- [ ] Phase 351: Add smooth number transitions — animate counter changes (GPU utilization, request count, tok/s) with easing instead of jumping
- [ ] Phase 352: Implement proper error states — every widget shows contextual error message instead of blank space or generic "Error"
- [ ] Phase 353: Add empty states with CLAWtopus illustrations — "No models loaded yet" with octopus looking curious, "No nodes connected" with lonely octopus
- [ ] Phase 354: Fix responsive layout breakpoints — test at 1920px, 1440px, 1280px, 1024px, 768px; ensure all tabs are usable at every width
- [ ] Phase 355: Add drag-and-drop polish — smooth drop zones with visual feedback, snap-to-grid, undo with Ctrl+Z
- [ ] Phase 356: Implement toast notification system — success (green), warning (yellow), error (red), info (blue); auto-dismiss after 5s, stack up to 3
- [ ] Phase 357: Add favicon with CLAWtopus icon — 16x16, 32x32, 180x180 (apple-touch-icon), SVG for modern browsers
- [ ] Phase 358: Implement page title updates — "TentaCLAW — Dashboard", "TentaCLAW — Models (20)", "TentaCLAW — Nodes (4)" with dynamic counts
- [ ] Phase 359: Add keyboard navigation — Tab through interactive elements, Enter to activate, Escape to close modals, arrow keys in lists
- [ ] Phase 360: Implement dashboard tour for first-time users — 5-step guided overlay: cluster status, models, nodes, requests, settings
- [ ] Phase 361: Add CLAWtopus personality micro-interactions — tentacle wave on login, celebrate animation when cluster reaches 100% health
- [ ] Phase 362: Test dashboard with Lighthouse — target score: Performance 90+, Accessibility 95+, Best Practices 95+, SEO 90+
- [ ] Phase 363: Fix all Lighthouse accessibility issues — proper ARIA labels, color contrast ratios, focus indicators, screen reader compatibility
- [ ] Phase 364: Commit "polish: dashboard visual overhaul — skeletons, animations, dark mode, accessibility, CLAWtopus micro-interactions"

---

### Wave 23: Dashboard Mobile Responsiveness (Phases 365-380)
*Operators check cluster health on their phones. Mobile must be fully functional.*

- [ ] Phase 365: Implement mobile navigation — hamburger menu, slide-out sidebar, bottom tab bar for primary actions
- [ ] Phase 366: Redesign cluster overview for mobile — stack cards vertically, collapse charts to sparklines, swipe between GPU cards
- [ ] Phase 367: Make model list mobile-friendly — card layout instead of table, key info visible without scrolling, tap to expand details
- [ ] Phase 368: Make node list mobile-friendly — similar card layout, GPU utilization bars visible, tap for detailed node view
- [ ] Phase 369: Redesign request log for mobile — compact rows, swipe to reveal details, filter chips instead of dropdown menus
- [ ] Phase 370: Make settings page mobile-friendly — full-width form fields, proper touch targets (minimum 44x44px), sectioned with collapsible groups
- [ ] Phase 371: Add pull-to-refresh gesture — refresh cluster data on pull-down, with CLAWtopus animation during refresh
- [ ] Phase 372: Test on iOS Safari (iPhone 14/15) — verify no iOS-specific layout bugs, safe area insets, viewport meta tag correct
- [ ] Phase 373: Test on Android Chrome (Pixel 7/8) — verify Material Design-like touch behavior, no overflow issues, system back button works
- [ ] Phase 374: Test on iPad — verify intermediate layout works, not just stretched phone or shrunk desktop
- [ ] Phase 375: Add PWA manifest — `manifest.json` with icons, theme color, standalone display mode, install prompt
- [ ] Phase 376: Implement offline fallback page — "Cluster Offline" page with cached cluster name and last-known status
- [ ] Phase 377: Add service worker for static asset caching — cache CSS/JS/images, network-first strategy for API data
- [ ] Phase 378: Test PWA installation on iOS and Android — verify app icon, splash screen, fullscreen mode
- [ ] Phase 379: Write mobile usage documentation — screenshots of mobile layouts, tips for mobile management workflows
- [ ] Phase 380: Commit "responsive: full mobile dashboard — navigation, cards, PWA, touch gestures, pull-to-refresh"

---

### Wave 24: CLI Completions & Polish (Phases 381-396)
*CLI power users expect shell completions and consistent behavior.*

- [ ] Phase 381: Implement bash completion script — complete commands, subcommands, flags, model names, node IDs
- [ ] Phase 382: Implement zsh completion script — with descriptions for each command, grouped completions, cached model/node lists
- [ ] Phase 383: Implement fish completion script — use fish's native completion system, test with fish 3.6+
- [ ] Phase 384: Add completion installation to `tentaclaw init` — auto-detect shell, offer to install completions, add source line to rc file
- [ ] Phase 385: Implement PowerShell completion for Windows users — Register-ArgumentCompleter, test on PowerShell 7+
- [ ] Phase 386: Add `tentaclaw completion <shell>` command — output completion script for specified shell, pipe-friendly
- [ ] Phase 387: Audit all 111 CLI commands for consistency — verify flag naming (--format vs -f), output formatting, error message style
- [ ] Phase 388: Add `--output json|yaml|table|wide` flag to all list commands — machine-parseable output for scripting
- [ ] Phase 389: Add `--quiet` flag to all commands — suppress non-essential output, exit code only; useful for scripting
- [ ] Phase 390: Implement `--dry-run` for destructive commands — show what would happen without executing: model delete, node remove, config reset
- [ ] Phase 391: Add color theme support — `tentaclaw config set theme <ocean|neon|mono|none>`, persist in config, respect `NO_COLOR` env var
- [ ] Phase 392: Implement command aliases — `tentaclaw m` for `tentaclaw models`, `tentaclaw n` for `tentaclaw nodes`, configurable
- [ ] Phase 393: Add `tentaclaw history` command — show last 50 commands with timestamps, filterable by command type
- [ ] Phase 394: Improve help text for all commands — add examples section with 3 real-world usage examples per command
- [ ] Phase 395: Test CLI on Windows Terminal, iTerm2, Alacritty, and GNOME Terminal — verify unicode rendering, color support, cursor behavior
- [ ] Phase 396: Commit "polish: CLI completions — bash/zsh/fish/PowerShell, consistency audit, output formats, color themes"

---

### Wave 25: Keyboard Shortcuts & Accessibility (Phases 397-412)
*Power users demand keyboard shortcuts. Accessibility is a legal requirement in enterprise.*

- [ ] Phase 397: Implement keyboard shortcuts overlay — press `?` to show all shortcuts, Escape to dismiss, searchable
- [ ] Phase 398: Add global shortcuts — `g h` (go home), `g m` (go models), `g n` (go nodes), `g r` (go requests), `g s` (go settings)
- [ ] Phase 399: Add action shortcuts — `n` (new model), `r` (refresh), `/` (focus search), `Escape` (close modal/panel)
- [ ] Phase 400: Add vim-style navigation in lists — `j`/`k` for up/down, `Enter` to open, `x` to select, `d` to delete selected
- [ ] Phase 401: Implement focus trap in modals — Tab cycles within modal, no focus escaping to background content
- [ ] Phase 402: Add ARIA roles to all dashboard components — `role="navigation"`, `role="main"`, `role="dialog"`, `role="alert"`
- [ ] Phase 403: Add ARIA labels to all interactive elements — buttons, links, form fields, charts; meaningful labels not "Button 1"
- [ ] Phase 404: Implement screen reader announcements — live regions for dynamic updates: "Model loaded", "Node disconnected", "Request completed"
- [ ] Phase 405: Add high-contrast mode — toggleable in settings, WCAG AAA contrast ratios, visible focus indicators
- [ ] Phase 406: Test with VoiceOver (macOS) — navigate entire dashboard, verify all content is announced, all actions are performable
- [ ] Phase 407: Test with NVDA (Windows) — same verification as VoiceOver, ensure Windows screen reader compatibility
- [ ] Phase 408: Test with keyboard-only navigation — tab through every interactive element, verify logical focus order, no focus traps outside modals
- [ ] Phase 409: Add `prefers-reduced-motion` support — disable all animations when user has system setting enabled
- [ ] Phase 410: Add `prefers-color-scheme` auto-detection — respect system dark/light mode preference, allow manual override
- [ ] Phase 411: Write accessibility statement for tentaclaw.io — WCAG 2.1 AA conformance level, known limitations, feedback mechanism
- [ ] Phase 412: Commit "a11y: keyboard shortcuts, ARIA roles, screen reader support, high contrast mode"

---

### Wave 26: OpenAI API Compatibility — Full Verification (Phases 413-429)
*Every tool that speaks OpenAI API must work with TentaCLAW. Test every endpoint.*

- [ ] Phase 413: Create OpenAI API compatibility test suite — automated tests for every endpoint in OpenAI's API reference
- [ ] Phase 414: Test `POST /v1/chat/completions` — verify request/response schema matches OpenAI exactly: messages array, model field, temperature, max_tokens
- [ ] Phase 415: Test `POST /v1/chat/completions` streaming — verify SSE format matches OpenAI: `data: {"choices":[{"delta":{"content":"..."}}]}`, final `data: [DONE]`
- [ ] Phase 416: Test `POST /v1/completions` (legacy) — verify prompt string input, logprobs, echo, best_of parameters work correctly
- [ ] Phase 417: Test `GET /v1/models` — verify response lists all loaded models with correct schema: id, object, created, owned_by
- [ ] Phase 418: Test `POST /v1/embeddings` — verify embedding generation, response format with `embedding` array, `usage` object
- [ ] Phase 419: Test function calling — verify `tools` parameter, `tool_choice`, and `tool_calls` in response match OpenAI's format exactly
- [ ] Phase 420: Test JSON mode — verify `response_format: { "type": "json_object" }` produces valid JSON, `response_format: { "type": "json_schema" }` validates
- [ ] Phase 421: Test vision input — verify `image_url` content type in messages, base64 image encoding, multi-image messages
- [ ] Phase 422: Test `POST /v1/audio/transcriptions` compatibility (Whisper) — verify file upload, response format, language parameter
- [ ] Phase 423: Test error responses — verify error format matches OpenAI: `{"error": {"message": "...", "type": "...", "code": "..."}}` for all error codes
- [ ] Phase 424: Test `usage` field in responses — verify `prompt_tokens`, `completion_tokens`, `total_tokens` are accurate and present
- [ ] Phase 425: Test `n` parameter — multiple completions per request, verify `choices` array has correct length
- [ ] Phase 426: Test `stop` sequences — verify generation stops at specified strings, multiple stop sequences, regex stops if supported
- [ ] Phase 427: Test `logprobs` parameter — verify top_logprobs response format matches OpenAI's schema
- [ ] Phase 428: Write OpenAI compatibility documentation — tested endpoints, known differences, unsupported features, workarounds
- [ ] Phase 429: Commit "compat: OpenAI API verification — chat, completions, embeddings, function calling, vision, audio"

---

### Wave 27: Anthropic Messages API Compatibility (Phases 430-445)
*Anthropic's API is the second most popular. Native support removes a barrier.*

- [ ] Phase 430: Implement Anthropic Messages API endpoint at `/v1/messages` — translate to internal format, route to appropriate model
- [ ] Phase 431: Map Anthropic message roles — `user`, `assistant` with `content` blocks (text, image, tool_use, tool_result)
- [ ] Phase 432: Implement Anthropic streaming format — `event: message_start`, `event: content_block_start`, `event: content_block_delta`, `event: message_stop`
- [ ] Phase 433: Implement Anthropic `system` parameter — separate from messages array, map to model's system prompt format
- [ ] Phase 434: Implement Anthropic tool use — `tools` parameter with `input_schema`, `tool_use` content blocks in response, `tool_result` in follow-up
- [ ] Phase 435: Implement Anthropic `max_tokens` (required field) — map to model's max generation length, return error if not provided
- [ ] Phase 436: Implement Anthropic `usage` response field — `input_tokens`, `output_tokens` in response body and streaming events
- [ ] Phase 437: Implement Anthropic error format — `{"type": "error", "error": {"type": "...", "message": "..."}}` matching their spec
- [ ] Phase 438: Test with Anthropic Python SDK — `pip install anthropic`, point `base_url` at TentaCLAW, verify `client.messages.create()` works
- [ ] Phase 439: Test with Anthropic TypeScript SDK — `npm install @anthropic-ai/sdk`, verify streaming and non-streaming work
- [ ] Phase 440: Test multi-turn conversation — verify message history with alternating user/assistant roles processes correctly
- [ ] Phase 441: Test Anthropic vision — image content blocks with `source.type: base64` and `source.type: url`, verify model receives image
- [ ] Phase 442: Implement model name mapping — `claude-3-opus` → user's configured model, configurable model alias table in config
- [ ] Phase 443: Write Anthropic compatibility docs — supported features, model mapping guide, known differences from Anthropic's API
- [ ] Phase 444: Add Anthropic API to compatibility test suite — run alongside OpenAI tests in CI
- [ ] Phase 445: Commit "compat: Anthropic Messages API — streaming, tool use, vision, SDK-verified"

---

### Wave 28: LiteLLM & Proxy Integration (Phases 446-461)
*LiteLLM is the universal proxy. Integration means TentaCLAW works with 100+ tools instantly.*

- [ ] Phase 446: Test TentaCLAW as a LiteLLM provider — configure `litellm_settings.yaml` with TentaCLAW endpoint, verify routing works
- [ ] Phase 447: Write LiteLLM custom provider module — `litellm.tentaclaw` provider that maps LiteLLM's interface to TentaCLAW's API
- [ ] Phase 448: Test LiteLLM load balancing — configure multiple TentaCLAW nodes as LiteLLM backends, verify round-robin and least-connections
- [ ] Phase 449: Test LiteLLM fallback — primary model unavailable, verify LiteLLM falls back to secondary model on TentaCLAW
- [ ] Phase 450: Test LiteLLM cost tracking — verify per-request cost attribution works with TentaCLAW's custom pricing
- [ ] Phase 451: Implement LiteLLM-compatible `/model/info` endpoint — return model metadata in LiteLLM's expected format
- [ ] Phase 452: Test LiteLLM with function calling passthrough — verify tool calls work end-to-end through LiteLLM proxy to TentaCLAW
- [ ] Phase 453: Test LiteLLM with streaming passthrough — verify SSE chunks pass through LiteLLM without corruption or buffering
- [ ] Phase 454: Write LiteLLM integration guide — step-by-step: install LiteLLM, configure TentaCLAW backend, test with curl, use with LangChain
- [ ] Phase 455: Submit PR to LiteLLM repository — add TentaCLAW as an official provider in their docs and provider list
- [ ] Phase 456: Test TentaCLAW as LiteLLM replacement — for users who currently use LiteLLM, show how TentaCLAW's built-in routing eliminates the need
- [ ] Phase 457: Benchmark LiteLLM overhead — measure latency added by LiteLLM proxy layer, document when direct TentaCLAW API is faster
- [ ] Phase 458: Test with LangChain via LiteLLM — `ChatLiteLLM(model="tentaclaw/llama-3.1-70b")`, verify chain execution works
- [ ] Phase 459: Test with LlamaIndex via LiteLLM — verify query engine, RAG pipeline, and agent workflows work through TentaCLAW
- [ ] Phase 460: Add LiteLLM to integration test CI — weekly test against latest LiteLLM release, alert on breakage
- [ ] Phase 461: Commit "compat: LiteLLM integration — provider module, load balancing, fallback, LangChain/LlamaIndex verified"

---

### Wave 29: Open WebUI & Chat Frontend Compatibility (Phases 462-477)
*Open WebUI has 500K+ users. Plug-and-play compatibility = instant user base.*

- [ ] Phase 462: Test Open WebUI connection to TentaCLAW — configure `OPENAI_API_BASE_URL` pointing to TentaCLAW gateway, verify model list populates
- [ ] Phase 463: Verify chat functionality — send messages through Open WebUI, verify responses stream correctly, conversation history works
- [ ] Phase 464: Test model switching in Open WebUI — verify all TentaCLAW models appear in dropdown, switching models mid-conversation works
- [ ] Phase 465: Test Open WebUI RAG features — file upload, document parsing, context injection; verify TentaCLAW handles the augmented prompts
- [ ] Phase 466: Test Open WebUI image generation — if TentaCLAW serves a diffusion model, verify Open WebUI's image gen UI works
- [ ] Phase 467: Test Open WebUI function calling — verify tool use UI, function definitions pass through, results render correctly
- [ ] Phase 468: Test Open WebUI multi-user mode — multiple Open WebUI users hitting TentaCLAW simultaneously, verify isolation and performance
- [ ] Phase 469: Fix any compatibility gaps discovered during testing — response format differences, missing fields, header issues
- [ ] Phase 470: Test with LobeChat — alternative chat frontend, verify same OpenAI-compatible endpoint works
- [ ] Phase 471: Test with BetterChatGPT — another popular frontend, verify compatibility
- [ ] Phase 472: Test with chatbot-ui (McKay Wrigley) — verify streaming, conversation management, model selection
- [ ] Phase 473: Test with LibreChat — verify multi-model switching, plugin system compatibility
- [ ] Phase 474: Create "Compatible Frontends" documentation page — tested frontends with configuration screenshots and tips
- [ ] Phase 475: Add frontend compatibility to integration test CI — Docker Compose stack with Open WebUI + TentaCLAW, automated smoke test
- [ ] Phase 476: Write blog post: "Use Open WebUI with Your TentaCLAW Cluster" — step-by-step with screenshots
- [ ] Phase 477: Commit "compat: Open WebUI, LobeChat, LibreChat, BetterChatGPT — verified and documented"

---

### Wave 30: Continue.dev & IDE Integration (Phases 478-493)
*Developers live in their IDE. Continue.dev is the open-source Copilot alternative.*

- [ ] Phase 478: Test Continue.dev with TentaCLAW — configure `.continue/config.json` with TentaCLAW endpoint, verify autocomplete works
- [ ] Phase 479: Verify Continue.dev chat functionality — sidebar chat with TentaCLAW model, context from open files, codebase indexing
- [ ] Phase 480: Test Continue.dev autocomplete (tab completion) — verify low-latency suggestions, context-aware completions from TentaCLAW
- [ ] Phase 481: Configure Continue.dev for optimal TentaCLAW performance — set `requestOptions.timeout`, `completionOptions.maxTokens`, model-specific settings
- [ ] Phase 482: Test with Cursor — configure custom API endpoint, verify chat and autocomplete work with TentaCLAW backend
- [ ] Phase 483: Test with Cody (Sourcegraph) — verify API compatibility for code intelligence features
- [ ] Phase 484: Test with Tabby — open-source code completion server, verify can use TentaCLAW as backend
- [ ] Phase 485: Test with Aider — CLI pair programming tool, verify `--openai-api-base` flag works with TentaCLAW
- [ ] Phase 486: Test with OpenHands (formerly OpenDevin) — AI software engineer, verify TentaCLAW as LLM backend
- [ ] Phase 487: Test with LangChain directly — `ChatOpenAI(base_url="http://tentaclaw:8080/v1")`, verify chains, agents, tools
- [ ] Phase 488: Test with LlamaIndex directly — similar verification for query engines, retrieval pipelines, agent workflows
- [ ] Phase 489: Test with CrewAI — multi-agent framework, verify all agents can use TentaCLAW backend concurrently
- [ ] Phase 490: Write "Developer Tools Integration" guide — IDE setup for 5 editors, framework setup for 4 frameworks
- [ ] Phase 491: Add IDE integration tests to CI — weekly automated test with Continue.dev Docker container
- [ ] Phase 492: Record video: "Replace GitHub Copilot with TentaCLAW + Continue.dev" — side-by-side comparison
- [ ] Phase 493: Commit "compat: IDE integrations — Continue.dev, Cursor, Tabby, Aider, LangChain, LlamaIndex, CrewAI"

---

### Wave 31: MCP Server Implementation (Phases 494-510)
*Model Context Protocol has 97M monthly installs. TentaCLAW must be a first-class MCP server.*

- [ ] Phase 494: Implement MCP server in gateway — expose TentaCLAW capabilities as MCP tools following the 2025-06 spec
- [ ] Phase 495: Define MCP tool: `tentaclaw_generate` — parameters: model, prompt, max_tokens, temperature; returns generated text
- [ ] Phase 496: Define MCP tool: `tentaclaw_chat` — parameters: messages array, model, stream; returns assistant message
- [ ] Phase 497: Define MCP tool: `tentaclaw_models` — no parameters; returns list of available models with metadata
- [ ] Phase 498: Define MCP tool: `tentaclaw_cluster_status` — returns node count, GPU count, VRAM total/used, health score
- [ ] Phase 499: Define MCP tool: `tentaclaw_load_model` — parameters: model_name, node_id (optional); loads model onto cluster
- [ ] Phase 500: Define MCP tool: `tentaclaw_benchmark` — parameters: model, prompt_length, num_requests; returns tok/s, TTFT, latency stats
- [ ] Phase 501: Implement MCP resource: `tentaclaw://models/{model_id}` — model metadata, configuration, performance stats
- [ ] Phase 502: Implement MCP resource: `tentaclaw://nodes/{node_id}` — node hardware info, GPU status, running models
- [ ] Phase 503: Implement MCP resource: `tentaclaw://metrics` — real-time cluster metrics as MCP resource
- [ ] Phase 504: Test MCP server with Claude Desktop — add TentaCLAW MCP server to Claude config, verify tools appear and work
- [ ] Phase 505: Test MCP server with Cursor — verify TentaCLAW tools available in Cursor's MCP integration
- [ ] Phase 506: Test MCP server with Zed — verify MCP tool discovery and invocation
- [ ] Phase 507: Implement MCP stdio transport — for local connections, support JSON-RPC over stdin/stdout
- [ ] Phase 508: Implement MCP HTTP+SSE transport — for remote connections, support server-sent events for streaming responses
- [ ] Phase 509: Write MCP integration documentation — setup guide for Claude Desktop, Cursor, Zed; tool reference
- [ ] Phase 510: Commit "feat: MCP server — 7 tools, 3 resources, stdio + HTTP+SSE transport, Claude/Cursor/Zed verified"

---

### Wave 32: A2A Protocol Support (Phases 511-526)
*Agent-to-Agent protocol enables TentaCLAW to participate in multi-agent workflows.*

- [ ] Phase 511: Implement A2A agent card at `/.well-known/agent.json` — declare TentaCLAW's capabilities, supported skills, authentication methods
- [ ] Phase 512: Define A2A skill: `inference` — description: "Run LLM inference on a GPU cluster", input/output schemas
- [ ] Phase 513: Define A2A skill: `cluster-management` — description: "Manage GPU cluster nodes, models, and configuration"
- [ ] Phase 514: Define A2A skill: `benchmark` — description: "Benchmark model performance on the cluster"
- [ ] Phase 515: Implement A2A task lifecycle — `tasks/send`, `tasks/get`, `tasks/cancel` endpoints per A2A v0.3 spec
- [ ] Phase 516: Implement A2A streaming — `tasks/sendSubscribe` with SSE for long-running inference tasks
- [ ] Phase 517: Implement A2A push notifications — webhook callback for task completion, configurable endpoint
- [ ] Phase 518: Add A2A authentication — API key and OAuth2 support in agent card, verify incoming agent requests
- [ ] Phase 519: Test A2A discovery — verify another A2A agent can discover TentaCLAW via `/.well-known/agent.json` and invoke skills
- [ ] Phase 520: Test multi-agent workflow — Agent A (orchestrator) sends inference task to TentaCLAW via A2A, receives results, chains to Agent B
- [ ] Phase 521: Test A2A with Google's ADK — verify TentaCLAW works as a remote agent in Google's Agent Development Kit
- [ ] Phase 522: Test A2A with LangGraph — verify TentaCLAW agent node in a LangGraph workflow graph
- [ ] Phase 523: Implement A2A rate limiting — per-agent rate limits, configurable in config, prevent single agent from overwhelming cluster
- [ ] Phase 524: Add A2A metrics — track tasks per agent, latency per skill, success/failure rates
- [ ] Phase 525: Write A2A integration guide — how to use TentaCLAW as a remote agent, example workflows with code
- [ ] Phase 526: Commit "feat: A2A protocol — agent card, 3 skills, task lifecycle, streaming, push notifications"

---

### Wave 33: v1.0 Feature Freeze & Stabilization (Phases 527-542)
*No new features. Only bug fixes, test coverage, and polish.*

- [ ] Phase 527: Declare feature freeze — no new features merged after this point, only bug fixes and documentation
- [ ] Phase 528: Run full test suite on Proxmox reference cluster — all 782 tests + new tests from Waves 1-32, target zero failures
- [ ] Phase 529: Fix all known P0 and P1 bugs — triage open issues, assign to team members, deadline: 48 hours
- [ ] Phase 530: Run memory leak testing — 24-hour sustained load test, monitor RSS memory growth, fix any leaks found
- [ ] Phase 531: Run stress testing — 10x expected concurrent users, measure degradation curve, find and fix bottlenecks
- [ ] Phase 532: Run chaos testing — randomly kill processes, disconnect nodes, exhaust GPU memory; verify graceful degradation
- [ ] Phase 533: Audit all error messages — ensure every error is actionable, includes error code, suggests fix or links to docs
- [ ] Phase 534: Audit all log messages — ensure appropriate log levels (debug/info/warn/error), no sensitive data in info-level logs
- [ ] Phase 535: Run full accessibility audit — WCAG 2.1 AA compliance check, fix any remaining violations
- [ ] Phase 536: Run performance profiling on gateway — identify top 5 slowest code paths, optimize each to < 10ms p99
- [ ] Phase 537: Update all dependency versions — final dependency update before release, run full test suite after updates
- [ ] Phase 538: Verify all documentation is current — API reference matches code, quickstart works on clean install, all links valid
- [ ] Phase 539: Run spell check and grammar check on all docs — `cspell` on Markdown files, fix all issues
- [ ] Phase 540: Test upgrade path from v0.x to v1.0 — `tentaclaw upgrade` preserves config, data, and running models
- [ ] Phase 541: Write v1.0 migration guide — breaking changes from v0.x, step-by-step upgrade instructions
- [ ] Phase 542: Commit "stabilize: v1.0 feature freeze — bug fixes, memory leaks, stress testing, docs audit"

---

### Wave 34: v1.0 Release Candidate (Phases 543-558)
*Build the release candidate. Test it everywhere. Get Champions feedback.*

- [ ] Phase 543: Cut release branch `release/v1.0` from `main` — only cherry-picked fixes allowed after this point
- [ ] Phase 544: Build RC1 binaries — linux-amd64, linux-arm64, darwin-amd64, darwin-arm64, windows-amd64
- [ ] Phase 545: Build RC1 Docker images — multi-arch, push to `ghcr.io/tentaclaw-os/tentaclaw:v1.0.0-rc1`
- [ ] Phase 546: Build RC1 .deb and .rpm packages — test installation on fresh VMs
- [ ] Phase 547: Deploy RC1 to Proxmox reference cluster — full end-to-end test: install, configure, load models, run inference, check dashboard
- [ ] Phase 548: Distribute RC1 to Champions — private Discord announcement, ask for testing on diverse hardware setups
- [ ] Phase 549: Create RC1 testing checklist — 30 items covering install, config, models, inference, streaming, dashboard, CLI, clustering
- [ ] Phase 550: Monitor Champions feedback for 72 hours — triage reports, fix blockers, cherry-pick fixes into release branch
- [ ] Phase 551: Build RC2 with Champions fixes — repeat binary/Docker/package build process
- [ ] Phase 552: Run automated release qualification tests — full CI suite + integration tests + performance benchmarks against RC2
- [ ] Phase 553: Verify GPG signatures on all RC2 artifacts — checksums file signed, binaries verified, container images cosigned
- [ ] Phase 554: Test clean install on 5 different environments — Ubuntu VM, Fedora bare-metal, Docker Compose, Mac M-series, Proxmox cluster
- [ ] Phase 555: Verify OpenAI/Anthropic API compatibility on RC2 — run full compatibility test suites
- [ ] Phase 556: Verify MCP server functionality on RC2 — test with Claude Desktop
- [ ] Phase 557: Write RC2 known issues list — any accepted limitations for v1.0, with planned fix versions
- [ ] Phase 558: Commit "release: v1.0.0-rc2 — Champions-tested, multi-platform verified"

---

### Wave 35: Changelog & Release Notes (Phases 559-574)
*Professional release notes signal maturity. Every user reads these.*

- [ ] Phase 559: Generate full changelog from git history — categorize: Features, Bug Fixes, Performance, Security, Breaking Changes, Dependencies
- [ ] Phase 560: Write human-readable release notes — not just git log; narrative explaining what v1.0 means and why it matters
- [ ] Phase 561: Create visual release highlights — 5 screenshots/GIFs showing marquee features: dashboard, CLI, cluster, MCP, badges
- [ ] Phase 562: Write upgrade guide section — step-by-step from v0.x to v1.0, database migrations, config changes, backup instructions
- [ ] Phase 563: Write "What's New in v1.0" blog post — 1500 words, covers top 10 features with screenshots, links to docs
- [ ] Phase 564: Create release announcement graphics — Twitter card (1200x675), Reddit thumbnail, Discord embed, LinkedIn banner
- [ ] Phase 565: Write Twitter/X release thread — 10 tweets covering the journey from v0.x to v1.0, metrics, thank-yous, what's next
- [ ] Phase 566: Write Reddit release post for r/LocalLLaMA — focus on technical achievements, benchmark results, community contributions
- [ ] Phase 567: Write Reddit release post for r/selfhosted — focus on practical benefits, easy install, Proxmox integration
- [ ] Phase 568: Prepare Hacker News post — "TentaCLAW v1.0: Open-Source GPU Cluster OS for AI Inference"
- [ ] Phase 569: Write Discord announcement — detailed changelog, migration notes, thank everyone by name who contributed
- [ ] Phase 570: Prepare Product Hunt update — new screenshots, updated description, v1.0 announcement
- [ ] Phase 571: Write press release template — for tech media outreach, focus on "open-source alternative to per-token API pricing"
- [ ] Phase 572: Create release video — 3-minute overview of v1.0 features, production quality, narrated demo
- [ ] Phase 573: Prepare email to newsletter subscribers — personalized, highlight what's new since they signed up
- [ ] Phase 574: Commit "docs: v1.0 release notes, changelog, blog post, announcement materials"

---

### Wave 36: v1.0.0 "Sucker" Release (Phases 575-590)
*The moment. Ship it. Announce it. Celebrate it.*

- [ ] Phase 575: Final review of release branch — core team signs off, all tests pass, no P0/P1 open issues
- [ ] Phase 576: Tag `v1.0.0` on release branch — annotated tag with release notes summary
- [ ] Phase 577: Build final release binaries — sign with GPG, generate checksums, verify signatures
- [ ] Phase 578: Push Docker images — `v1.0.0`, `v1`, `latest` tags to `ghcr.io/tentaclaw-os/tentaclaw`
- [ ] Phase 579: Publish GitHub Release — upload binaries, .deb, .rpm, checksums, SBOM, attach release notes
- [ ] Phase 580: Deploy v1.0 to tentaclaw.io — update website download links, version badge, documentation
- [ ] Phase 581: Post Hacker News announcement at 8:00 AM ET Monday
- [ ] Phase 582: Post Reddit announcements — r/LocalLLaMA, r/selfhosted, r/homelab
- [ ] Phase 583: Post Twitter/X thread — pin tweet, engage with replies for 6 hours
- [ ] Phase 584: Post Discord announcement — @everyone, celebrate with community
- [ ] Phase 585: Send newsletter to subscribers — v1.0 announcement, highlights, call to action
- [ ] Phase 586: Update Homebrew formula to v1.0.0 — submit PR to homebrew-core or update tap
- [ ] Phase 587: Update AUR package to v1.0.0 — publish updated PKGBUILD
- [ ] Phase 588: Monitor all channels for 48 hours — respond to every comment, bug report, question within 2 hours
- [ ] Phase 589: Track v1.0 launch metrics — stars, downloads, installs, Discord growth, website traffic, media mentions
- [ ] Phase 590: Commit "release: v1.0.0 'Sucker' — shipped and announced"

---

### Wave 37: v1.0 Post-Launch Support (Phases 591-607)
*First week after v1.0 — critical support window, hot fixes, community engagement.*

- [ ] Phase 591: Set up v1.0 issue triage rotation — core team members rotate daily for first week, 4-hour response SLA on new issues
- [ ] Phase 592: Create v1.0 known issues tracker — living document of reported issues, workarounds, planned fix versions
- [ ] Phase 593: Fix top 5 user-reported bugs — same-day patch for anything blocking install or basic functionality
- [ ] Phase 594: Release v1.0.1 patch — accumulated fixes from first 72 hours, announce in Discord and on HN thread
- [ ] Phase 595: Write "Common Issues After Upgrading to v1.0" FAQ — based on actual support tickets and Discord questions
- [ ] Phase 596: Update quickstart guide with v1.0-specific instructions — any changes in flow, new flags, updated screenshots
- [ ] Phase 597: Host post-launch office hours — special edition, demo v1.0 features, answer questions live, 1 hour
- [ ] Phase 598: Write blog post: "TentaCLAW v1.0 Launch Retrospective" — metrics, surprises, community stories, what's next
- [ ] Phase 599: Send personal thank-you messages to top 20 contributors — GitHub, Discord, email; acknowledge specific contributions
- [ ] Phase 600: Update public roadmap with v2.0 preview — signal what's coming next to keep community engaged
- [ ] Phase 601: Create v1.0 contributor credits page — everyone who contributed code, docs, testing, or community support
- [ ] Phase 602: Analyze telemetry data (opt-in users) — understand common cluster sizes, GPU types, model choices, usage patterns
- [ ] Phase 603: Prioritize v1.1 backlog — based on user feedback, telemetry, and strategic goals; publish updated roadmap
- [ ] Phase 604: Release v1.0.2 patch — second round of fixes, performance improvements from profiling real usage
- [ ] Phase 605: Write "What We Learned from 1000 Installs" blog post — anonymized telemetry insights, surprising findings
- [ ] Phase 606: Archive launch materials — organize all content, graphics, posts into `marketing/v1.0-launch/` for future reference
- [ ] Phase 607: Commit "support: v1.0 post-launch — patches, FAQ, retrospective, contributor credits"

---

### Wave 38: v1.0 Metrics & Analytics (Phases 608-623)
*Measure everything. Data-driven decisions for v2.0 roadmap.*

- [ ] Phase 608: Implement download counter — track binary downloads, Docker pulls, package installs by platform and version
- [ ] Phase 609: Set up GitHub star tracking — daily star count, growth rate, compare to GPUStack/Ollama/vLLM growth curves
- [ ] Phase 610: Implement anonymous usage telemetry dashboard — cluster size distribution, GPU type distribution, model popularity rankings
- [ ] Phase 611: Track time-to-first-inference — measure from `tentaclaw init` to first successful `chat/completions` call; target < 10 minutes
- [ ] Phase 612: Track installer success rate — percentage of installs that reach healthy cluster state vs abandon; target > 90%
- [ ] Phase 613: Set up NPS (Net Promoter Score) survey — trigger at day 7 and day 30, in-dashboard prompt, 1-10 scale + free text
- [ ] Phase 614: Analyze NPS results — segment by cluster size, GPU vendor, use case; identify promoters and detractors
- [ ] Phase 615: Track community health metrics — Discord DAU/MAU ratio, GitHub issue response time, PR merge time, contributor retention
- [ ] Phase 616: Set up conversion funnel tracking — website visit → install → first inference → daily user → contributor; measure drop-off at each stage
- [ ] Phase 617: Implement A/B testing framework for website — test different landing page headlines, CTA buttons, pricing presentation
- [ ] Phase 618: Track content performance — blog post views, video views, social media engagement; identify highest-performing content types
- [ ] Phase 619: Create weekly metrics report template — automated, sent to core team every Monday, covering all key metrics
- [ ] Phase 620: Set up alerting for metric anomalies — sudden drop in installs, spike in error reports, unusual download patterns
- [ ] Phase 621: Build internal metrics dashboard — Grafana dashboard with all growth metrics, accessible to core team
- [ ] Phase 622: Write "Metrics-Driven Roadmap" document — how metrics inform v2.0 priorities, evidence for each major feature decision
- [ ] Phase 623: Commit "analytics: download tracking, telemetry dashboard, NPS survey, conversion funnel, metrics reports"

---

### Wave 39: v1.0 Security Hardening Cycle (Phases 624-639)
*Post-launch security review with real-world exposure data.*

- [ ] Phase 624: Review all security-related issues reported since launch — categorize by severity, prioritize fixes
- [ ] Phase 625: Run post-launch penetration test — external perspective now that real users have tried to break things
- [ ] Phase 626: Audit authentication system under real load — verify no timing attacks, no race conditions in token validation
- [ ] Phase 627: Review rate limiter effectiveness — check if any users hit rate limits, verify limits are appropriate for real usage
- [ ] Phase 628: Audit cluster communication encryption — verify all inter-node traffic is encrypted in real multi-node deployments
- [ ] Phase 629: Review API key usage patterns — detect any keys with overly broad permissions, recommend tightening
- [ ] Phase 630: Update threat model with real-world observations — new attack vectors discovered, threat actor behavior patterns
- [ ] Phase 631: Run dependency vulnerability scan — check for any new CVEs in dependencies since release
- [ ] Phase 632: Update all dependencies with security patches — publish v1.0.3 with security fixes if needed
- [ ] Phase 633: Review audit log completeness — verify all security-relevant events are captured in real deployments
- [ ] Phase 634: Conduct security retrospective — document what worked, what gaps exist, priorities for v2.0 security
- [ ] Phase 635: Update SECURITY.md with post-launch information — updated response times, bug bounty details, security contact
- [ ] Phase 636: Publish first security advisory if any vulnerabilities found — demonstrate transparency and professionalism
- [ ] Phase 637: Begin SOC 2 readiness assessment — gap analysis, identify controls already met, plan for remaining controls
- [ ] Phase 638: Write security roadmap for v2.0-v3.0 — prioritized list of security features based on user needs and compliance requirements
- [ ] Phase 639: Commit "security: post-launch review — pen test, dependency audit, threat model update, SOC 2 gap analysis"

---

### Wave 40: v1.0 → v2.0 Bridge — Architecture Review (Phases 640-656)
*Evaluate what worked, what didn't, and what needs to change for v2.0.*

- [ ] Phase 640: Conduct architecture review — core team reviews gateway, agent, dashboard, CLI architecture for v2.0 readiness
- [ ] Phase 641: Identify performance bottlenecks — profiling data from real deployments, top 10 slowest operations
- [ ] Phase 642: Identify scalability limits — maximum nodes, maximum concurrent requests, maximum models before degradation
- [ ] Phase 643: Evaluate backend abstraction layer — does `InferenceBackend` trait support SGLang/Dynamo features or need extension?
- [ ] Phase 644: Evaluate request routing architecture — can current router support KV-aware routing, disaggregated inference, prefix caching?
- [ ] Phase 645: Evaluate dashboard architecture — can React SPA support real-time streaming metrics, 100+ nodes, benchmark visualization?
- [ ] Phase 646: Evaluate CLI architecture — are 111 commands maintainable? Should we split into subcommand groups? Plugin system?
- [ ] Phase 647: Evaluate agent architecture — can watchdog handle multiple backends simultaneously? GPU memory management?
- [ ] Phase 648: Write v2.0 architecture design doc — proposed changes, migration plan, backward compatibility commitments
- [ ] Phase 649: Identify technical debt — code that was shipped fast for v1.0 but needs refactoring for maintainability
- [ ] Phase 650: Plan v2.0 breaking changes — list all API changes, config format changes, CLI changes; write migration tooling requirements
- [ ] Phase 651: Define v2.0 performance targets — specific numbers: tok/s, TTFT p99, request latency p99, cache hit rate
- [ ] Phase 652: Define v2.0 scalability targets — 100 nodes, 1000 concurrent requests, 50 models loaded simultaneously
- [ ] Phase 653: Write v2.0 project plan — milestones, timeline, team assignments, dependency graph
- [ ] Phase 654: Present v2.0 plan to Champions — get feedback on priorities, identify beta testers for new features
- [ ] Phase 655: Create v2.0 tracking board — GitHub Project with columns: Backlog, In Progress, Review, Done; all tasks as issues
- [ ] Phase 656: Commit "planning: v2.0 architecture review — bottlenecks, design doc, performance targets, project plan"

---

# SECTION 2: v2.0 "INK" — Performance + Backends (Waves 41-70)

*Speed is the product. Make TentaCLAW the fastest self-hosted inference platform.*

---

### Wave 41: Backend Abstraction Layer v2 (Phases 657-673)
*Refactor the backend interface to support disaggregated inference, KV caching, and multi-engine coordination.*

- [ ] Phase 657: Design `BackendV2` trait — extend with `prefill()`, `decode()`, `transfer_kv()`, `cache_status()`, `supports_feature()` methods
- [ ] Phase 658: Add backend capability discovery — `BackendV2::capabilities()` returns feature flags: streaming, structured_output, vision, kv_transfer, speculative_decoding
- [ ] Phase 659: Implement backend registry — `BackendRegistry` manages multiple backend types, routes requests to appropriate backend based on model and capabilities
- [ ] Phase 660: Add backend lifecycle management — `BackendLifecycle` trait: `initialize()`, `warm_up()`, `cool_down()`, `shutdown()` with graceful transitions
- [ ] Phase 661: Implement backend health monitoring — periodic health checks, automatic restart on failure, health score (0-100) per backend instance
- [ ] Phase 662: Add backend metrics interface — standardized metrics across all backends: tokens_generated, latency_histogram, cache_hit_rate, gpu_utilization
- [ ] Phase 663: Implement backend fallback chain — if primary backend fails, automatically route to fallback backend with different engine
- [ ] Phase 664: Add backend configuration schema validation — each backend declares its config schema, gateway validates before passing to backend
- [ ] Phase 665: Write migration layer — `BackendV1` → `BackendV2` adapter so existing Ollama/llama.cpp backends work without changes
- [ ] Phase 666: Implement backend plugin system — load backends from shared libraries or HTTP endpoints, enable third-party backend development
- [ ] Phase 667: Add backend benchmarking harness — standardized benchmark that runs against any backend, compares tok/s, TTFT, memory usage
- [ ] Phase 668: Write unit tests for `BackendV2` trait — 30 test cases covering all methods, edge cases, error conditions
- [ ] Phase 669: Write integration test: register 3 backends, route requests based on capabilities, verify correct backend handles each request
- [ ] Phase 670: Document backend plugin API — how to implement a custom backend, example plugin, registration process
- [ ] Phase 671: Update architecture diagrams — show new backend layer, capability routing, fallback chains
- [ ] Phase 672: Benchmark abstraction overhead — measure latency added by v2 abstraction layer, target < 0.5ms per request
- [ ] Phase 673: Commit "refactor: BackendV2 — capabilities, registry, fallback chains, plugin system, metrics interface"

---

### Wave 42: SGLang Backend Adapter (Phases 674-690)
*SGLang is 29% faster than vLLM. Integrate it as a first-class backend.*

- [ ] Phase 674: Implement `SglangBackend` struct implementing `BackendV2` trait — HTTP client targeting SGLang's OpenAI-compatible API
- [ ] Phase 675: Write SGLang process manager — launch `python -m sglang.launch_server` with model path, port, TP degree, attention backend selection
- [ ] Phase 676: Implement `SglangBackend::load_model()` — configure RadixAttention cache size, chunked prefill, FlashInfer or Triton attention backend
- [ ] Phase 677: Implement `SglangBackend::generate()` — map TentaCLAW `GenerateRequest` to SGLang `/generate` with `sampling_params`
- [ ] Phase 678: Implement `SglangBackend::stream()` — consume SGLang SSE stream, translate to TentaCLAW `StreamChunk` events with backpressure
- [ ] Phase 679: Implement `SglangBackend::prefill()` — send prefill-only request for KV cache warming, return cache token for later decode
- [ ] Phase 680: Implement SGLang structured output support — pass `json_schema`, `regex`, or `grammar` constraints to SGLang's constrained decoding
- [ ] Phase 681: Implement SGLang multi-LoRA serving — load base model once, switch LoRA adapters per-request via `lora_path` parameter
- [ ] Phase 682: Add SGLang RadixAttention metrics — scrape cache hit rate, cache size, eviction rate; expose in TentaCLAW metrics
- [ ] Phase 683: Implement SGLang cache warming — on model load, prefill top 20 system prompts from usage history into RadixAttention cache
- [ ] Phase 684: Write integration test: load Llama-3.1-8B on SGLang, generate with JSON schema constraint, verify output validates
- [ ] Phase 685: Write integration test: load Qwen2.5-Coder-32B with TP=2, verify multi-GPU generation works, measure throughput
- [ ] Phase 686: Write integration test: SGLang with 3 LoRA adapters, switch between them per-request, verify correct outputs
- [ ] Phase 687: Write failover test: kill SGLang mid-generation, verify TentaCLAW detects failure within 2s and returns error to client
- [ ] Phase 688: Benchmark SGLang vs Ollama on Llama-3.1-8B — throughput at 1, 8, 32 concurrent requests, measure TTFT and ITL
- [ ] Phase 689: Document SGLang backend configuration — `docs/backends/sglang.md` with examples, tuning guide, troubleshooting
- [ ] Phase 690: Commit "feat(backend): SGLang integration — RadixAttention, structured output, multi-LoRA, cache warming"

---

### Wave 43: SGLang Advanced Features (Phases 691-706)
*Unlock SGLang's unique capabilities that no other backend offers.*

- [ ] Phase 691: Implement SGLang data parallelism — run N SGLang instances on N GPUs for independent throughput scaling
- [ ] Phase 692: Implement SGLang expert parallelism — distribute MoE expert layers across GPUs for Mixtral/DBRX models
- [ ] Phase 693: Add SGLang chunked prefill tuning — auto-tune chunk size based on GPU memory and model size for optimal TTFT
- [ ] Phase 694: Implement SGLang embedding extraction — extract hidden states from any layer for custom embedding pipelines
- [ ] Phase 695: Add SGLang reward model support — serve reward models for RLHF pipelines, return scalar reward scores
- [ ] Phase 696: Implement SGLang speculative decoding — enable EAGLE-style speculative decoding when draft model is available
- [ ] Phase 697: Add SGLang FP8 quantization support — auto-detect Hopper/Ada GPUs, enable FP8 KV cache and weights
- [ ] Phase 698: Implement SGLang cache-aware routing in gateway — route requests with matching prefixes to the SGLang instance that has them cached
- [ ] Phase 699: Add SGLang grammar-guided generation — BNF grammar support for precise output formatting (SQL, code, structured data)
- [ ] Phase 700: Implement SGLang batch scheduling optimization — group similar-length requests for better batching efficiency
- [ ] Phase 701: Write benchmark: SGLang grammar-guided SQL generation — measure tok/s with and without grammar constraint
- [ ] Phase 702: Write benchmark: SGLang speculative decoding — measure speedup on Llama-3.1-70B with 1B draft model
- [ ] Phase 703: Write benchmark: SGLang data parallelism — linear scaling test with 2, 4, 8 GPUs on independent requests
- [ ] Phase 704: Test SGLang with AMD GPUs (ROCm) — verify ROCm backend works, benchmark vs NVIDIA on same model
- [ ] Phase 705: Document SGLang advanced features — tuning guide for each feature, when to use what, performance expectations
- [ ] Phase 706: Commit "feat(backend): SGLang advanced — data/expert parallelism, speculative decoding, FP8, grammar-guided"

---

### Wave 44: NVIDIA Dynamo Backend — Foundation (Phases 707-723)
*Dynamo 1.0 is NVIDIA's inference OS. Integration gives TentaCLAW the best NVIDIA performance.*

- [ ] Phase 707: Study Dynamo 1.0 architecture — understand planner, worker, router, NIXL components and their APIs
- [ ] Phase 708: Implement `DynamoBackend` struct — communicate with Dynamo's gRPC API for inference requests
- [ ] Phase 709: Write Dynamo process orchestrator — manage Dynamo planner, workers, and router processes as a coordinated unit
- [ ] Phase 710: Implement `DynamoBackend::load_model()` — configure Dynamo to serve a model with specified TP/PP degree, memory allocation
- [ ] Phase 711: Implement `DynamoBackend::generate()` — route generation request through Dynamo's planner, receive response from worker
- [ ] Phase 712: Implement `DynamoBackend::stream()` — streaming responses from Dynamo workers, translate to TentaCLAW SSE format
- [ ] Phase 713: Add Dynamo health monitoring — check planner, all workers, router health; report component-level status
- [ ] Phase 714: Implement Dynamo metrics collection — scrape Dynamo's Prometheus metrics for throughput, latency, queue depth, GPU utilization
- [ ] Phase 715: Test Dynamo on single node with 4 GPUs — verify tensor parallelism works, measure throughput vs standalone vLLM
- [ ] Phase 716: Test Dynamo multi-node deployment — 2 nodes, 8 GPUs total, pipeline parallelism across nodes
- [ ] Phase 717: Write integration test: load Llama-3.1-70B via Dynamo with TP=4, generate 1000 tokens, verify correctness
- [ ] Phase 718: Write integration test: Dynamo streaming with 32 concurrent requests, verify no data corruption
- [ ] Phase 719: Benchmark Dynamo vs SGLang vs standalone vLLM — same model, same hardware, measure tok/s at various batch sizes
- [ ] Phase 720: Handle Dynamo version detection — auto-detect installed Dynamo version, warn on incompatible versions
- [ ] Phase 721: Implement graceful Dynamo shutdown — drain in-flight requests before stopping workers, prevent data loss
- [ ] Phase 722: Document Dynamo backend setup — prerequisites (NVIDIA GPU, CUDA 12+, Dynamo installed), configuration, troubleshooting
- [ ] Phase 723: Commit "feat(backend): NVIDIA Dynamo integration — planner, workers, router, multi-node TP/PP"

---

### Wave 45: Dynamo Disaggregated Inference (Phases 724-740)
*Disaggregated prefill/decode is the future. Separate compute pools for 2-3x efficiency.*

- [ ] Phase 724: Implement disaggregated routing in TentaCLAW — separate request lifecycle into prefill phase and decode phase
- [ ] Phase 725: Configure Dynamo prefill workers — dedicated GPU pool optimized for high-throughput prefill (large batch, compute-bound)
- [ ] Phase 726: Configure Dynamo decode workers — dedicated GPU pool optimized for low-latency decode (small batch, memory-bound)
- [ ] Phase 727: Implement KV cache transfer via NIXL — after prefill completes, transfer KV cache to decode worker with near-zero latency
- [ ] Phase 728: Add NIXL transport selection — auto-detect best transport: NVLink (intra-node), RDMA/InfiniBand (inter-node), TCP (fallback)
- [ ] Phase 729: Implement prefill-decode load balancing — route prefill to least-loaded prefill worker, decode to worker with best cache locality
- [ ] Phase 730: Add disaggregated inference metrics — prefill latency, decode latency, KV transfer latency, cache transfer throughput (GB/s)
- [ ] Phase 731: Implement mixed-mode deployment — some GPUs run combined prefill+decode (for low traffic), split when load increases
- [ ] Phase 732: Add auto-scaling between prefill and decode pools — monitor queue depths, dynamically reassign GPUs between pools
- [ ] Phase 733: Write integration test: disaggregated inference on 8 GPUs (4 prefill + 4 decode), verify end-to-end latency improvement
- [ ] Phase 734: Write integration test: NIXL KV transfer — verify cache data integrity after transfer, measure transfer latency
- [ ] Phase 735: Benchmark disaggregated vs combined mode — same hardware, measure TTFT improvement and throughput improvement
- [ ] Phase 736: Test failover: prefill worker dies, verify fallback to combined mode on remaining workers
- [ ] Phase 737: Test failover: decode worker dies, verify KV cache is reconstructed on replacement worker
- [ ] Phase 738: Implement KV transfer compression — compress KV cache before transfer to reduce bandwidth requirements
- [ ] Phase 739: Document disaggregated inference architecture — when to use it, hardware requirements, configuration guide
- [ ] Phase 740: Commit "feat(backend): Dynamo disaggregated inference — prefill/decode split, NIXL KV transfer, auto-scaling"

---

### Wave 46: KV-Aware Request Router (Phases 741-757)
*Route requests to nodes that already have relevant KV cache. Cache locality = speed.*

- [ ] Phase 741: Design prefix tree (trie) for KV cache tracking — gateway maintains trie of cached prompt prefixes per node/GPU
- [ ] Phase 742: Implement prefix tree data structure — thread-safe, supports insert, lookup, longest-prefix-match, eviction notifications
- [ ] Phase 743: Add cache registration protocol — backends report cached prefixes to gateway after each request, gateway updates trie
- [ ] Phase 744: Implement KV-aware routing algorithm — for each incoming request, find node with longest matching cached prefix, route there
- [ ] Phase 745: Add routing fallback strategy — if no cache match found, route to least-loaded node (default behavior)
- [ ] Phase 746: Implement cache-affinity scoring — score = (prefix_match_length / total_prompt_length) * cache_freshness_weight
- [ ] Phase 747: Add session affinity — requests with same `session_id` route to same node for maximum cache reuse
- [ ] Phase 748: Implement cache eviction notifications — when backend evicts cached prefix, notify gateway to update trie
- [ ] Phase 749: Add router metrics — cache hit rate, prefix match length distribution, routing decisions per second, affinity violations
- [ ] Phase 750: Write integration test: 100 requests with shared system prompt, verify > 80% route to same node (cache hit)
- [ ] Phase 751: Write integration test: multi-turn conversation, verify all turns route to same node, measure TTFT improvement
- [ ] Phase 752: Benchmark KV-aware routing vs round-robin — same workload, measure TTFT improvement (target: 2-5x for repeated prompts)
- [ ] Phase 753: Handle node failure in routing — if preferred node is down, route to next-best match, mark node unavailable
- [ ] Phase 754: Implement cache warming on model load — pre-populate common prefixes (system prompts) on all nodes
- [ ] Phase 755: Add cache statistics endpoint — `GET /v1/cache/stats` returns per-node cache contents, hit rates, memory usage
- [ ] Phase 756: Document KV-aware routing — architecture explanation, configuration, monitoring, tuning for different workloads
- [ ] Phase 757: Commit "feat: KV-aware request router — prefix tree, cache affinity, session routing, 2-5x TTFT improvement"

---

### Wave 47: Multi-Node Tensor Parallelism (Phases 758-773)
*Split large models across nodes. Run 405B parameters on commodity hardware.*

- [ ] Phase 758: Design multi-node tensor parallelism architecture — gateway coordinates model sharding across nodes, NCCL/RCCL for communication
- [ ] Phase 759: Implement model sharding planner — given model size and available GPUs across nodes, compute optimal TP/PP configuration
- [ ] Phase 760: Implement NCCL initialization across nodes — establish all-reduce communication groups, verify bandwidth between nodes
- [ ] Phase 761: Add network bandwidth detection — measure inter-node bandwidth, warn if below minimum for efficient tensor parallelism
- [ ] Phase 762: Implement pipeline parallelism — split model layers across nodes, pipeline micro-batches for throughput
- [ ] Phase 763: Add tensor parallelism + pipeline parallelism hybrid — TP within node (fast NVLink), PP across nodes (slower network)
- [ ] Phase 764: Implement load-model-distributed command — `tentaclaw load-model llama-3.1-405b --tp 8 --pp 2` across 16 GPUs on 4 nodes
- [ ] Phase 765: Add progress reporting for distributed model loading — percentage per node, estimated time, bandwidth usage
- [ ] Phase 766: Implement distributed inference request handling — gateway sends request to primary shard, coordinates across all shards
- [ ] Phase 767: Add distributed streaming — collect streaming tokens from final pipeline stage, forward to client
- [ ] Phase 768: Write integration test: load Llama-3.1-70B with TP=4 across 2 nodes, verify generation correctness
- [ ] Phase 769: Write integration test: load hypothetical 405B model with TP=4 PP=2 across 4 nodes, verify it runs
- [ ] Phase 770: Benchmark multi-node vs single-node — measure throughput penalty from network communication, characterize scaling efficiency
- [ ] Phase 771: Test failure recovery — kill one node during distributed inference, verify graceful error to client
- [ ] Phase 772: Document multi-node TP/PP — hardware requirements, network recommendations, configuration guide, performance expectations
- [ ] Phase 773: Commit "feat: multi-node tensor parallelism — NCCL, pipeline parallelism, 405B model support"

---

### Wave 48: Speculative Decoding (Phases 774-789)
*Use a small draft model to predict tokens, verify with large model. 2-3x faster generation.*

- [ ] Phase 774: Implement speculative decoding framework — draft model generates N candidate tokens, target model verifies in one forward pass
- [ ] Phase 775: Add draft model management — auto-download compatible draft models, verify vocabulary compatibility with target
- [ ] Phase 776: Implement token verification — batch-verify draft tokens against target model logits, accept matching tokens, resample divergent
- [ ] Phase 777: Add speculative decoding configuration — `speculation_depth` (N candidates), `draft_model` name, `acceptance_threshold`
- [ ] Phase 778: Implement EAGLE-3 style speculative decoding — feature-level speculation for higher acceptance rates
- [ ] Phase 779: Add Medusa-style multi-head speculation — multiple draft heads predict different future positions simultaneously
- [ ] Phase 780: Implement adaptive speculation depth — dynamically adjust N based on acceptance rate: increase when high, decrease when low
- [ ] Phase 781: Add draft-target model co-location — schedule draft and target models on same GPU to minimize data transfer
- [ ] Phase 782: Implement speculative decoding metrics — acceptance rate, speedup factor, draft model overhead, tokens verified per step
- [ ] Phase 783: Write integration test: Llama-3.1-70B with 1B draft, verify output matches non-speculative generation exactly
- [ ] Phase 784: Write integration test: speculative decoding with streaming, verify tokens appear at correct intervals
- [ ] Phase 785: Benchmark speculative decoding speedup — measure tok/s improvement for various draft model sizes and speculation depths
- [ ] Phase 786: Test speculative decoding with structured output — verify JSON schema constraints work correctly with speculative tokens
- [ ] Phase 787: Add auto-speculation toggle — enable speculative decoding automatically when idle draft-model GPU capacity exists
- [ ] Phase 788: Document speculative decoding — how it works, compatible model pairs, tuning guide, performance expectations
- [ ] Phase 789: Commit "feat: speculative decoding — EAGLE-3, Medusa, adaptive depth, 2-3x generation speedup"

---

### Wave 49: KV Cache Compression (Phases 790-805)
*Compress KV caches to serve longer contexts and more concurrent requests on same hardware.*

- [ ] Phase 790: Implement KV cache quantization — FP16 → FP8/INT8 KV cache compression, configurable per model
- [ ] Phase 791: Add ChunkKV integration — selective KV cache compression preserving attention-critical tokens
- [ ] Phase 792: Implement token importance scoring — identify which tokens' KV entries are critical for quality, preserve those at full precision
- [ ] Phase 793: Add grouped-query attention (GQA) KV optimization — exploit GQA structure for more efficient KV storage
- [ ] Phase 794: Implement KV cache paging — page-level management like vLLM's PagedAttention, reduce fragmentation
- [ ] Phase 795: Add dynamic KV cache allocation — allocate KV cache pages on demand instead of reserving maximum at model load
- [ ] Phase 796: Implement KV cache offloading — spill inactive KV caches to CPU RAM when GPU memory pressure increases
- [ ] Phase 797: Add KV cache to SSD offloading — for extremely long contexts, tier KV cache: GPU → CPU → SSD
- [ ] Phase 798: Implement async KV prefetch — predict which cached requests will resume, pre-fetch their KV from CPU/SSD to GPU
- [ ] Phase 799: Add KV compression metrics — compression ratio, quality impact (perplexity delta), memory savings, offload rates
- [ ] Phase 800: Write integration test: serve 128K context with KV compression, verify output quality within 1% of uncompressed
- [ ] Phase 801: Write integration test: 64 concurrent requests with KV paging, verify no OOM on GPU with sufficient total memory
- [ ] Phase 802: Benchmark KV compression — measure throughput improvement at various compression levels, quality vs speed tradeoff curve
- [ ] Phase 803: Test KV offloading latency — measure resume-from-offload time, verify it's faster than reprefill
- [ ] Phase 804: Document KV cache management — compression options, offloading tiers, tuning for different workloads
- [ ] Phase 805: Commit "feat: KV cache compression — quantization, ChunkKV, paging, CPU/SSD offloading, async prefetch"

---

### Wave 50: LMCache Integration (Phases 806-822)
*LMCache is the de facto KV cache standard. Multi-tier caching for 15x throughput.*

- [ ] Phase 806: Implement LMCache client library — connect to LMCache service for distributed KV cache storage and retrieval
- [ ] Phase 807: Configure LMCache tiers — GPU L1 cache (fastest), DRAM L2 cache (large), SSD L3 cache (largest), distributed L4 cache (cross-node)
- [ ] Phase 808: Implement LMCache put/get API integration — store KV cache after prefill, retrieve on cache hit for subsequent requests
- [ ] Phase 809: Add LMCache hash-based lookup — content-addressable KV storage, hash prompt prefix to locate cached KV entries
- [ ] Phase 810: Implement LMCache with vLLM backend — configure vLLM to use LMCache for external KV cache management
- [ ] Phase 811: Implement LMCache with SGLang backend — coordinate RadixAttention cache with LMCache distributed cache
- [ ] Phase 812: Add cross-node KV cache sharing — node A's cached KV entries accessible by node B via LMCache distributed tier
- [ ] Phase 813: Implement LMCache eviction policies — LRU, LFU, and cost-based eviction; configurable per tier
- [ ] Phase 814: Add LMCache monitoring — cache size per tier, hit rates per tier, eviction rates, transfer bandwidth
- [ ] Phase 815: Implement cache warming with LMCache — on cluster startup, pre-populate caches with common system prompts
- [ ] Phase 816: Write integration test: request A prefills prompt, request B with same prefix hits LMCache, verify TTFT improvement
- [ ] Phase 817: Write integration test: cross-node cache sharing — prefill on node 1, verify node 2 can retrieve KV and skip prefill
- [ ] Phase 818: Benchmark LMCache impact — measure throughput with and without LMCache at various cache hit rates
- [ ] Phase 819: Test LMCache failover — LMCache service goes down, verify graceful fallback to local-only caching
- [ ] Phase 820: Test LMCache with long contexts — 128K tokens, verify cache store/retrieve works for large KV entries
- [ ] Phase 821: Document LMCache integration — setup guide, tier configuration, monitoring, performance tuning
- [ ] Phase 822: Commit "feat: LMCache integration — multi-tier KV caching, cross-node sharing, 15x throughput potential"

---

### Wave 51: Mooncake Distributed KV Cache (Phases 823-838)
*Mooncake architecture for transfer-engine based KV cache distribution at datacenter scale.*

- [ ] Phase 823: Study Mooncake architecture — understand transfer engine, store engine, disaggregated prefill with distributed KV
- [ ] Phase 824: Implement Mooncake transfer engine client — high-throughput KV cache transfer using RDMA or TCP transport
- [ ] Phase 825: Add Mooncake store engine integration — persistent KV cache storage for frequently accessed prefixes
- [ ] Phase 826: Implement Mooncake-aware scheduling — route requests to maximize local cache hits, minimize cross-node transfers
- [ ] Phase 827: Add Mooncake topology awareness — understand network topology (rack, switch, datacenter), prefer nearby cache nodes
- [ ] Phase 828: Implement Mooncake cache prefetching — predict future requests based on session history, pre-transfer KV caches
- [ ] Phase 829: Add Mooncake metrics — transfer throughput, store utilization, prefetch hit rate, topology-aware routing efficiency
- [ ] Phase 830: Write integration test: Mooncake KV transfer between 2 nodes, verify data integrity and measure latency
- [ ] Phase 831: Write integration test: Mooncake with 100 concurrent sessions, verify cache reuse and throughput improvement
- [ ] Phase 832: Benchmark Mooncake vs local-only caching — measure impact on multi-node cluster throughput
- [ ] Phase 833: Test Mooncake with InfiniBand — verify RDMA transport achieves near-wire-speed KV transfers
- [ ] Phase 834: Test Mooncake failover — store node failure, verify requests continue with degraded but functional caching
- [ ] Phase 835: Implement Mooncake cache garbage collection — clean up stale KV entries, reclaim storage based on TTL and access patterns
- [ ] Phase 836: Add Mooncake to LMCache fallback chain — LMCache for small clusters, Mooncake for large; auto-select based on cluster size
- [ ] Phase 837: Document Mooncake integration — when to use Mooncake vs LMCache, architecture, setup, network requirements
- [ ] Phase 838: Commit "feat: Mooncake distributed KV — transfer engine, store engine, topology-aware routing"

---

### Wave 52: Continuous Batching Optimization (Phases 839-854)
*Continuous batching is the foundation of high throughput. Optimize it across all backends.*

- [ ] Phase 839: Implement gateway-level request queuing — priority queue with configurable priority levels, FIFO within priority
- [ ] Phase 840: Add smart batch formation — group requests by model, context length similarity, and deadline for optimal batching
- [ ] Phase 841: Implement iteration-level scheduling — preempt long-running requests to admit short urgent requests, resume later
- [ ] Phase 842: Add request deadline support — `X-TentaCLAW-Deadline` header, scheduler prioritizes requests near their deadline
- [ ] Phase 843: Implement dynamic batch size adjustment — increase batch size when GPU has spare capacity, decrease under memory pressure
- [ ] Phase 844: Add batch padding optimization — pad sequences to common lengths to reduce memory fragmentation
- [ ] Phase 845: Implement request cancellation — client can cancel in-flight requests, resources freed immediately
- [ ] Phase 846: Add queue depth monitoring — expose queue depth per model, per priority level, alert on queue buildup
- [ ] Phase 847: Implement admission control — reject new requests when queue depth exceeds threshold, return 503 with retry-after header
- [ ] Phase 848: Add request coalescing — identical requests within short window (100ms) share computation, return same result
- [ ] Phase 849: Write integration test: 100 concurrent requests, verify continuous batching achieves > 90% GPU utilization
- [ ] Phase 850: Write integration test: priority scheduling — P0 request leapfrogs P2 requests in queue, verify lower latency
- [ ] Phase 851: Benchmark batching strategies — compare FIFO, priority, deadline-aware on mixed workload
- [ ] Phase 852: Test request cancellation under load — cancel 50% of requests mid-flight, verify no resource leaks
- [ ] Phase 853: Document continuous batching configuration — queue settings, priority levels, deadlines, admission control
- [ ] Phase 854: Commit "feat: continuous batching — priority queuing, deadline scheduling, admission control, request coalescing"

---

### Wave 53: Request Scheduling & Load Balancing (Phases 855-870)
*Intelligent request distribution across heterogeneous GPU fleet.*

- [ ] Phase 855: Implement weighted round-robin — assign weights based on GPU performance (A100 weight 10, RTX 3090 weight 4, etc.)
- [ ] Phase 856: Add least-connections balancing — route to backend with fewest in-flight requests, accounting for request complexity
- [ ] Phase 857: Implement TTFT-optimized routing — route to backend with lowest predicted TTFT based on current queue depth and GPU speed
- [ ] Phase 858: Add throughput-optimized routing — route to backend that will maximize cluster-wide tok/s, not just per-request speed
- [ ] Phase 859: Implement cost-aware routing — when multiple backends can serve a request, route to cheapest (GPU power consumption)
- [ ] Phase 860: Add model-affinity routing — prefer backends that already have the model loaded, avoid unnecessary model swaps
- [ ] Phase 861: Implement geographic routing — for multi-site clusters, route to closest site to minimize network latency
- [ ] Phase 862: Add routing rule engine — configurable rules: "if model == 'llama-3.1-405b' then route to nodes [1,2,3,4]"
- [ ] Phase 863: Implement canary routing — route small percentage of traffic to new backend version for testing
- [ ] Phase 864: Add routing metrics — decisions per algorithm, latency per route, load distribution across backends
- [ ] Phase 865: Write integration test: heterogeneous cluster (A100 + RTX 3090), verify weighted routing distributes proportionally
- [ ] Phase 866: Write integration test: canary routing — 5% to new backend, 95% to old, verify metrics capture both
- [ ] Phase 867: Benchmark routing algorithms — compare latency and throughput of each algorithm under realistic workloads
- [ ] Phase 868: Implement A/B testing framework for routing — run two algorithms simultaneously, compare performance
- [ ] Phase 869: Document routing algorithms — when to use each, configuration examples, monitoring
- [ ] Phase 870: Commit "feat: intelligent load balancing — weighted, TTFT-optimized, cost-aware, geographic, canary routing"

---

### Wave 54: ExLlamaV2 Backend (Phases 871-886)
*ExLlamaV2 is the fastest quantized inference engine. Essential for consumer GPUs.*

- [ ] Phase 871: Implement `ExllamaV2Backend` struct — Python subprocess wrapping ExLlamaV2's inference API
- [ ] Phase 872: Add ExLlamaV2 model loader — support EXL2, GPTQ, and AWQ quantized model formats
- [ ] Phase 873: Implement ExLlamaV2 generation — token-by-token generation with configurable sampling parameters
- [ ] Phase 874: Add ExLlamaV2 streaming — yield tokens as they're generated, translate to TentaCLAW SSE format
- [ ] Phase 875: Implement ExLlamaV2 dynamic batching — batch multiple requests on single GPU, manage shared KV cache
- [ ] Phase 876: Add ExLlamaV2 quantization-on-load — convert FP16 models to EXL2 format on first load, cache quantized version
- [ ] Phase 877: Implement ExLlamaV2 speculative decoding — use ExLlamaV2's native speculative decoding with draft model
- [ ] Phase 878: Add ExLlamaV2 GPU split support — split model across multiple GPUs with custom layer distribution
- [ ] Phase 879: Write integration test: load Llama-3.1-8B EXL2 4-bit, verify quality comparable to FP16 (perplexity within 5%)
- [ ] Phase 880: Write integration test: ExLlamaV2 on RTX 3090 — measure tok/s for 7B/13B/70B models at various quantization levels
- [ ] Phase 881: Benchmark ExLlamaV2 vs llama.cpp vs SGLang — same models, same hardware, compare tok/s and TTFT
- [ ] Phase 882: Test ExLlamaV2 with AMD GPUs — verify ROCm compatibility, benchmark vs NVIDIA performance
- [ ] Phase 883: Add ExLlamaV2 auto-detection — if model is EXL2/GPTQ format, automatically select ExLlamaV2 backend
- [ ] Phase 884: Implement ExLlamaV2 memory estimation — predict VRAM usage before loading, warn if insufficient
- [ ] Phase 885: Document ExLlamaV2 backend — supported formats, quantization guide, performance expectations per GPU tier
- [ ] Phase 886: Commit "feat(backend): ExLlamaV2 — EXL2/GPTQ/AWQ, dynamic batching, speculative decoding, GPU split"

---

### Wave 55: llama.cpp Backend Enhancement (Phases 887-902)
*llama.cpp is the universal backend. Enhance our existing integration with v2 capabilities.*

- [ ] Phase 887: Upgrade llama.cpp backend to use llama-server HTTP API — replace direct library binding with HTTP client for isolation
- [ ] Phase 888: Add llama.cpp GGUF model auto-detection — detect GGUF format, select llama.cpp backend automatically
- [ ] Phase 889: Implement llama.cpp multi-model serving — run multiple llama-server instances, one per model, with port management
- [ ] Phase 890: Add llama.cpp Metal backend support — for Apple Silicon, verify GPU acceleration via Metal, report Metal GPU metrics
- [ ] Phase 891: Implement llama.cpp Vulkan backend — for GPUs without CUDA/ROCm support, enable inference via Vulkan compute
- [ ] Phase 892: Add llama.cpp context window management — dynamic context extension with RoPE scaling, warn on context overflow
- [ ] Phase 893: Implement llama.cpp grammar support — GBNF grammar for structured output, expose via TentaCLAW API
- [ ] Phase 894: Add llama.cpp embedding generation — `/embedding` endpoint support for text embedding models
- [ ] Phase 895: Implement llama.cpp model split across GPUs — `--tensor-split` flag for distributing layers across multiple GPUs
- [ ] Phase 896: Add llama.cpp flash attention toggle — enable when supported (CUDA), disable fallback for compatibility
- [ ] Phase 897: Write integration test: llama.cpp with Metal on Mac M3 — verify GPU acceleration, measure tok/s
- [ ] Phase 898: Write integration test: llama.cpp with Vulkan — verify inference works on Intel GPU or AMD without ROCm
- [ ] Phase 899: Benchmark updated llama.cpp vs previous version — verify performance improvement from latest llama.cpp release
- [ ] Phase 900: Add llama.cpp version management — auto-update llama.cpp binary, verify compatibility before switching
- [ ] Phase 901: Document llama.cpp backend enhancements — Metal, Vulkan, grammar, embedding, multi-model configuration
- [ ] Phase 902: Commit "feat(backend): llama.cpp enhancements — Metal, Vulkan, multi-model, grammar, context management"

---

### Wave 56: TensorRT-LLM Backend (Phases 903-918)
*Maximum NVIDIA performance for production deployments with dedicated NVIDIA hardware.*

- [ ] Phase 903: Implement `TrtllmBackend` struct — gRPC client to Triton Inference Server running TensorRT-LLM engines
- [ ] Phase 904: Write TRT-LLM engine builder — convert HuggingFace models to TRT-LLM format with `trtllm-build`
- [ ] Phase 905: Implement engine caching — cache built engines by model + GPU architecture + quantization, skip rebuild on cache hit
- [ ] Phase 906: Add Triton model repository management — generate `config.pbtxt` for each model, manage model versioning
- [ ] Phase 907: Implement TRT-LLM in-flight batching — configure Triton for continuous batching, set batch and queue parameters
- [ ] Phase 908: Add TRT-LLM FP8 quantization — auto-calibrate FP8 weights for Hopper GPUs, store calibrated engines
- [ ] Phase 909: Implement TRT-LLM multi-GPU — tensor parallelism via MPI, configure GPU-to-layer mapping
- [ ] Phase 910: Add TRT-LLM paged KV cache — configure cache memory fraction, monitor cache utilization
- [ ] Phase 911: Implement TRT-LLM streaming — Triton streaming gRPC, translate partial responses to SSE
- [ ] Phase 912: Write integration test: build TRT-LLM engine for Llama-3.1-8B, load, generate, verify correctness
- [ ] Phase 913: Write integration test: in-flight batching with 64 concurrent requests, verify throughput > 5000 tok/s on A100
- [ ] Phase 914: Benchmark TRT-LLM vs other backends — same model, same NVIDIA hardware, compare throughput and latency
- [ ] Phase 915: Add auto-engine-build on model load — detect NVIDIA GPU, build TRT-LLM engine if not cached, fallback to vLLM while building
- [ ] Phase 916: Implement engine compatibility checking — verify cached engine matches current GPU architecture, rebuild if GPU changed
- [ ] Phase 917: Document TRT-LLM backend — build requirements, supported GPUs, quantization options, performance expectations
- [ ] Phase 918: Commit "feat(backend): TensorRT-LLM — Triton integration, FP8, in-flight batching, auto-engine-build"

---

### Wave 57: AMD ROCm Optimization (Phases 919-934)
*TentaCLAW's AMD GPU support is a differentiator. Optimize for MI300X, MI350, RX 7900.*

- [ ] Phase 919: Audit ROCm support across all backends — verify SGLang, vLLM, llama.cpp, ExLlamaV2 work with ROCm 6.x
- [ ] Phase 920: Implement ROCm-specific GPU detection — use `rocm-smi` for detailed GPU info: memory, temperature, power, utilization, PCIe bandwidth
- [ ] Phase 921: Add AMD MI300X optimization profile — tuned settings for MI300X: memory allocation, batch sizes, HBM3 bandwidth utilization
- [ ] Phase 922: Add AMD MI350 support — test with MI350 hardware (when available), optimize for HBM3E memory subsystem
- [ ] Phase 923: Implement ROCm multi-GPU with RCCL — AMD's equivalent of NCCL for tensor parallelism across AMD GPUs
- [ ] Phase 924: Add AMD Infinity Fabric awareness — detect Infinity Fabric links between GPUs, prefer them for tensor parallel communication
- [ ] Phase 925: Implement ROCm memory management — HIP memory pools, pre-allocation, fragmentation monitoring specific to ROCm
- [ ] Phase 926: Add RX 7900 XTX consumer GPU profile — tuned settings for prosumer AMD GPUs, popular in self-hosted community
- [ ] Phase 927: Benchmark AMD vs NVIDIA — same models, equivalent-tier GPUs (MI300X vs H100, RX 7900 vs RTX 4090), publish results
- [ ] Phase 928: Test AMD GPU passthrough in Proxmox — verify IOMMU groups, vfio-pci, SR-IOV if available
- [ ] Phase 929: Fix AMD-specific issues — collect bug reports from AMD users, fix top 5 issues
- [ ] Phase 930: Add AMD GPU health monitoring — ROCm SMI integration for temperature, power, memory errors, PCIe errors
- [ ] Phase 931: Write AMD-specific tuning guide — ROCm installation, GPU configuration, performance optimization tips
- [ ] Phase 932: Submit bug reports upstream — report any ROCm issues found in vLLM/SGLang/llama.cpp to their repos
- [ ] Phase 933: Create AMD user spotlight — blog post featuring community members running TentaCLAW on AMD hardware
- [ ] Phase 934: Commit "perf: AMD ROCm optimization — MI300X/MI350/RX 7900, RCCL, Infinity Fabric, benchmarks"

---

### Wave 58: Intel GPU Support (Phases 935-950)
*Intel Arc and Gaudi accelerators expand TentaCLAW's hardware reach.*

- [ ] Phase 935: Implement Intel GPU detection — use `xpu-smi` or `intel_gpu_top` for Arc GPUs, verify detection on Arc A770/A750
- [ ] Phase 936: Add Intel oneAPI backend — SYCL-based inference via Intel's extension libraries for llama.cpp
- [ ] Phase 937: Test llama.cpp with Intel SYCL backend — verify inference works on Arc A770, measure tok/s
- [ ] Phase 938: Implement Intel Gaudi (HPU) detection — detect Gaudi 2/3 accelerators via `hl-smi`
- [ ] Phase 939: Add Intel Gaudi backend — integrate with Optimum Habana or vLLM's Gaudi support
- [ ] Phase 940: Test Gaudi inference — load Llama-3.1-8B on Gaudi 2, verify correctness and measure throughput
- [ ] Phase 941: Add Intel GPU metrics collection — utilization, memory, temperature, power for both Arc and Gaudi
- [ ] Phase 942: Implement Intel GPU memory management — track and report VRAM usage, warn on memory pressure
- [ ] Phase 943: Write integration test: full inference pipeline on Intel Arc A770, verify OpenAI API compatibility
- [ ] Phase 944: Write integration test: Gaudi 2 inference with streaming, verify SSE format correct
- [ ] Phase 945: Benchmark Intel Arc vs NVIDIA/AMD — same model, compare tok/s and cost-per-token
- [ ] Phase 946: Benchmark Intel Gaudi 2 vs H100 — datacenter accelerator comparison, throughput and efficiency
- [ ] Phase 947: Add Intel to GPU compatibility matrix on docs — supported models, known limitations, configuration
- [ ] Phase 948: Test heterogeneous cluster — NVIDIA + AMD + Intel GPUs in same cluster, verify routing works
- [ ] Phase 949: Document Intel GPU support — Arc setup, Gaudi setup, known limitations, performance expectations
- [ ] Phase 950: Commit "feat: Intel GPU support — Arc (SYCL), Gaudi (HPU), detection, metrics, heterogeneous clusters"

---

### Wave 59: Comprehensive Benchmark Framework (Phases 951-967)
*Build the definitive benchmarking tool for inference clusters.*

- [ ] Phase 951: Design benchmark framework architecture — pluggable workloads, configurable concurrency, statistical analysis, report generation
- [ ] Phase 952: Implement benchmark runner — `tentaclaw benchmark run` with configurable: model, concurrency, duration, prompt distribution
- [ ] Phase 953: Add TTFT (Time to First Token) measurement — precise timing from request send to first token received, histogram
- [ ] Phase 954: Add ITL (Inter-Token Latency) measurement — time between consecutive tokens in streaming, p50/p95/p99
- [ ] Phase 955: Add throughput measurement — tokens per second (generation), requests per second, prompt tokens processed per second
- [ ] Phase 956: Add latency measurement — end-to-end request latency, p50/p95/p99, breakdown: queue time, prefill, decode, network
- [ ] Phase 957: Implement workload profiles — "chat" (short turns), "coding" (long context), "RAG" (variable context), "batch" (high throughput)
- [ ] Phase 958: Add concurrent user simulation — ramp from 1 to N users, measure saturation point and degradation curve
- [ ] Phase 959: Implement comparison mode — `tentaclaw benchmark compare --baseline v1.0 --candidate v2.0-rc1` with statistical significance
- [ ] Phase 960: Add benchmark report generator — HTML report with charts: latency CDF, throughput over time, GPU utilization, memory usage
- [ ] Phase 961: Implement benchmark sharing — `tentaclaw benchmark share` uploads results to `benchmarks.tentaclaw.io` with shareable URL
- [ ] Phase 962: Add regression detection — compare against baseline, alert if any metric degrades by > 5%
- [ ] Phase 963: Write standard benchmark suite — 10 benchmarks that cover all common inference patterns, run in CI on every PR
- [ ] Phase 964: Run benchmarks on Proxmox reference cluster — publish results for 20 models across all backends
- [ ] Phase 965: Create benchmark comparison page on website — interactive table comparing TentaCLAW vs Ollama vs vLLM vs GPUStack
- [ ] Phase 966: Document benchmark framework — how to run, interpret results, create custom workloads, share results
- [ ] Phase 967: Commit "feat: benchmark framework — TTFT/ITL/throughput, workload profiles, reports, regression detection"

---

### Wave 60: Backend Benchmark Shootout (Phases 968-983)
*Run every backend against every model on real hardware. Publish authoritative results.*

- [ ] Phase 968: Define benchmark matrix — 6 backends x 10 models x 3 concurrency levels x 2 GPU types = 360 benchmark configurations
- [ ] Phase 969: Run Ollama benchmarks — Llama-3.1-8B, 70B; Mistral-7B; Qwen2.5-32B; at 1, 8, 32 concurrency on reference cluster
- [ ] Phase 970: Run vLLM benchmarks — same models, same concurrency levels, same hardware
- [ ] Phase 971: Run SGLang benchmarks — same models, same concurrency levels, same hardware
- [ ] Phase 972: Run llama.cpp benchmarks — same models, same concurrency levels, same hardware
- [ ] Phase 973: Run ExLlamaV2 benchmarks — quantized versions (4-bit, 6-bit), same concurrency levels
- [ ] Phase 974: Run TensorRT-LLM benchmarks — on NVIDIA hardware only, same models and concurrency
- [ ] Phase 975: Compile results into comparison tables — tok/s, TTFT p50/p99, ITL p50/p99, GPU memory usage, CPU usage
- [ ] Phase 976: Analyze results — identify which backend wins for each use case: interactive chat, batch processing, long context, quantized models
- [ ] Phase 977: Create interactive benchmark explorer on website — filter by model, backend, GPU, concurrency; dynamic charts
- [ ] Phase 978: Write blog post: "The Great Inference Benchmark: 6 Backends, 10 Models, Real Hardware"
- [ ] Phase 979: Run benchmarks on AMD GPUs — repeat key benchmarks on ROCm, compare to NVIDIA results
- [ ] Phase 980: Add auto-backend-selection logic — given model + GPU + use case, recommend optimal backend from benchmark data
- [ ] Phase 981: Implement benchmark CI automation — run reduced benchmark suite nightly, alert on regressions
- [ ] Phase 982: Document auto-backend-selection algorithm — how TentaCLAW chooses the best backend for your hardware
- [ ] Phase 983: Commit "benchmark: backend shootout — 360 configurations, comparison tables, auto-backend-selection"

---

### Wave 61: Continuous Benchmarking in CI (Phases 984-999)
*Every PR gets benchmarked. Performance regressions caught before merge.*

- [ ] Phase 984: Set up dedicated benchmark runner — isolated machine or VM with consistent hardware, no other workloads during benchmarks
- [ ] Phase 985: Implement CI benchmark workflow — trigger on PR label `benchmark`, run standard suite, post results as PR comment
- [ ] Phase 986: Add baseline management — store benchmark results per release, compare PRs against the current release baseline
- [ ] Phase 987: Implement performance gate — PR fails if any key metric regresses by > 5% from baseline (configurable threshold)
- [ ] Phase 988: Add benchmark result storage — store results in database, queryable history for trend analysis
- [ ] Phase 989: Create performance trend dashboard — Grafana dashboard showing key metrics over time across releases
- [ ] Phase 990: Implement bisect tool — `tentaclaw benchmark bisect <metric>` finds the commit that caused a regression
- [ ] Phase 991: Add memory benchmark — track peak memory usage per request at various concurrency levels
- [ ] Phase 992: Add startup benchmark — measure time from `tentaclaw start` to first request served, target < 5 seconds
- [ ] Phase 993: Add model load benchmark — time to load model from disk to GPU, by model size and quantization
- [ ] Phase 994: Implement micro-benchmarks — benchmark individual functions: request parsing, routing decision, response serialization
- [ ] Phase 995: Add benchmark to PR template — checkbox "[ ] This PR has been benchmarked" for performance-sensitive changes
- [ ] Phase 996: Write benchmark contribution guide — how to add new benchmarks, best practices for reproducibility
- [ ] Phase 997: Publish weekly benchmark report — automated email/Discord post with performance trends
- [ ] Phase 998: Set up benchmark alerts — Slack/Discord alert when nightly benchmark shows unexpected change
- [ ] Phase 999: Commit "ci: continuous benchmarking — PR gates, trend tracking, bisect tool, nightly reports"

---

### Wave 62: Performance Optimization Sprint (Phases 1000-1015)
*Address every bottleneck found in benchmarking. Make the gateway near-zero overhead.*

- [ ] Phase 1000: Profile gateway request pipeline — flamegraph of hot paths: request parsing, auth, routing, backend communication, response serialization
- [ ] Phase 1001: Optimize request parsing — pre-compile JSON schemas, use SIMD-accelerated JSON parsing (simdjson), cache parsed schemas
- [ ] Phase 1002: Optimize authentication — cache verified tokens in memory with TTL, avoid database lookup on every request
- [ ] Phase 1003: Optimize routing decisions — cache routing table, update asynchronously, avoid lock contention on routing data structures
- [ ] Phase 1004: Optimize SSE streaming — minimize per-chunk overhead, batch small chunks, use write buffering with flush on chunk boundaries
- [ ] Phase 1005: Optimize connection pooling — persistent connections to backends, HTTP/2 multiplexing, connection warmup on backend registration
- [ ] Phase 1006: Reduce memory allocations — pool request/response objects, reuse buffers, zero-copy where possible
- [ ] Phase 1007: Optimize metrics collection — use lock-free counters, batch metric updates, reduce Prometheus scrape overhead
- [ ] Phase 1008: Enable HTTP/2 for all API endpoints — multiplexed streams, header compression, server push for metrics
- [ ] Phase 1009: Implement response caching — cache identical requests (same model, prompt, parameters) with configurable TTL
- [ ] Phase 1010: Profile and optimize dashboard API calls — reduce payload sizes, add pagination, implement GraphQL for flexible queries
- [ ] Phase 1011: Write before/after benchmark comparison — document every optimization with measured impact
- [ ] Phase 1012: Verify gateway overhead < 1ms p99 — total time added by TentaCLAW gateway vs direct backend access
- [ ] Phase 1013: Run full benchmark suite after optimizations — verify improvements, no regressions
- [ ] Phase 1014: Document performance optimization techniques — guide for contributors on maintaining performance
- [ ] Phase 1015: Commit "perf: optimization sprint — parsing, auth, routing, streaming, pooling; gateway overhead < 1ms p99"

---

### Wave 63: Memory Efficiency & Leak Prevention (Phases 1016-1031)
*Long-running servers must not leak memory. Guarantee stability over weeks of uptime.*

- [ ] Phase 1016: Set up memory profiling infrastructure — continuous memory tracking in CI, heap snapshots at 1h, 6h, 24h intervals
- [ ] Phase 1017: Run 24-hour sustained load test — constant 50% utilization, monitor RSS memory growth; target < 1% growth per hour
- [ ] Phase 1018: Run 7-day endurance test — realistic traffic pattern with daily peaks, verify no cumulative memory growth
- [ ] Phase 1019: Identify and fix memory leaks in gateway — leaked request objects, unclosed connections, stale cache entries
- [ ] Phase 1020: Identify and fix memory leaks in agent — GPU memory not freed after model unload, orphaned processes
- [ ] Phase 1021: Implement memory pressure detection — monitor system memory, trigger model unloading when memory exceeds threshold
- [ ] Phase 1022: Add GPU memory leak detection — track VRAM allocation per model, alert if VRAM usage grows unexpectedly
- [ ] Phase 1023: Implement automatic memory recovery — if memory pressure detected, unload least-recently-used model, garbage collect
- [ ] Phase 1024: Add memory usage per-request tracking — log memory delta per request, identify request patterns that cause high memory usage
- [ ] Phase 1025: Implement connection leak prevention — track all open connections, timeout idle connections, alert on connection count growth
- [ ] Phase 1026: Add file descriptor monitoring — track open FDs, warn when approaching system limit, close leaked FDs
- [ ] Phase 1027: Test under memory pressure — artificially limit system memory, verify graceful degradation instead of crash
- [ ] Phase 1028: Test OOM recovery — trigger OOM on a model, verify agent recovers, unloads model, remains healthy
- [ ] Phase 1029: Write memory management best practices guide — for contributors, document patterns that prevent leaks
- [ ] Phase 1030: Add memory usage to benchmark reports — track memory efficiency alongside performance metrics
- [ ] Phase 1031: Commit "reliability: memory efficiency — 7-day endurance test, leak fixes, pressure detection, auto-recovery"

---

### Wave 64: Structured Output Engine (Phases 1032-1047)
*Structured output is table stakes for production AI. Make it first-class across all backends.*

- [ ] Phase 1032: Implement unified structured output API — `response_format` parameter supporting `json_object`, `json_schema`, `regex`, `grammar`
- [ ] Phase 1033: Add JSON schema validation — validate generated output against provided JSON schema, retry on validation failure
- [ ] Phase 1034: Implement grammar-guided generation — BNF/GBNF grammar support routed to backends that support it (SGLang, llama.cpp)
- [ ] Phase 1035: Add regex-constrained generation — route to SGLang for regex-guided decoding, fallback to post-generation validation
- [ ] Phase 1036: Implement gateway-level validation — if backend doesn't support native constrained decoding, validate output and retry (up to 3 times)
- [ ] Phase 1037: Add function calling standardization — unified `tools` interface across OpenAI, Anthropic, and native API formats
- [ ] Phase 1038: Implement tool call routing — detect which models support function calling natively vs need prompt engineering
- [ ] Phase 1039: Add structured output caching — cache validated outputs for identical prompts + schemas, return immediately on cache hit
- [ ] Phase 1040: Implement streaming structured output — validate partial JSON/XML during streaming, detect violations early
- [ ] Phase 1041: Add structured output metrics — validation success rate, retry rate, average retries per request, schema complexity distribution
- [ ] Phase 1042: Write integration test: JSON schema constraint with nested objects, arrays, enums; verify 100% validation pass rate
- [ ] Phase 1043: Write integration test: regex constraint for email, phone number, date formats; verify all outputs match
- [ ] Phase 1044: Benchmark structured output overhead — measure tok/s impact of constrained decoding vs unconstrained
- [ ] Phase 1045: Test structured output with all backends — verify which backends support native constraints, which need gateway validation
- [ ] Phase 1046: Document structured output — supported formats per backend, performance impact, best practices for schema design
- [ ] Phase 1047: Commit "feat: structured output engine — JSON schema, regex, grammar, function calling, validation, caching"

---

### Wave 65: Embedding & Reranking (Phases 1048-1063)
*RAG pipelines need embeddings and reranking. Serve them from the same cluster.*

- [ ] Phase 1048: Add embedding model support — detect embedding models (BGE, E5, Nomic), route to appropriate backend endpoint
- [ ] Phase 1049: Implement `POST /v1/embeddings` — OpenAI-compatible embedding endpoint, batch multiple inputs, return vectors
- [ ] Phase 1050: Add embedding model management — load/unload embedding models independently from generation models
- [ ] Phase 1051: Implement embedding batching — batch multiple embedding requests for throughput, configurable batch size
- [ ] Phase 1052: Add embedding dimensionality reduction — Matryoshka embedding support, return truncated vectors for storage efficiency
- [ ] Phase 1053: Implement reranking endpoint — `POST /v1/rerank` with query and documents, return reranked results with scores
- [ ] Phase 1054: Add reranker model support — BGE-reranker, Cohere-compatible reranker API format
- [ ] Phase 1055: Implement embedding caching — cache embeddings by content hash, return cached results for repeated inputs
- [ ] Phase 1056: Add embedding similarity search — basic vector similarity endpoint for testing, not a full vector database
- [ ] Phase 1057: Write integration test: generate embeddings for 1000 documents, verify dimensions and cosine similarity properties
- [ ] Phase 1058: Write integration test: rerank 100 documents for a query, verify ordering improves retrieval quality
- [ ] Phase 1059: Benchmark embedding throughput — documents per second at various batch sizes and model sizes
- [ ] Phase 1060: Test embedding API with LangChain and LlamaIndex — verify RAG pipeline works end-to-end through TentaCLAW
- [ ] Phase 1061: Add embedding to OpenAI compatibility test suite — verify format matches OpenAI's embedding response schema
- [ ] Phase 1062: Document embedding and reranking — supported models, API reference, integration with RAG frameworks
- [ ] Phase 1063: Commit "feat: embeddings & reranking — OpenAI-compatible, batching, caching, Matryoshka, LangChain/LlamaIndex verified"

---

### Wave 66: v2.0 Performance Validation (Phases 1064-1079)
*Validate all v2.0 performance targets on real hardware before release.*

- [ ] Phase 1064: Define v2.0 performance acceptance criteria — specific targets for tok/s, TTFT, ITL, cache hit rate, gateway overhead
- [ ] Phase 1065: Run full benchmark suite on Proxmox reference cluster — all backends, all models, all concurrency levels
- [ ] Phase 1066: Validate TTFT target — p99 TTFT < 200ms for 8B models, < 500ms for 70B models at 8 concurrent requests
- [ ] Phase 1067: Validate throughput target — > 100 tok/s for 8B models, > 30 tok/s for 70B models per GPU
- [ ] Phase 1068: Validate cache hit rate — > 80% cache hit rate for repeated system prompts with KV-aware routing
- [ ] Phase 1069: Validate gateway overhead — < 1ms p99 added latency from TentaCLAW gateway vs direct backend access
- [ ] Phase 1070: Validate multi-node scaling — near-linear throughput scaling up to 4 nodes for independent requests
- [ ] Phase 1071: Validate speculative decoding — > 1.5x speedup on supported model pairs
- [ ] Phase 1072: Validate structured output — < 10% throughput penalty for JSON schema-constrained generation
- [ ] Phase 1073: Validate memory efficiency — < 5% memory overhead from TentaCLAW management layer on top of backend memory
- [ ] Phase 1074: Create performance report — comprehensive document with all benchmark results, charts, analysis
- [ ] Phase 1075: Compare v2.0 vs v1.0 — side-by-side performance comparison, quantify improvements
- [ ] Phase 1076: Compare v2.0 vs competitors — benchmark against Ollama, GPUStack, standalone vLLM/SGLang
- [ ] Phase 1077: Present results to Champions — get feedback on real-world relevance, identify any missing benchmarks
- [ ] Phase 1078: Fix any targets not met — optimize specific bottlenecks until all performance criteria pass
- [ ] Phase 1079: Commit "validate: v2.0 performance targets — all criteria met, benchmark report published"

---

### Wave 67: v2.0 Stabilization (Phases 1080-1095)
*Feature freeze, bug bash, endurance testing.*

- [ ] Phase 1080: Declare v2.0 feature freeze — cut `release/v2.0` branch, only bug fixes and docs allowed
- [ ] Phase 1081: Run bug bash — entire team and Champions spend 2 days trying to break v2.0, log all issues
- [ ] Phase 1082: Fix all P0 and P1 bugs from bug bash — 48-hour deadline for critical issues
- [ ] Phase 1083: Run 7-day endurance test on reference cluster — continuous mixed workload, monitor for memory leaks, crashes, performance degradation
- [ ] Phase 1084: Run chaos engineering tests — kill backends, disconnect nodes, exhaust GPU memory, corrupt cache; verify recovery
- [ ] Phase 1085: Verify all backends start/stop cleanly — no orphaned processes, no zombie GPUs, no leaked ports
- [ ] Phase 1086: Test upgrade path from v1.0 to v2.0 — `tentaclaw upgrade` preserves config, data, running models, zero downtime
- [ ] Phase 1087: Test v1.0 → v2.0 API compatibility — existing clients using v1.0 API continue working without changes
- [ ] Phase 1088: Run full security test suite — all tests from Wave 5, plus new tests for backend plugin system and multi-node communication
- [ ] Phase 1089: Update all documentation for v2.0 — new backends, new features, new configuration options, new APIs
- [ ] Phase 1090: Update website for v2.0 — new benchmark results, new backend comparison, updated screenshots
- [ ] Phase 1091: Write v2.0 migration guide — breaking changes, new features, configuration migration, backend selection guide
- [ ] Phase 1092: Build v2.0 RC1 — multi-platform binaries, Docker images, packages
- [ ] Phase 1093: Distribute RC1 to Champions — 72-hour testing window
- [ ] Phase 1094: Incorporate Champions feedback — fix remaining issues, build RC2 if needed
- [ ] Phase 1095: Commit "stabilize: v2.0 — bug bash, endurance testing, chaos engineering, documentation update"

---

### Wave 68: v2.0 Release Materials (Phases 1096-1111)
*Prepare all announcement materials for v2.0 launch.*

- [ ] Phase 1096: Write v2.0 changelog — comprehensive list of every change, categorized by type
- [ ] Phase 1097: Write v2.0 release blog post — "TentaCLAW v2.0 'Ink': The Performance Release" — focus on speed gains
- [ ] Phase 1098: Create performance comparison infographic — v1.0 vs v2.0 speed improvements, backend comparison chart
- [ ] Phase 1099: Record v2.0 demo video — showcase new backends, benchmark results, dashboard improvements, 5 minutes
- [ ] Phase 1100: Write Twitter/X announcement thread — 10 tweets covering performance gains, new backends, community growth
- [ ] Phase 1101: Write Reddit announcement posts — r/LocalLLaMA (benchmarks focus), r/selfhosted (new features focus)
- [ ] Phase 1102: Write Hacker News post — "TentaCLAW v2.0: 3x Faster with SGLang, Dynamo, and KV-Aware Routing"
- [ ] Phase 1103: Prepare Discord announcement — detailed changelog, migration notes, benchmark highlights
- [ ] Phase 1104: Write newsletter issue — v2.0 highlights, migration guide link, benchmark explorer link
- [ ] Phase 1105: Create launch day social media graphics — branded cards for Twitter, LinkedIn, Reddit
- [ ] Phase 1106: Write guest blog post pitch — "How We Built a KV-Aware Router for Distributed Inference" for InfoQ/The New Stack
- [ ] Phase 1107: Prepare YouTube creator outreach — updated demo, benchmark results, interview offer
- [ ] Phase 1108: Update Product Hunt page — new screenshots, v2.0 features, updated description
- [ ] Phase 1109: Write press release — AI inference market angle, performance claims with evidence, enterprise relevance
- [ ] Phase 1110: Create benchmark interactive explorer — filter by backend, model, GPU, concurrency; embeddable widget
- [ ] Phase 1111: Commit "docs: v2.0 release materials — blog, video, social, newsletter, benchmark explorer"

---

### Wave 69: v2.0.0 "Ink" Release (Phases 1112-1127)
*Ship v2.0. The performance release.*

- [ ] Phase 1112: Final core team review and sign-off on release branch
- [ ] Phase 1113: Tag `v2.0.0` with annotated release notes
- [ ] Phase 1114: Build final release artifacts — binaries (5 platforms), Docker images (multi-arch), .deb, .rpm, Homebrew, AUR
- [ ] Phase 1115: Sign all artifacts — GPG signatures, cosign container images, verify SBOM
- [ ] Phase 1116: Publish GitHub Release — attach all artifacts, release notes, SBOM
- [ ] Phase 1117: Deploy updated tentaclaw.io — v2.0 download links, benchmark results, documentation
- [ ] Phase 1118: Post Hacker News announcement at 8:00 AM ET
- [ ] Phase 1119: Post Reddit announcements — r/LocalLLaMA, r/selfhosted, r/homelab, r/MachineLearning
- [ ] Phase 1120: Post Twitter/X thread — engage for 6 hours
- [ ] Phase 1121: Post Discord announcement — celebrate with community, @everyone
- [ ] Phase 1122: Send newsletter — v2.0 announcement to all subscribers
- [ ] Phase 1123: Monitor all channels for 48 hours — rapid response to issues, questions, feedback
- [ ] Phase 1124: Release v2.0.1 hot patch if needed — for any critical issues found in first 48 hours
- [ ] Phase 1125: Track v2.0 launch metrics — compare to v1.0 launch: downloads, stars, mentions, community growth
- [ ] Phase 1126: Write v2.0 launch retrospective — internal document: what worked, what to improve for v3.0 launch
- [ ] Phase 1127: Commit "release: v2.0.0 'Ink' — shipped and announced"

---

### Wave 70: v2.0 → v3.0 Bridge — Enterprise Requirements (Phases 1128-1143)
*Gather enterprise requirements. v3.0 is about making money.*

- [ ] Phase 1128: Conduct 10 enterprise discovery calls — schedule 30-minute calls with companies interested in self-hosted AI
- [ ] Phase 1129: Document enterprise requirements — RBAC, SSO, audit logging, compliance, SLA, support expectations
- [ ] Phase 1130: Analyze competitive enterprise offerings — GPUStack Enterprise, Anyscale, Together AI, Fireworks; feature comparison
- [ ] Phase 1131: Identify top 5 enterprise deal-blockers — features required for enterprise POC, ranked by frequency
- [ ] Phase 1132: Design enterprise tier feature set — differentiate Community (free) vs Pro ($29) vs Enterprise ($49)
- [ ] Phase 1133: Research EU AI Act requirements — specific technical requirements for AI system providers and deployers
- [ ] Phase 1134: Map EU AI Act to TentaCLAW features — which requirements TentaCLAW already meets, which need new features
- [ ] Phase 1135: Research SOC 2 Type II requirements — controls framework, evidence collection, audit process timeline
- [ ] Phase 1136: Research HIPAA requirements — for healthcare AI deployments, PHI handling, BAA requirements
- [ ] Phase 1137: Design multi-tenancy architecture — namespace isolation, resource quotas, billing separation, data segregation
- [ ] Phase 1138: Write v3.0 enterprise product spec — detailed feature descriptions, user stories, acceptance criteria
- [ ] Phase 1139: Estimate v3.0 development effort — engineering weeks per feature, critical path, parallelizable work
- [ ] Phase 1140: Create v3.0 project timeline — milestones, dependencies, target release date
- [ ] Phase 1141: Present v3.0 plan to early enterprise prospects — validate priorities, get commitment for pilot programs
- [ ] Phase 1142: Begin seed fundraising preparation — pitch deck, financial model, TAM/SAM/SOM analysis, competitive landscape
- [ ] Phase 1143: Commit "planning: v3.0 enterprise requirements — 10 discovery calls, EU AI Act analysis, SOC 2 research, product spec"

---

# SECTION 3: v3.0 "CHROMATOPHORE" — Enterprise + Compliance (Waves 71-100)

*Adapt to enterprise requirements. First revenue. Compliance as a competitive moat.*

---

### Wave 71: Namespace Isolation Enhancement (Phases 1144-1159)
*True multi-tenancy requires hard boundaries between tenants.*

- [ ] Phase 1144: Audit existing namespace implementation — identify gaps in isolation: shared GPU memory, shared model files, shared API keys
- [ ] Phase 1145: Implement namespace-level network isolation — each namespace gets virtual network, no cross-namespace traffic without explicit policy
- [ ] Phase 1146: Add namespace-level model isolation — models loaded for namespace A are not visible or accessible to namespace B
- [ ] Phase 1147: Implement namespace-level GPU allocation — assign GPUs to namespaces, prevent cross-namespace GPU sharing by default
- [ ] Phase 1148: Add namespace resource quotas — max GPUs, max VRAM, max concurrent requests, max models per namespace
- [ ] Phase 1149: Implement namespace-level metrics isolation — each namespace has its own metrics, no cross-namespace data leakage
- [ ] Phase 1150: Add namespace lifecycle management — create, suspend, resume, delete namespaces; cleanup all resources on delete
- [ ] Phase 1151: Implement namespace hierarchy — organization → team → project namespace hierarchy, inherit permissions from parent
- [ ] Phase 1152: Add namespace billing isolation — track resource usage per namespace, support chargeback to different cost centers
- [ ] Phase 1153: Write integration test: create 3 namespaces, load different models in each, verify complete isolation
- [ ] Phase 1154: Write security test: attempt cross-namespace access via API manipulation, verify 403 on all attempts
- [ ] Phase 1155: Test namespace quotas — exceed GPU quota, verify new model loads are rejected with clear error
- [ ] Phase 1156: Test namespace deletion — delete namespace with running models, verify all resources are cleaned up
- [ ] Phase 1157: Benchmark namespace overhead — measure latency and memory impact of namespace isolation layer
- [ ] Phase 1158: Document multi-tenancy architecture — namespace design, quota configuration, billing integration
- [ ] Phase 1159: Commit "feat: namespace isolation v2 — network, GPU, model, metrics isolation; quotas; hierarchy; billing"

---

### Wave 72: Role-Based Access Control (Phases 1160-1176)
*Enterprise RBAC with fine-grained permissions.*

- [ ] Phase 1160: Design RBAC model — roles, permissions, resources; role hierarchy: super-admin > org-admin > namespace-admin > operator > viewer
- [ ] Phase 1161: Implement permission system — define 40+ granular permissions: models.load, models.unload, nodes.add, nodes.remove, config.edit, etc.
- [ ] Phase 1162: Create default roles — Super Admin (all permissions), Org Admin (manage namespaces/users), Operator (manage models/nodes), Viewer (read-only)
- [ ] Phase 1163: Implement custom role creation — combine granular permissions into custom roles, name them, assign to users
- [ ] Phase 1164: Add role assignment to users — assign one or more roles per namespace, support global roles across all namespaces
- [ ] Phase 1165: Implement permission checking middleware — check permissions on every API request, return 403 with "missing permission: X" on denial
- [ ] Phase 1166: Add API key scoping — API keys can be scoped to specific roles, namespaces, and resources
- [ ] Phase 1167: Implement service accounts — non-human API keys for CI/CD, monitoring, and automation use cases
- [ ] Phase 1168: Add permission inheritance — namespace admin inherits viewer permissions; operator inherits from viewer
- [ ] Phase 1169: Implement conditional permissions — "operator in namespace X" vs "operator in all namespaces"
- [ ] Phase 1170: Add RBAC to dashboard — show/hide UI elements based on user's permissions, prevent unauthorized actions
- [ ] Phase 1171: Add RBAC to CLI — check permissions before executing commands, clear error messages for permission denied
- [ ] Phase 1172: Write integration test: create 5 users with different roles, verify each can only perform allowed actions
- [ ] Phase 1173: Write security test: privilege escalation attempts across all roles, verify no escalation is possible
- [ ] Phase 1174: Test RBAC at scale — 100 users, 20 roles, 10 namespaces; verify permission checking adds < 1ms latency
- [ ] Phase 1175: Document RBAC — role descriptions, permission matrix, custom role examples, API key scoping guide
- [ ] Phase 1176: Commit "feat: RBAC — 5 default roles, 40+ permissions, custom roles, API key scoping, service accounts"

---

### Wave 73: Per-Tenant GPU Quotas (Phases 1177-1192)
*Fair resource sharing in multi-tenant environments.*

- [ ] Phase 1177: Implement GPU quota system — define quota types: gpu_count, vram_bytes, concurrent_requests, tokens_per_minute
- [ ] Phase 1178: Add quota assignment to namespaces — `tentaclaw namespace set-quota <ns> --gpus 4 --vram 48GB --tpm 100000`
- [ ] Phase 1179: Implement quota enforcement on model load — reject model loads that would exceed namespace's GPU/VRAM quota
- [ ] Phase 1180: Implement request-level quota enforcement — throttle requests when namespace exceeds tokens-per-minute limit
- [ ] Phase 1181: Add burst allowance — allow temporary quota exceeding (2x for 60 seconds) before hard throttling
- [ ] Phase 1182: Implement GPU time-sharing — multiple namespaces can share a GPU with guaranteed minimum time slices
- [ ] Phase 1183: Add quota priority levels — when cluster is overcommitted, high-priority namespaces get resources first
- [ ] Phase 1184: Implement fair-share scheduling — when demand exceeds supply, distribute GPUs proportionally to quota allocations
- [ ] Phase 1185: Add quota usage monitoring — real-time quota consumption dashboard, historical usage trends
- [ ] Phase 1186: Implement quota alerts — notify namespace admin at 80% and 95% usage, notify cluster admin at cluster-wide 90%
- [ ] Phase 1187: Add quota reclamation — unused quota from idle namespaces is temporarily available to active namespaces
- [ ] Phase 1188: Write integration test: 3 namespaces with quotas, verify fair distribution under contention
- [ ] Phase 1189: Write test: quota burst — exceed quota temporarily, verify burst allows then hard limit kicks in
- [ ] Phase 1190: Test quota reclamation — idle namespace, verify its quota is available to others, reclaimed when it becomes active
- [ ] Phase 1191: Document GPU quota system — configuration, enforcement behavior, burst policy, monitoring
- [ ] Phase 1192: Commit "feat: GPU quotas — per-namespace limits, burst allowance, time-sharing, fair-share scheduling"

---

### Wave 74: Usage Reporting & Analytics (Phases 1193-1208)
*Enterprise customers need detailed usage reports for cost allocation and planning.*

- [ ] Phase 1193: Implement request logging — store every inference request with timestamp, user, namespace, model, tokens, latency, GPU used
- [ ] Phase 1194: Add request log storage — configurable retention (30/60/90 days), automatic rotation, export to S3/GCS for long-term storage
- [ ] Phase 1195: Implement usage aggregation — hourly, daily, weekly, monthly aggregates per namespace, user, model
- [ ] Phase 1196: Build usage report API — `GET /v1/usage?namespace=X&period=2026-03` returns token counts, request counts, GPU hours
- [ ] Phase 1197: Create usage dashboard — visual reports in web UI: bar charts, line graphs, heatmaps of usage patterns
- [ ] Phase 1198: Add cost attribution — assign dollar cost to each request based on GPU type, duration, and configured rates
- [ ] Phase 1199: Implement chargeback reports — monthly PDF/CSV reports per namespace with total cost, breakdown by model and user
- [ ] Phase 1200: Add usage export — CSV, JSON, Parquet export of raw usage data for external analysis
- [ ] Phase 1201: Implement usage alerts — notify when daily/weekly/monthly usage exceeds configured thresholds
- [ ] Phase 1202: Add usage forecasting — project future usage based on trends, estimate monthly costs for budget planning
- [ ] Phase 1203: Implement real-time usage streaming — WebSocket feed of live usage for external dashboards
- [ ] Phase 1204: Write integration test: generate 1000 requests across 3 namespaces, verify usage reports are accurate
- [ ] Phase 1205: Write test: usage export in CSV/JSON/Parquet, verify data completeness and format correctness
- [ ] Phase 1206: Test usage at scale — 100K requests, verify aggregation performance and storage efficiency
- [ ] Phase 1207: Document usage reporting — API reference, dashboard guide, chargeback setup, export formats
- [ ] Phase 1208: Commit "feat: usage reporting — request logging, cost attribution, chargeback reports, forecasting"

---

### Wave 75: API Key Management (Phases 1209-1224)
*Enterprise-grade API key lifecycle management.*

- [ ] Phase 1209: Implement API key dashboard — list, create, revoke, rotate keys with metadata (name, creator, created_at, last_used, expires)
- [ ] Phase 1210: Add API key creation with scope — specify allowed namespaces, models, operations, rate limits per key
- [ ] Phase 1211: Implement API key expiration — configurable expiry dates, auto-expire, warning emails before expiration
- [ ] Phase 1212: Add API key rotation — generate new key, grace period where both old and new key work, then revoke old
- [ ] Phase 1213: Implement API key prefix — all keys start with `tntcl_` prefix for easy identification in leaked credentials
- [ ] Phase 1214: Add API key usage tracking — per-key request count, last used timestamp, total tokens generated
- [ ] Phase 1215: Implement API key rate limiting — per-key rate limits independent of global rate limits
- [ ] Phase 1216: Add API key IP allowlisting — restrict key usage to specific IP addresses or CIDR ranges
- [ ] Phase 1217: Implement API key audit log — log every key creation, rotation, revocation, and usage anomaly
- [ ] Phase 1218: Add leaked key detection — if TentaCLAW detects a key in a public GitHub repo (via GitHub secret scanning webhook), auto-revoke
- [ ] Phase 1219: Implement bulk key operations — create, revoke, rotate multiple keys at once for large teams
- [ ] Phase 1220: Add API key to CLI — `tentaclaw apikey create --name "CI Bot" --namespace production --expires 90d`
- [ ] Phase 1221: Write integration test: full key lifecycle — create, use, rotate, revoke; verify each stage
- [ ] Phase 1222: Write security test: attempt to use expired/revoked/scope-limited keys, verify correct denial
- [ ] Phase 1223: Document API key management — creation, scoping, rotation best practices, CLI reference
- [ ] Phase 1224: Commit "feat: API key management — scoping, expiration, rotation, IP allowlisting, leaked key detection"

---

### Wave 76: SAML 2.0 Integration (Phases 1225-1240)
*SAML SSO is mandatory for enterprises with existing identity providers.*

- [ ] Phase 1225: Implement SAML 2.0 Service Provider (SP) — metadata endpoint, assertion consumer service, single logout
- [ ] Phase 1226: Add SAML IdP configuration — upload IdP metadata XML or configure manually: entity ID, SSO URL, certificate
- [ ] Phase 1227: Implement SAML authentication flow — SP-initiated SSO, redirect to IdP, receive assertion, create session
- [ ] Phase 1228: Add SAML attribute mapping — map IdP attributes (email, name, groups) to TentaCLAW user properties
- [ ] Phase 1229: Implement SAML group-to-role mapping — IdP group "engineering" → TentaCLAW role "operator" in namespace "production"
- [ ] Phase 1230: Add SAML Just-In-Time (JIT) user provisioning — create TentaCLAW user on first SAML login, assign roles from attributes
- [ ] Phase 1231: Implement SAML Single Logout (SLO) — logout from TentaCLAW triggers IdP logout, and vice versa
- [ ] Phase 1232: Add SAML session management — configurable session duration, idle timeout, absolute timeout
- [ ] Phase 1233: Test with Okta — configure Okta as SAML IdP, verify login flow, attribute mapping, group-to-role mapping
- [ ] Phase 1234: Test with Azure AD — configure Azure AD as SAML IdP, verify complete flow
- [ ] Phase 1235: Test with Google Workspace — configure Google as SAML IdP, verify complete flow
- [ ] Phase 1236: Test SAML edge cases — expired assertions, replayed assertions, invalid signatures, clock skew
- [ ] Phase 1237: Implement SAML debug mode — log full SAML XML for troubleshooting, redact sensitive data in production
- [ ] Phase 1238: Write SAML setup guide — step-by-step for Okta, Azure AD, Google Workspace with screenshots
- [ ] Phase 1239: Add SAML to enterprise tier feature gate — available only in Enterprise plan
- [ ] Phase 1240: Commit "feat: SAML 2.0 SSO — SP implementation, JIT provisioning, group-to-role mapping, Okta/Azure/Google verified"

---

### Wave 77: OIDC Support (Phases 1241-1256)
*OpenID Connect is the modern SSO standard. Support both SAML and OIDC.*

- [ ] Phase 1241: Implement OIDC Relying Party (RP) — authorization code flow with PKCE, token validation, userinfo endpoint
- [ ] Phase 1242: Add OIDC provider configuration — issuer URL, client ID, client secret, scopes, claim mappings
- [ ] Phase 1243: Implement OIDC auto-discovery — fetch `.well-known/openid-configuration` to auto-configure endpoints
- [ ] Phase 1244: Add OIDC claim-to-role mapping — map OIDC claims (groups, roles) to TentaCLAW roles and namespaces
- [ ] Phase 1245: Implement OIDC JIT user provisioning — create user on first login from OIDC claims
- [ ] Phase 1246: Add OIDC refresh token handling — silently refresh access tokens, handle refresh failure with re-authentication
- [ ] Phase 1247: Implement OIDC back-channel logout — receive logout tokens, invalidate sessions immediately
- [ ] Phase 1248: Test with Auth0 — configure Auth0 as OIDC provider, verify complete flow
- [ ] Phase 1249: Test with Keycloak — configure Keycloak, verify including custom claims and group mapping
- [ ] Phase 1250: Test with Dex — lightweight OIDC provider, common in Kubernetes environments
- [ ] Phase 1251: Test with GitHub as OIDC provider — for open-source community SSO, map GitHub orgs/teams to roles
- [ ] Phase 1252: Test with Google OAuth2/OIDC — verify social login flow for simpler deployments
- [ ] Phase 1253: Implement multi-provider support — configure SAML + OIDC simultaneously, login page shows all options
- [ ] Phase 1254: Write OIDC setup guide — step-by-step for Auth0, Keycloak, Dex, GitHub, Google
- [ ] Phase 1255: Add OIDC to enterprise tier feature gate
- [ ] Phase 1256: Commit "feat: OIDC SSO — authorization code + PKCE, claim mapping, Auth0/Keycloak/Dex/GitHub verified"

---

### Wave 78: SCIM 2.0 User Lifecycle (Phases 1257-1272)
*Automated user provisioning and deprovisioning from enterprise identity providers.*

- [ ] Phase 1257: Implement SCIM 2.0 server endpoints — `/scim/v2/Users`, `/scim/v2/Groups`, `/scim/v2/ServiceProviderConfig`
- [ ] Phase 1258: Implement SCIM user creation — IdP pushes new user via SCIM, TentaCLAW creates user with mapped roles
- [ ] Phase 1259: Implement SCIM user update — IdP pushes attribute changes, TentaCLAW updates user properties and role assignments
- [ ] Phase 1260: Implement SCIM user deactivation — IdP deactivates user, TentaCLAW suspends user access immediately, revokes API keys
- [ ] Phase 1261: Implement SCIM user deletion — IdP deletes user, TentaCLAW removes user, preserves audit history
- [ ] Phase 1262: Implement SCIM group management — create/update/delete groups, map to TentaCLAW namespaces and roles
- [ ] Phase 1263: Add SCIM filtering — support filter expressions: `userName eq "jdoe"`, `displayName co "John"`
- [ ] Phase 1264: Implement SCIM pagination — support `startIndex` and `count` for large user directories
- [ ] Phase 1265: Add SCIM authentication — bearer token auth for SCIM endpoint, configurable shared secret
- [ ] Phase 1266: Test with Okta SCIM — configure Okta provisioning, verify user lifecycle: create → update → deactivate → delete
- [ ] Phase 1267: Test with Azure AD SCIM — configure Azure AD provisioning, verify complete lifecycle
- [ ] Phase 1268: Test SCIM conflict resolution — user exists in TentaCLAW before SCIM provisioning, verify merge behavior
- [ ] Phase 1269: Test SCIM at scale — provision 1000 users via SCIM, verify performance and correctness
- [ ] Phase 1270: Add SCIM audit logging — log every provisioning event for compliance
- [ ] Phase 1271: Write SCIM setup guide — configuration for Okta, Azure AD, troubleshooting common issues
- [ ] Phase 1272: Commit "feat: SCIM 2.0 — user/group provisioning, deprovisioning, filtering, Okta/Azure verified"

---

### Wave 79: Active Directory & LDAP (Phases 1273-1288)
*Many enterprises still use AD/LDAP. Support it natively.*

- [ ] Phase 1273: Implement LDAP authentication — bind against LDAP server, verify credentials, retrieve user attributes
- [ ] Phase 1274: Add LDAP configuration — server URL, bind DN, search base, user filter, group filter, attribute mappings
- [ ] Phase 1275: Implement LDAP group-to-role mapping — map AD security groups to TentaCLAW roles
- [ ] Phase 1276: Add LDAP connection pooling — maintain pool of LDAP connections for performance
- [ ] Phase 1277: Implement LDAP user sync — periodic sync of user directory, detect new/modified/deleted users
- [ ] Phase 1278: Add LDAP nested group support — resolve nested AD groups for role mapping
- [ ] Phase 1279: Implement LDAPS (LDAP over TLS) — verify certificate chain, support custom CA certificates
- [ ] Phase 1280: Add LDAP referral following — handle multi-domain AD environments with referrals
- [ ] Phase 1281: Test with Active Directory (Windows Server 2022) — verify authentication, group resolution, nested groups
- [ ] Phase 1282: Test with OpenLDAP — verify compatibility with open-source LDAP implementations
- [ ] Phase 1283: Test with FreeIPA — verify compatibility with Red Hat's identity management system
- [ ] Phase 1284: Test LDAP failover — primary LDAP server down, verify failover to secondary server
- [ ] Phase 1285: Implement LDAP caching — cache successful authentications for 5 minutes to reduce LDAP load
- [ ] Phase 1286: Add LDAP health check — periodic bind to verify LDAP connectivity, alert on failure
- [ ] Phase 1287: Write AD/LDAP setup guide — step-by-step for Active Directory, OpenLDAP, FreeIPA
- [ ] Phase 1288: Commit "feat: LDAP/Active Directory — authentication, group mapping, sync, failover, LDAPS"

---

### Wave 80: Multi-Factor Authentication (Phases 1289-1304)
*MFA is a security baseline for enterprise and increasingly for all users.*

- [ ] Phase 1289: Implement TOTP MFA — Time-based One-Time Password, compatible with Google Authenticator, Authy, 1Password
- [ ] Phase 1290: Add MFA enrollment flow — QR code display, backup codes generation (10 codes), verification step
- [ ] Phase 1291: Implement MFA verification on login — after password auth, prompt for TOTP code before granting session
- [ ] Phase 1292: Add MFA enforcement policy — configurable per organization: optional, required for admins, required for all users
- [ ] Phase 1293: Implement backup codes — 10 single-use codes, regeneratable, stored hashed
- [ ] Phase 1294: Add MFA recovery flow — admin can disable MFA for locked-out users, audit-logged
- [ ] Phase 1295: Implement WebAuthn/FIDO2 support — hardware security keys (YubiKey), passkeys (Apple, Google, Microsoft)
- [ ] Phase 1296: Add MFA for API key creation — require MFA verification before creating or rotating API keys
- [ ] Phase 1297: Implement remember-device — "Trust this device for 30 days" option, reduces MFA prompts
- [ ] Phase 1298: Add MFA to dashboard settings — user can manage their MFA methods, view backup codes, add devices
- [ ] Phase 1299: Write integration test: full MFA enrollment → login → verify flow with TOTP
- [ ] Phase 1300: Write security test: attempt login with expired TOTP, reused code, wrong code; verify all fail
- [ ] Phase 1301: Test WebAuthn with YubiKey — verify registration and authentication flow
- [ ] Phase 1302: Test MFA with SSO — verify MFA works in combination with SAML/OIDC (optional second factor)
- [ ] Phase 1303: Document MFA setup — enrollment guide, recovery procedures, policy configuration
- [ ] Phase 1304: Commit "feat: MFA — TOTP, WebAuthn/FIDO2, backup codes, enforcement policies, device trust"

---

### Wave 81: EU AI Act — Audit Trail (Phases 1305-1320)
*Full audit trail for every inference request. Required for EU AI Act compliance.*

- [ ] Phase 1305: Design audit trail schema — request_id, timestamp, user, model, input_hash, output_hash, tokens, latency, node, GPU
- [ ] Phase 1306: Implement audit event generation — emit audit event for every inference request, including internal metadata
- [ ] Phase 1307: Add audit trail storage — append-only log, tamper-evident (hash chain), configurable retention period
- [ ] Phase 1308: Implement audit trail search — query by user, model, time range, namespace; support complex filters
- [ ] Phase 1309: Add audit trail export — export to CSV, JSON, Parquet, S3, GCS for external audit systems
- [ ] Phase 1310: Implement audit trail integrity verification — verify hash chain, detect any tampering or gaps
- [ ] Phase 1311: Add system-level audit events — node join/leave, model load/unload, config changes, user management
- [ ] Phase 1312: Implement audit event enrichment — add context: model version, quantization, backend used, cache hit/miss
- [ ] Phase 1313: Add audit retention policies — configurable per compliance requirement: 90 days, 1 year, 7 years
- [ ] Phase 1314: Implement audit archival — move old audit events to cold storage (S3 Glacier, Azure Cool Storage)
- [ ] Phase 1315: Add audit dashboard — visual audit trail browser in web UI, filterable, sortable, exportable
- [ ] Phase 1316: Write integration test: generate 1000 requests, verify all have audit entries with correct fields
- [ ] Phase 1317: Write integrity test: attempt to modify audit entry, verify hash chain detects tampering
- [ ] Phase 1318: Test audit at scale — 1M audit entries, verify search performance < 2 seconds for time-range queries
- [ ] Phase 1319: Document audit trail — schema reference, search API, compliance mapping to EU AI Act Article 12
- [ ] Phase 1320: Commit "feat: audit trail — append-only, hash-chained, searchable, exportable, tamper-evident"

---

### Wave 82: EU AI Act — Data Sovereignty (Phases 1321-1336)
*Control where data is processed and stored. Critical for EU AI Act and GDPR.*

- [ ] Phase 1321: Implement node region tagging — label nodes with geographic region: `eu-west`, `us-east`, `ap-southeast`
- [ ] Phase 1322: Add data sovereignty routing rules — configure that certain namespaces must only use nodes in specific regions
- [ ] Phase 1323: Implement sovereignty enforcement — reject request routing to non-compliant regions, return 451 (Unavailable For Legal Reasons)
- [ ] Phase 1324: Add data residency labels for models — track where model weights are stored and which nodes have loaded them
- [ ] Phase 1325: Implement data deletion per region — `tentaclaw sovereignty delete-data --region eu-west` removes all model data from region
- [ ] Phase 1326: Add cross-region transfer controls — block or audit KV cache transfers between regions, configurable policy
- [ ] Phase 1327: Implement data processing agreement (DPA) tracking — record which regions process which namespaces' data
- [ ] Phase 1328: Add sovereignty compliance dashboard — visual map showing data flow between regions, compliance status per namespace
- [ ] Phase 1329: Implement geo-fencing for API access — restrict API access by client IP geolocation if required
- [ ] Phase 1330: Write integration test: configure EU-only namespace, send request, verify it's processed only on EU nodes
- [ ] Phase 1331: Write test: attempt cross-region routing for sovereignty-restricted namespace, verify rejection
- [ ] Phase 1332: Test with multi-region cluster — 2 EU nodes + 2 US nodes, verify complete sovereignty isolation
- [ ] Phase 1333: Map to GDPR Article 44-49 — document how TentaCLAW's data sovereignty features support GDPR transfer requirements
- [ ] Phase 1334: Map to EU AI Act Article 10 — data governance requirements for AI systems
- [ ] Phase 1335: Document data sovereignty — configuration guide, compliance mapping, architecture diagram
- [ ] Phase 1336: Commit "feat: data sovereignty — region tagging, routing rules, cross-region controls, GDPR/EU AI Act mapping"

---

### Wave 83: EU AI Act — Model Provenance (Phases 1337-1352)
*Track the origin, training data, and lineage of every model. Required for high-risk AI systems.*

- [ ] Phase 1337: Design model provenance schema — model_id, source, license, training_data_description, fine_tuning_history, risk_level
- [ ] Phase 1338: Implement model card storage — store model card metadata per model, editable by operators
- [ ] Phase 1339: Add automatic provenance detection — parse HuggingFace model cards, extract license, training data, author information
- [ ] Phase 1340: Implement provenance attestation — model operators sign provenance claims, stored with model metadata
- [ ] Phase 1341: Add model risk classification — categorize models by EU AI Act risk levels: minimal, limited, high, unacceptable
- [ ] Phase 1342: Implement risk-based access controls — high-risk models require additional documentation and approval before deployment
- [ ] Phase 1343: Add model lineage tracking — record fine-tuning chains: base model → fine-tune A → fine-tune B, with metadata at each step
- [ ] Phase 1344: Implement model hash verification — SHA-256 of model files, verify at load time, alert if model has been modified
- [ ] Phase 1345: Add provenance report generation — PDF report per model with all provenance information for regulatory submission
- [ ] Phase 1346: Implement model deprecation tracking — mark models as deprecated, notify users, enforce migration timeline
- [ ] Phase 1347: Write integration test: load model, verify provenance auto-populated from HuggingFace, verify risk classification
- [ ] Phase 1348: Write test: attempt to load model without required provenance for high-risk namespace, verify rejection
- [ ] Phase 1349: Map to EU AI Act Article 11 — technical documentation requirements
- [ ] Phase 1350: Map to EU AI Act Article 53 — transparency obligations for general-purpose AI
- [ ] Phase 1351: Document model provenance — schema reference, auto-detection, risk classification, compliance guide
- [ ] Phase 1352: Commit "feat: model provenance — lineage tracking, risk classification, provenance attestation, EU AI Act Articles 11/53"

---

### Wave 84: EU AI Act — Explainability (Phases 1353-1368)
*Users must understand AI system decisions. Provide explainability tools.*

- [ ] Phase 1353: Implement token-level log probabilities — expose per-token log probs in API response for all generation requests
- [ ] Phase 1354: Add top-K alternative tokens — return K most probable alternative tokens at each position for analysis
- [ ] Phase 1355: Implement attention visualization endpoint — return attention weights for a given prompt, support visualization in dashboard
- [ ] Phase 1356: Add prompt influence scoring — measure which parts of the input prompt most influenced the output
- [ ] Phase 1357: Implement generation explanation endpoint — `POST /v1/explain` returns human-readable explanation of model's reasoning
- [ ] Phase 1358: Add confidence scoring — per-response confidence estimate based on logprob distribution
- [ ] Phase 1359: Implement model behavior documentation — auto-generate documentation of model capabilities, limitations, biases
- [ ] Phase 1360: Add human oversight integration — flag low-confidence outputs for human review, queue in dashboard
- [ ] Phase 1361: Implement explanation caching — cache explanations for repeated prompts, reduce computational overhead
- [ ] Phase 1362: Write integration test: generate with log probs, verify probabilities sum to 1, top alternatives are plausible
- [ ] Phase 1363: Write test: attention visualization, verify heatmap data matches expected patterns for known prompts
- [ ] Phase 1364: Test confidence scoring — verify low-confidence flag triggers for ambiguous prompts
- [ ] Phase 1365: Map to EU AI Act Article 13 — transparency requirements for AI systems
- [ ] Phase 1366: Map to EU AI Act Article 14 — human oversight requirements
- [ ] Phase 1367: Document explainability features — API reference, dashboard visualization guide, compliance mapping
- [ ] Phase 1368: Commit "feat: explainability — log probs, attention visualization, confidence scoring, human oversight, EU AI Act Articles 13/14"

---

### Wave 85: Compliance Reporting Dashboard (Phases 1369-1384)
*One-click compliance reports for EU AI Act, GDPR, SOC 2.*

- [ ] Phase 1369: Design compliance dashboard layout — tabs for EU AI Act, GDPR, SOC 2, each showing compliance status
- [ ] Phase 1370: Implement EU AI Act compliance checklist — auto-check: audit trail ✓, data sovereignty ✓, model provenance ✓, explainability ✓, human oversight ✓
- [ ] Phase 1371: Add GDPR compliance checklist — auto-check: data processing records ✓, deletion capability ✓, transfer controls ✓, consent management ✓
- [ ] Phase 1372: Add SOC 2 compliance checklist — auto-check: access controls ✓, change management ✓, monitoring ✓, incident response ✓
- [ ] Phase 1373: Implement compliance score — percentage score per framework, aggregate across all requirements
- [ ] Phase 1374: Add compliance report generation — PDF report per framework with evidence, screenshots, configuration details
- [ ] Phase 1375: Implement compliance drift detection — alert when configuration changes reduce compliance score
- [ ] Phase 1376: Add compliance recommendations — for each unmet requirement, suggest specific configuration changes
- [ ] Phase 1377: Implement compliance evidence collection — automatically gather logs, configs, screenshots needed for audits
- [ ] Phase 1378: Add scheduled compliance reports — weekly/monthly auto-generated reports emailed to compliance team
- [ ] Phase 1379: Write integration test: configure cluster to be fully compliant, verify 100% compliance score
- [ ] Phase 1380: Write test: change config to violate compliance, verify dashboard shows warning and specific fix
- [ ] Phase 1381: Test report generation — generate reports for all 3 frameworks, verify completeness and accuracy
- [ ] Phase 1382: Map all EU AI Act articles (effective August 2, 2026) — comprehensive mapping to TentaCLAW features
- [ ] Phase 1383: Document compliance dashboard — how to use, report interpretation, evidence collection for auditors
- [ ] Phase 1384: Commit "feat: compliance dashboard — EU AI Act, GDPR, SOC 2 checklists, reports, drift detection"

---

### Wave 86: SOC 2 Type II — Access Controls (Phases 1385-1400)
*SOC 2 Trust Service Criteria: logical and physical access controls.*

- [ ] Phase 1385: Document all access control mechanisms — authentication methods, authorization model, session management
- [ ] Phase 1386: Implement access review capability — list all users, their roles, last login, last activity; flag inactive accounts
- [ ] Phase 1387: Add automatic account lockout — lock account after 5 failed login attempts, unlock after 30 minutes or admin override
- [ ] Phase 1388: Implement password complexity requirements — minimum 12 characters, require uppercase, lowercase, number, special character
- [ ] Phase 1389: Add session management controls — maximum session duration (24h), idle timeout (1h), force logout capability
- [ ] Phase 1390: Implement IP-based access restrictions — allow/deny list per role, geographic restrictions
- [ ] Phase 1391: Add privileged access management — admin actions require re-authentication, logged with enhanced detail
- [ ] Phase 1392: Implement access change notifications — email notification when role changed, API key created, or new device logs in
- [ ] Phase 1393: Add access control evidence generation — auto-generate SOC 2 evidence: user list, role matrix, access reviews, config screenshots
- [ ] Phase 1394: Implement periodic access review workflow — quarterly review: managers confirm team member access is still appropriate
- [ ] Phase 1395: Write integration test: account lockout after failed attempts, verify unlock after timeout
- [ ] Phase 1396: Write test: privileged action re-authentication, verify admin action requires fresh auth
- [ ] Phase 1397: Map to SOC 2 CC6.1-CC6.8 — logical and physical access controls criteria with evidence
- [ ] Phase 1398: Create SOC 2 access control evidence package — ready for auditor review
- [ ] Phase 1399: Document SOC 2 access control implementation — policies, controls, evidence generation
- [ ] Phase 1400: Commit "compliance: SOC 2 access controls — lockout, complexity, session management, evidence generation"

---

### Wave 87: SOC 2 Type II — Change Management (Phases 1401-1416)
*SOC 2 requires documented change management processes.*

- [ ] Phase 1401: Implement configuration version history — every config change stored with diff, author, timestamp, reason
- [ ] Phase 1402: Add configuration approval workflow — changes to production config require approval from designated approver
- [ ] Phase 1403: Implement rollback capability — `tentaclaw config rollback <version>` reverts to previous config, with audit trail
- [ ] Phase 1404: Add model deployment approval — new model deployments require approval workflow before going live
- [ ] Phase 1405: Implement deployment history — full history of model deployments: who, when, what model, which nodes
- [ ] Phase 1406: Add change request tracking — integration with ticketing systems (Jira, Linear) for change documentation
- [ ] Phase 1407: Implement automated change impact analysis — before applying config change, show predicted impact on running workloads
- [ ] Phase 1408: Add change freeze capability — `tentaclaw freeze` prevents all changes during maintenance windows or incidents
- [ ] Phase 1409: Implement change notification system — email/Slack/Discord notification when production changes are applied
- [ ] Phase 1410: Add change management evidence generation — auto-generate SOC 2 evidence: change log, approval records, rollback history
- [ ] Phase 1411: Write integration test: make config change with approval workflow, verify approval required before application
- [ ] Phase 1412: Write test: config rollback, verify previous config restored, audit entry created
- [ ] Phase 1413: Map to SOC 2 CC8.1 — changes to infrastructure and software
- [ ] Phase 1414: Create SOC 2 change management evidence package
- [ ] Phase 1415: Document change management — approval workflows, rollback procedures, freeze mode, integration with ticketing
- [ ] Phase 1416: Commit "compliance: SOC 2 change management — version history, approval workflow, rollback, evidence"

---

### Wave 88: SOC 2 Type II — Monitoring & Incident Response (Phases 1417-1432)
*Continuous monitoring and documented incident response.*

- [ ] Phase 1417: Implement anomaly detection — baseline normal behavior, alert on anomalies: unusual traffic patterns, auth failures, error rates
- [ ] Phase 1418: Add security event correlation — correlate events across gateway, agent, and audit logs to detect attack patterns
- [ ] Phase 1419: Implement automated alerting — configurable alerts for security events, sent to email, Slack, PagerDuty, OpsGenie
- [ ] Phase 1420: Add incident classification system — P0 (critical security breach), P1 (data leak), P2 (service degradation), P3 (minor anomaly)
- [ ] Phase 1421: Implement incident response automation — P0: auto-lock cluster, notify all admins, capture forensic data; P1: alert on-call, capture logs
- [ ] Phase 1422: Add incident timeline reconstruction — given a time range, reconstruct sequence of events from all log sources
- [ ] Phase 1423: Implement post-mortem template — structured template: timeline, root cause, impact, response, prevention, action items
- [ ] Phase 1424: Add monitoring dashboard — real-time security monitoring: failed auth attempts, rate limit hits, anomaly scores, incident count
- [ ] Phase 1425: Implement evidence preservation — during incident, automatically snapshot logs, configs, metrics for forensic analysis
- [ ] Phase 1426: Add regulatory notification workflow — if incident involves personal data, trigger GDPR 72-hour notification countdown
- [ ] Phase 1427: Write integration test: simulate security incident (brute force), verify detection, alert, and response automation
- [ ] Phase 1428: Write test: incident timeline reconstruction, verify complete sequence of events from correlated logs
- [ ] Phase 1429: Map to SOC 2 CC7.1-CC7.5 — system monitoring criteria
- [ ] Phase 1430: Create SOC 2 monitoring evidence package — alert configurations, incident reports, post-mortems
- [ ] Phase 1431: Document incident response — playbook, classification, automation, evidence preservation, regulatory notification
- [ ] Phase 1432: Commit "compliance: SOC 2 monitoring — anomaly detection, incident response, evidence preservation"

---

### Wave 89: SOC 2 Type II — Continuous Compliance (Phases 1433-1448)
*SOC 2 Type II requires continuous evidence over a review period (6-12 months).*

- [ ] Phase 1433: Implement continuous compliance monitoring — automated daily checks of all SOC 2 controls
- [ ] Phase 1434: Add compliance evidence auto-collection — daily snapshots of access lists, config states, incident logs
- [ ] Phase 1435: Implement compliance trend tracking — track compliance score over time, alert on degradation
- [ ] Phase 1436: Add auditor access portal — read-only access for external auditors to view compliance evidence, scoped to their assessment period
- [ ] Phase 1437: Implement vendor management tracking — document all third-party services used, their SOC 2 status, risk assessment
- [ ] Phase 1438: Add risk assessment automation — periodic risk assessment based on system changes, new threats, vulnerability scan results
- [ ] Phase 1439: Implement control testing automation — automated tests that verify each SOC 2 control is functioning correctly
- [ ] Phase 1440: Add policy document management — store security policies, versioned, require annual review and sign-off
- [ ] Phase 1441: Implement employee training tracking — track security awareness training completion, flag overdue training
- [ ] Phase 1442: Add business continuity evidence — document backup procedures, recovery testing results, RTO/RPO measurements
- [ ] Phase 1443: Write integration test: run full SOC 2 compliance check, verify all controls pass
- [ ] Phase 1444: Write test: introduce control failure, verify detection and alerting within 24 hours
- [ ] Phase 1445: Map complete SOC 2 Trust Service Criteria — Security, Availability, Processing Integrity, Confidentiality, Privacy
- [ ] Phase 1446: Create SOC 2 Type II readiness assessment report — gaps, timeline to close, resource requirements
- [ ] Phase 1447: Document continuous compliance — monitoring, evidence collection, auditor access, policy management
- [ ] Phase 1448: Commit "compliance: SOC 2 Type II continuous — auto-evidence, auditor portal, control testing, policy management"

---

### Wave 90: HIPAA Readiness (Phases 1449-1464)
*Healthcare AI deployments require HIPAA compliance for protected health information.*

- [ ] Phase 1449: Audit TentaCLAW for HIPAA technical safeguards — access control, audit controls, integrity controls, transmission security
- [ ] Phase 1450: Implement PHI data handling mode — when enabled, additional protections: encryption at rest, no model caching of PHI prompts
- [ ] Phase 1451: Add BAA (Business Associate Agreement) support — document TentaCLAW's responsibilities as a technology provider
- [ ] Phase 1452: Implement encryption at rest for model data — AES-256 encryption for model weights and cached data
- [ ] Phase 1453: Add encryption at rest for audit logs — encrypt log files, support key rotation
- [ ] Phase 1454: Implement data minimization — configurable prompt/response storage: store nothing, store hashes only, store encrypted
- [ ] Phase 1455: Add PHI detection warnings — optional scan of prompts for potential PHI patterns (SSN, medical record numbers), log warnings
- [ ] Phase 1456: Implement automatic data expiration — PHI-containing data auto-deleted after configurable retention period
- [ ] Phase 1457: Add unique user identification — HIPAA requires unique tracking of all users who access PHI
- [ ] Phase 1458: Implement emergency access procedure — break-glass access for critical situations, heavily audited
- [ ] Phase 1459: Write integration test: enable HIPAA mode, verify encryption at rest, audit logging, access controls all activated
- [ ] Phase 1460: Write test: emergency access, verify break-glass works and is fully audit-logged
- [ ] Phase 1461: Map to HIPAA Security Rule sections — 164.308 (Administrative), 164.310 (Physical), 164.312 (Technical)
- [ ] Phase 1462: Create HIPAA readiness checklist — what TentaCLAW provides vs what the deployer must configure
- [ ] Phase 1463: Document HIPAA deployment guide — configuration, network architecture, backup requirements, BAA template
- [ ] Phase 1464: Commit "compliance: HIPAA readiness — encryption at rest, PHI handling, BAA support, emergency access"

---

### Wave 91: Per-Request Cost Attribution (Phases 1465-1480)
*Know exactly what each request costs. Essential for enterprise chargeback.*

- [ ] Phase 1465: Implement GPU power metering — read GPU power draw via NVML/ROCm-SMI, record per-request energy usage
- [ ] Phase 1466: Calculate per-request GPU cost — (power_draw_watts * duration_seconds * electricity_rate) / 3600 = cost per request
- [ ] Phase 1467: Add GPU depreciation cost — configure hardware cost and expected lifespan, amortize per-request
- [ ] Phase 1468: Implement token-based pricing model — configurable cost per 1K input tokens and per 1K output tokens per model
- [ ] Phase 1469: Add cost header in API responses — `X-TentaCLAW-Cost: $0.00034` included in every response
- [ ] Phase 1470: Implement cost estimation endpoint — `POST /v1/cost/estimate` returns estimated cost before running the request
- [ ] Phase 1471: Add budget alerts — per-namespace budget limit, alert at 80% and 95%, optionally block requests at 100%
- [ ] Phase 1472: Implement cost aggregation — per-user, per-namespace, per-model, per-GPU daily/weekly/monthly cost reports
- [ ] Phase 1473: Add cost comparison with cloud providers — show what this request would cost on OpenAI/Anthropic/Together
- [ ] Phase 1474: Implement savings dashboard — "You've saved $X,XXX by self-hosting with TentaCLAW this month" celebration metric
- [ ] Phase 1475: Write integration test: generate 100 requests, verify cost attribution sums to total GPU cost for the period
- [ ] Phase 1476: Write test: budget limit enforcement, verify requests blocked when budget exhausted
- [ ] Phase 1477: Test cost accuracy — compare calculated cost vs metered GPU energy cost, verify within 10%
- [ ] Phase 1478: Add cost optimization recommendations — "Switch to 4-bit quantization to reduce costs by 60% with < 3% quality loss"
- [ ] Phase 1479: Document cost attribution — configuration, pricing models, budget management, cloud cost comparison
- [ ] Phase 1480: Commit "feat: cost attribution — per-request costing, budgets, savings dashboard, cloud cost comparison"

---

### Wave 92: Team/Project Chargeback Dashboard (Phases 1481-1496)
*Enterprise teams need to allocate AI costs to projects and departments.*

- [ ] Phase 1481: Design chargeback data model — organization → department → team → project hierarchy, cost rolls up
- [ ] Phase 1482: Implement project tagging — `X-TentaCLAW-Project: search-team` header to attribute requests to projects
- [ ] Phase 1483: Add department cost centers — map namespaces to cost centers, auto-attribute all namespace costs
- [ ] Phase 1484: Implement chargeback report generator — monthly PDF/CSV with cost breakdown by department, team, project, model
- [ ] Phase 1485: Build chargeback dashboard — interactive web UI: treemap of costs, drill down from org → department → team → project → model → user
- [ ] Phase 1486: Add cost allocation rules — shared infrastructure costs split proportionally, dedicated GPU costs attributed directly
- [ ] Phase 1487: Implement showback mode — display costs without actual billing, useful for internal awareness before enforcing chargebacks
- [ ] Phase 1488: Add cost forecasting per team — predict next month's costs based on usage trends, alert on expected overages
- [ ] Phase 1489: Implement cost anomaly detection — alert if a team's daily cost deviates significantly from historical pattern
- [ ] Phase 1490: Add custom billing rates per team — different teams may have different negotiated rates or subsidies
- [ ] Phase 1491: Write integration test: 5 teams with different projects, generate requests, verify chargeback report accuracy
- [ ] Phase 1492: Write test: cost allocation rules, verify shared costs distributed proportionally
- [ ] Phase 1493: Test chargeback at scale — 50 teams, 100 projects, 10K requests/day, verify report generation < 30 seconds
- [ ] Phase 1494: Add chargeback integration API — webhook or API for pushing cost data to external billing systems (SAP, NetSuite)
- [ ] Phase 1495: Document chargeback system — setup guide, hierarchy configuration, report customization, external integrations
- [ ] Phase 1496: Commit "feat: chargeback dashboard — team/project cost attribution, reports, forecasting, anomaly detection"

---

### Wave 93: Cloud Cost Comparison Engine (Phases 1497-1512)
*Continuously prove the ROI of self-hosting vs cloud APIs.*

- [ ] Phase 1497: Build cloud pricing database — store current pricing for OpenAI, Anthropic, Google, Together, Fireworks, Groq per model per token
- [ ] Phase 1498: Implement pricing auto-update — scrape or fetch cloud provider pricing pages weekly, alert on changes
- [ ] Phase 1499: Add real-time cost comparison — for each request, calculate "this would cost $X on [provider]" alongside actual TentaCLAW cost
- [ ] Phase 1500: Build comparison dashboard — side-by-side cost visualization: TentaCLAW self-hosted vs top 5 cloud providers
- [ ] Phase 1501: Implement savings calculator — lifetime savings since TentaCLAW deployment, projected annual savings
- [ ] Phase 1502: Add breakeven analysis — given hardware investment, calculate months to breakeven vs cloud API spending
- [ ] Phase 1503: Implement TCO (Total Cost of Ownership) model — include hardware, electricity, networking, maintenance, labor
- [ ] Phase 1504: Add "right-to-use" cost model — for enterprises with existing hardware, calculate marginal cost of AI inference
- [ ] Phase 1505: Build executive summary report — one-page PDF showing ROI, savings, breakeven for C-suite presentation
- [ ] Phase 1506: Add cost comparison to dashboard homepage — prominent "You've saved $X" widget
- [ ] Phase 1507: Write integration test: process 10K requests, compare calculated cloud cost vs actual cloud API pricing
- [ ] Phase 1508: Write test: breakeven analysis, verify calculation matches manual spreadsheet model
- [ ] Phase 1509: Test pricing update mechanism — mock pricing change, verify database updates correctly
- [ ] Phase 1510: Create public cost comparison page on tentaclaw.io — interactive, SEO-optimized, drives organic traffic
- [ ] Phase 1511: Document cost comparison engine — methodology, data sources, TCO model assumptions
- [ ] Phase 1512: Commit "feat: cloud cost comparison — real-time comparison, savings tracker, TCO model, executive reports"

---

### Wave 94: Stripe Billing Integration v2 (Phases 1513-1528)
*Monetize TentaCLAW with usage-based billing via Stripe.*

- [ ] Phase 1513: Implement Stripe Billing integration — create customers, subscriptions, and usage records via Stripe API
- [ ] Phase 1514: Add usage metering — report GPU hours, token counts, and request counts to Stripe Meters
- [ ] Phase 1515: Implement tiered pricing — Community (free), Pro ($29/node/month), Enterprise ($49/node/month)
- [ ] Phase 1516: Add usage-based overages — Pro includes 1M tokens/month, $0.50 per additional 1M tokens
- [ ] Phase 1517: Implement license key generation — on Stripe subscription, generate license key that unlocks Pro/Enterprise features
- [ ] Phase 1518: Add license key validation — gateway checks license key on startup, enables appropriate tier features
- [ ] Phase 1519: Implement Stripe customer portal — self-service billing management: update payment, view invoices, change plan
- [ ] Phase 1520: Add Stripe webhook handling — subscription created, updated, cancelled, payment failed; update license state accordingly
- [ ] Phase 1521: Implement grace period — 7-day grace period on failed payment before downgrading to Community tier
- [ ] Phase 1522: Add annual pricing option — 20% discount for annual commitment ($279/node/year Pro, $469/node/year Enterprise)
- [ ] Phase 1523: Implement volume discounts — 10+ nodes: 10% off, 50+ nodes: 20% off, 100+ nodes: custom pricing
- [ ] Phase 1524: Add billing dashboard — current plan, usage, invoices, payment method, upgrade/downgrade options
- [ ] Phase 1525: Write integration test: create subscription, generate usage, verify Stripe records match TentaCLAW usage
- [ ] Phase 1526: Write test: payment failure → grace period → downgrade flow
- [ ] Phase 1527: Document billing system — pricing tiers, feature comparison, license management, Stripe portal
- [ ] Phase 1528: Commit "feat: Stripe billing v2 — usage metering, tiered pricing, license keys, customer portal"

---

### Wave 95: Spending Limits & Budget Controls (Phases 1529-1544)
*Enterprise customers need hard limits to prevent surprise bills.*

- [ ] Phase 1529: Implement hard spending limits — per-namespace maximum monthly spend, requests rejected after limit hit
- [ ] Phase 1530: Add soft spending limits — warning alerts at configurable thresholds (50%, 75%, 90%, 100%)
- [ ] Phase 1531: Implement budget rollover — unused budget can optionally roll over to next month (configurable)
- [ ] Phase 1532: Add per-user spending limits — individual developers have personal budgets within team budget
- [ ] Phase 1533: Implement spending approval workflow — requests exceeding threshold require manager approval via dashboard/email
- [ ] Phase 1534: Add spending velocity alerts — "spending rate increased 3x in last hour" anomaly detection
- [ ] Phase 1535: Implement cost guardrails — max cost per single request ($X), max tokens per request (prevent accidental 100K token generation)
- [ ] Phase 1536: Add budget calendar — view budget allocation, consumption, and forecast across months
- [ ] Phase 1537: Implement emergency budget override — admin can temporarily increase budget for urgent situations, audit-logged
- [ ] Phase 1538: Add budget API — CRUD operations on budgets, query remaining budget, integrate with external systems
- [ ] Phase 1539: Write integration test: set $100 monthly budget, generate requests until budget hit, verify rejection
- [ ] Phase 1540: Write test: velocity alert, spike usage 5x, verify alert within 5 minutes
- [ ] Phase 1541: Test approval workflow — request over threshold, verify approval email sent, request queued until approved
- [ ] Phase 1542: Add budget reports to compliance dashboard — evidence of cost controls for SOC 2 and internal audit
- [ ] Phase 1543: Document spending controls — budget types, alert configuration, approval workflows, emergency overrides
- [ ] Phase 1544: Commit "feat: spending controls — hard/soft limits, velocity alerts, approval workflow, emergency override"

---

### Wave 96: Enterprise Tier Feature Gate (Phases 1545-1560)
*Control which features are available at each pricing tier.*

- [ ] Phase 1545: Implement feature flag system — each feature has a flag checked at runtime, tied to license tier
- [ ] Phase 1546: Define Community tier features — unlimited nodes, all backends, basic auth, CLI, dashboard, API, community support
- [ ] Phase 1547: Define Pro tier features — everything in Community + priority support, email alerts, usage analytics, advanced routing
- [ ] Phase 1548: Define Enterprise tier features — everything in Pro + SSO (SAML/OIDC), RBAC, SCIM, audit trail, compliance dashboards, SLA
- [ ] Phase 1549: Implement graceful degradation — Enterprise features show "Upgrade to Enterprise" message instead of being hidden
- [ ] Phase 1550: Add tier comparison page in dashboard — side-by-side feature comparison, upgrade button
- [ ] Phase 1551: Implement feature preview mode — Enterprise features available for 14-day free trial, then locked
- [ ] Phase 1552: Add admin override for self-hosted — `TENTACLAW_FEATURES=all` environment variable unlocks everything (honor system)
- [ ] Phase 1553: Implement license validation caching — validate license on startup, cache for 24 hours, allow offline operation
- [ ] Phase 1554: Add license telemetry — report active nodes, tier, features used; respect privacy, opt-out available
- [ ] Phase 1555: Write integration test: Community license, verify Enterprise features show upgrade prompt
- [ ] Phase 1556: Write test: Pro license, verify Pro features work, Enterprise features show upgrade
- [ ] Phase 1557: Test license expiration — expired license, verify graceful downgrade with 7-day warning period
- [ ] Phase 1558: Test offline operation — no internet, verify license cached and features continue working
- [ ] Phase 1559: Document feature tiers — comparison table, upgrade instructions, trial information
- [ ] Phase 1560: Commit "feat: feature gates — tier-based access control, trial mode, graceful degradation"

---

### Wave 97: Enterprise Demo Environment (Phases 1561-1576)
*Prospects need to try before they buy. Provide a hosted demo.*

- [ ] Phase 1561: Deploy demo cluster at `demo.tentaclaw.io` — 4 nodes, 8 GPUs, pre-loaded with popular models
- [ ] Phase 1562: Implement demo isolation — each demo session gets a temporary namespace, auto-deleted after 1 hour
- [ ] Phase 1563: Add demo registration — email capture before granting demo access, rate limit to prevent abuse
- [ ] Phase 1564: Create guided demo flow — step-by-step walkthrough: view cluster, load model, chat, view metrics, check cost comparison
- [ ] Phase 1565: Add demo presets — "Developer Workstation" (3 coding models), "Research Lab" (5 large models), "Production Cluster" (enterprise config)
- [ ] Phase 1566: Implement demo limitations — max 100 requests per session, max 30 min session, no model uploading
- [ ] Phase 1567: Add demo analytics — track which features prospects explore, where they spend time, what they try first
- [ ] Phase 1568: Create demo-to-sales handoff — prominent "Talk to Sales" button, Calendly integration, auto-create lead in CRM
- [ ] Phase 1569: Record demo video walkthrough — 5-minute guided tour with narration, posted on website and sent to demo registrations
- [ ] Phase 1570: Implement demo feedback survey — 5 questions after demo: usefulness, missing features, likelihood to purchase, feedback
- [ ] Phase 1571: Test demo stability — 50 concurrent demo sessions, verify isolation and performance
- [ ] Phase 1572: Test demo cleanup — verify all resources cleaned up after session expires
- [ ] Phase 1573: Test demo on mobile — verify guided flow works on phone/tablet for conference booth demos
- [ ] Phase 1574: Add demo to enterprise sales deck — screenshots, live demo link, prospect testimony
- [ ] Phase 1575: Document demo infrastructure — deployment guide, maintenance procedures, cost analysis
- [ ] Phase 1576: Commit "feat: enterprise demo — hosted environment, guided flow, analytics, sales handoff"

---

### Wave 98: Enterprise Pilot Program (Phases 1577-1592)
*Convert demo interest into paid pilots. First real revenue.*

- [ ] Phase 1577: Design pilot program — 30-day paid pilot ($499), dedicated support, custom configuration, success criteria
- [ ] Phase 1578: Create pilot onboarding checklist — hardware requirements, network config, model selection, success metrics
- [ ] Phase 1579: Build pilot deployment automation — `tentaclaw pilot-setup` script that configures enterprise features for new pilots
- [ ] Phase 1580: Assign dedicated support engineer per pilot — Slack Connect channel, 4-hour response SLA, weekly check-in call
- [ ] Phase 1581: Implement pilot health monitoring — automated checks that pilot cluster is healthy, model performance meets expectations
- [ ] Phase 1582: Add pilot success metrics — track: time-to-first-inference, daily active users, requests/day, cost savings, satisfaction score
- [ ] Phase 1583: Create pilot → production conversion playbook — what needs to change: HA configuration, security hardening, SSO integration
- [ ] Phase 1584: Implement pilot feedback collection — weekly survey: what's working, what's not, feature requests, pain points
- [ ] Phase 1585: Launch first 5 enterprise pilots — outreach to interested companies from demo registrations and enterprise calls
- [ ] Phase 1586: Write pilot case study template — problem, solution, results, testimonial; ready to publish with permission
- [ ] Phase 1587: Conduct weekly pilot review — internal team review of all pilot metrics, identify and resolve issues
- [ ] Phase 1588: Track pilot conversion rate — target 60% conversion from pilot to annual enterprise subscription
- [ ] Phase 1589: Write pilot success stories — 3 case studies from successful pilots, published on website
- [ ] Phase 1590: Calculate pilot LTV — lifetime value of pilot customers, inform pricing and acquisition cost decisions
- [ ] Phase 1591: Refine pilot program based on first 5 experiences — update onboarding, support, success criteria
- [ ] Phase 1592: Commit "enterprise: pilot program — 5 pilots launched, dedicated support, success metrics, case studies"

---

### Wave 99: v3.0 Release Preparation (Phases 1593-1608)
*Stabilize, test, and prepare the enterprise release.*

- [ ] Phase 1593: Declare v3.0 feature freeze — cut `release/v3.0` branch
- [ ] Phase 1594: Run comprehensive enterprise feature test suite — RBAC, SSO, SCIM, audit trail, compliance, billing across all configurations
- [ ] Phase 1595: Run security penetration test on enterprise features — focus on RBAC bypass, SSO vulnerabilities, audit trail tampering
- [ ] Phase 1596: Run 7-day endurance test with enterprise features enabled — verify no memory leaks from audit logging, RBAC checking, etc.
- [ ] Phase 1597: Test upgrade path from v2.0 to v3.0 — database migrations for new tables, config migration, zero downtime
- [ ] Phase 1598: Build v3.0 RC1 — all platforms, distribute to pilots and Champions
- [ ] Phase 1599: Collect pilot and Champion feedback on RC1 — 72-hour testing window
- [ ] Phase 1600: Fix all P0/P1 issues from RC1 testing — build RC2 if significant fixes needed
- [ ] Phase 1601: Write v3.0 changelog and release notes — focus on enterprise features and compliance
- [ ] Phase 1602: Write v3.0 blog post: "TentaCLAW v3.0 'Chromatophore': Enterprise-Ready, EU AI Act Compliant"
- [ ] Phase 1603: Create v3.0 announcement materials — social media, newsletter, press release
- [ ] Phase 1604: Update website with enterprise messaging — testimonials, compliance badges, pricing, demo CTA
- [ ] Phase 1605: Record v3.0 demo video — enterprise features walkthrough: SSO login, RBAC, audit trail, compliance dashboard
- [ ] Phase 1606: Prepare enterprise launch event — webinar or virtual event, pilot customer testimonials, live demo
- [ ] Phase 1607: Final QA pass on all release artifacts — binaries, Docker images, packages, signatures, SBOM
- [ ] Phase 1608: Commit "release-prep: v3.0 — feature freeze, pen test, endurance test, RC testing, announcement materials"

---

### Wave 100: v3.0.0 "Chromatophore" Release + First Revenue (Phases 1609-1625)
*Ship the enterprise release. Announce pricing. Collect first payment.*

- [ ] Phase 1609: Final core team sign-off on release branch — all tests pass, all pilots approve, no P0/P1 open
- [ ] Phase 1610: Tag `v3.0.0` with annotated release notes
- [ ] Phase 1611: Build and sign all release artifacts
- [ ] Phase 1612: Publish GitHub Release with all artifacts and SBOM
- [ ] Phase 1613: Deploy updated tentaclaw.io with enterprise landing page, pricing, and v3.0 documentation
- [ ] Phase 1614: Activate Stripe billing in production — Pro and Enterprise tiers live, payment processing enabled
- [ ] Phase 1615: Post Hacker News: "TentaCLAW v3.0: Enterprise AI Inference with EU AI Act Compliance"
- [ ] Phase 1616: Post Reddit announcements — enterprise angle for r/devops, r/kubernetes; performance angle for r/LocalLLaMA
- [ ] Phase 1617: Post Twitter/X thread — enterprise launch story, compliance features, pilot customer quotes
- [ ] Phase 1618: Send newsletter to subscribers — v3.0 highlights, pricing announcement, free trial link
- [ ] Phase 1619: Host enterprise launch webinar — live demo, pilot customer panel, Q&A, 45 minutes
- [ ] Phase 1620: Convert pilots to paid subscriptions — reach out to all 5 pilots, offer early adopter discount (20% first year)
- [ ] Phase 1621: Process first enterprise payment — celebrate the milestone, record exact date and customer
- [ ] Phase 1622: Track v3.0 launch metrics — enterprise demo requests, trial signups, paid conversions, revenue
- [ ] Phase 1623: Begin seed fundraising outreach — armed with: product, revenue, metrics, community, compliance certifications
- [ ] Phase 1624: Write v3.0 launch retrospective — what worked, revenue milestones, community growth, lessons learned
- [ ] Phase 1625: Commit "release: v3.0.0 'Chromatophore' — enterprise release, first revenue, seed prep initiated"

---

## End of Part 1: Waves 1-100

**Summary:**
- 1,625 phases across 100 waves
- v1.0 "Sucker" (Waves 1-40): Security-first launch, community building, cross-platform installer, API compatibility, MCP/A2A support
- v2.0 "Ink" (Waves 41-70): SGLang, Dynamo, speculative decoding, KV caching, LMCache, comprehensive benchmarking, 6 backends
- v3.0 "Chromatophore" (Waves 71-100): Enterprise RBAC, SSO (SAML/OIDC/LDAP), EU AI Act compliance, SOC 2 readiness, Stripe billing, first revenue

**Part 2 (Waves 101-200) covers:** v4.0 "Mantle" (Kubernetes, K8s operator, DRA, Helm, AWS/GCP/Azure Marketplace) and v5.0 "Beak" (multimodal: vision, audio, video, CLAWHub marketplace)

**Part 3 (Waves 201-300) covers:** v6.0 "Siphon" (1000-node scale, global federation), v7.0 "Hectocotylus" (training, fine-tuning, RLHF, MLOps), and v8.0 "Nautilus" (Daphney integration, $100M ARR, TentaCon, world domination)
