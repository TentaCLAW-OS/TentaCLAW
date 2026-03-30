# TentaCLAW OS — 30-Day Launch Execution Plan

> **Goal:** 1,000 GitHub stars, 500 installs, 50 Discord members in 30 days
> **Start date:** April 1, 2026 (Tuesday — optimal HN/PH day)
> **Repo:** https://github.com/TentaCLAW-OS/TentaCLAW
> **Website:** https://tentaclaw.io
> **Discord:** https://discord.gg/tentaclaw
> **Tagline:** "Turn scattered GPUs into one inference pool"
> **Positioning:** "The open-source HiveOS for AI inference clusters"

---

## How to Use This Document

Every day has a checklist. Do the items in order. Each item has:
- **What** — the specific action
- **When** — exact time (all times Pacific unless noted)
- **Where** — platform or tool
- **Copy** — text ready to paste (in code blocks)
- **Metric** — how to know it worked
- **Contingency** — what to do if it fails

**Daily time commitment:** 4-6 hours on launch day, 1-2 hours on other days.

---

## Pre-Launch Checklist (Day -3 to Day -1)

### Must be TRUE before Day 0. No exceptions.

**Repository (Day -3)**

- [ ] `docker compose up` boots gateway + dashboard with zero errors
- [ ] `curl -fsSL https://tentaclaw.io/install | bash` works on a clean Ubuntu 24.04 VM
- [ ] Dashboard loads at `http://localhost:8080/dashboard` — login screen renders
- [ ] At least one demo path works end-to-end: install -> boot -> GPU detected -> model served
- [ ] CI/CD green badge on GitHub (GitHub Actions workflow passing)
- [ ] All 782 tests pass (`npm test` from root)
- [ ] `README.md` has: header image, badges, install command, screenshots, feature list, comparison table
- [ ] GitHub repo description set to: "Turn scattered GPUs into one AI inference pool. Open-source HiveOS for AI. 6 backends, auto-discovery, zero config."
- [ ] GitHub topics set to: `gpu` `inference` `llm` `cluster` `ai` `self-hosted` `linux` `ollama` `vllm` `machine-learning`
- [ ] GitHub repo has: Website link, Discussions enabled, Issues templates (bug report + feature request)
- [ ] `CONTRIBUTING.md` exists with: setup instructions, PR guidelines, code style
- [ ] `CODE_OF_CONDUCT.md` exists
- [ ] 10+ "good first issue" labels on real issues (not fabricated busywork)
- [ ] GitHub release v0.3.0 tagged with changelog

**Content Assets (Day -2)**

- [ ] **30-second GIF:** Terminal showing `curl install | bash` -> agent starts -> GPU detected -> dashboard shows node. Record with [asciinema](https://asciinema.org/) or screen capture, convert to GIF.
- [ ] **2-minute demo video:** Problem statement (15s) -> install (20s) -> dashboard tour (45s) -> run inference (30s) -> benchmarks (10s). Upload to YouTube as unlisted, set to public on Day 0.
- [ ] **5-minute deep dive video:** Full architecture, all 12 dashboard tabs, CLI demo with sparklines, multi-backend comparison. Upload unlisted.
- [ ] **Dashboard screenshots** (already exist in `assets/screenshots/`): summary, metrics, chat, billing, login
- [ ] **Architecture diagram:** Clean SVG showing Agent -> Gateway -> Dashboard + CLI data flow
- [ ] **Benchmark card:** PNG image showing: 7-node cluster specs, tokens/sec for Llama 3 70B, cost comparison vs OpenAI API
- [ ] **Press kit folder** created at `assets/press/` containing: logo (SVG, PNG), screenshots, one-pager PDF, benchmark card

**Accounts & Platforms (Day -2)**

- [ ] Discord server created with structure below (see Discord Setup section)
- [ ] Product Hunt maker profile active — have been upvoting/commenting for 2+ weeks
- [ ] Twitter/X account `@TentaCLAW_OS` created, bio set, pinned tweet drafted
- [ ] Dev.to account created, profile filled
- [ ] Reddit account has 100+ karma (if not, use personal account)
- [ ] HN account has positive karma and comment history

**Social Proof Seeding (Day -1)**

- [ ] 5-10 friends/colleagues have starred the repo (not on launch day — do it days before so it's not flagged)
- [ ] 3-5 people have joined Discord
- [ ] One blog post drafted: "Why I Built TentaCLAW OS" (publish Day 3)
- [ ] All launch copy (below) reviewed, links tested, typos fixed
- [ ] Calendar cleared for Day 0 — no meetings, no distractions, phone on DND

---

## Discord Server Setup

Create before Day -1. This is the community home.

### Server Name
`TentaCLAW OS — The Tank`

### Server Icon
CLAWtopus logo (octopus)

### Channels

```
WELCOME
  #rules           — Read-only. Code of Conduct + Discord rules.
  #introductions   — "Tell us about your setup: GPUs, nodes, what you run."
  #announcements   — Read-only. Releases, launches, milestones.

SUPPORT
  #getting-started — Forum channel. Install questions, first-run issues.
  #troubleshooting — Forum channel. Bug help, config issues.
  #faq             — Read-only. Common questions pinned.

DEVELOPMENT
  #general         — Main chat.
  #feature-requests — Forum channel.
  #show-your-cluster — Users post screenshots, specs, benchmarks.

COMMUNITY
  #off-topic       — Memes, hardware porn, AI news.
  #contributors    — For people with merged PRs.
```

### Roles
- `@Core Team` — Admins (purple)
- `@Contributor` — Merged a PR (green)
- `@Community` — Default role (blue)
- `@Early Adopter` — Joined before 100 members (gold)

### Welcome Message (set as channel description in #rules)

```
Welcome to The Tank — home of TentaCLAW OS.

TentaCLAW turns scattered GPUs into one self-healing AI inference cluster.
Six backends. Auto-discovery. Zero config. Eight arms. One mind.

Rules:
1. Be helpful. We were all beginners once.
2. No spam or self-promotion (unless it's your TentaCLAW cluster — we WANT to see that).
3. Search before asking — someone probably hit the same issue.
4. File bugs on GitHub, not here. Discord is for discussion.
5. English preferred in public channels.

Get started: https://github.com/TentaCLAW-OS/TentaCLAW
Docs: https://tentaclaw.io/docs
```

---

## Week 1: The Launch Spike (Days 0-6)

### DAY 0 — LAUNCH DAY (Tuesday)

This is the most important day. Clear your entire calendar. You will be online for 14+ hours.

---

**05:30 AM PT — Final checks**

- [ ] `docker compose up` — confirm it works
- [ ] Open dashboard in browser — take fresh screenshot if UI improved
- [ ] Verify all links in README resolve (no 404s)
- [ ] Verify install script URL works: `curl -fsSL https://tentaclaw.io/install | head -5`

**Metric:** All green. If anything is broken, fix it before posting. Do NOT launch with broken links.

**Contingency:** If install script is broken, launch with Docker-only path and fix install script within 24 hours.

---

**06:00 AM PT — YouTube video goes public**

- [ ] Set 2-minute demo video to Public
- [ ] Set 5-minute deep dive to Public
- [ ] Add links to video descriptions:
```
TentaCLAW OS — Turn scattered GPUs into one AI inference pool

Install: curl -fsSL https://tentaclaw.io/install | bash
GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
Discord: https://discord.gg/tentaclaw
Website: https://tentaclaw.io
```

**Metric:** Videos accessible, no processing errors.

---

**07:00 AM PT — Twitter/X launch thread**

Post this thread from `@TentaCLAW_OS` (or personal account if it has more followers):

**Tweet 1 (hook):**
```
I just open-sourced TentaCLAW OS — it turns scattered GPUs into one AI inference pool.

Think HiveOS, but for LLMs instead of mining.

One install. Auto-discovery. Six backends. Zero cloud.

Here's what it does (thread):
```

**Tweet 2 (the problem):**
```
The problem: You have GPUs spread across machines. Maybe a homelab, maybe old mining rigs, maybe office PCs with idle RTX cards.

Running distributed inference means juggling Docker, SSH, configs, and prayers.

TentaCLAW makes those machines into one cluster automatically.
```

**Tweet 3 (the product):**
```
What you get:

- Proxmox-style dashboard (12 tabs, real-time metrics, embedded terminal)
- 111 CLI commands with sparklines and progress bars
- 6 backends: Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2
- OpenAI-compatible API
- MCP server for AI agents

[Attach dashboard screenshot]
```

**Tweet 4 (install):**
```
Get running in 60 seconds:

curl -fsSL https://tentaclaw.io/install | bash

Or with Docker:
git clone https://github.com/TentaCLAW-OS/TentaCLAW && cd TentaCLAW
docker compose up

Dashboard at localhost:8080/dashboard

[Attach 30-second GIF]
```

**Tweet 5 (CTA):**
```
GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
Discord: https://discord.gg/tentaclaw
Website: https://tentaclaw.io

Star if you want to stop paying per-token.
Eight arms. One mind. Zero compromises.

Feedback welcome — what backends or hardware should I prioritize?
```

**Metric:** 50+ likes on Tweet 1 within 4 hours, 10+ retweets on the thread.

**Contingency:** If engagement is low after 2 hours, reply to the thread with a benchmark screenshot or cluster photo. Tag 3-5 relevant accounts (not spam — genuine "thought you'd find this interesting" DMs first).

---

**08:00 AM PT — Hacker News "Show HN" post**

Submit to https://news.ycombinator.com/submit

**Title:**
```
Show HN: TentaCLAW OS – Turn scattered GPUs into one AI inference pool
```

**URL:** `https://github.com/TentaCLAW-OS/TentaCLAW`

**Within 60 seconds of posting, add this comment:**

```
Hey HN — I built TentaCLAW OS because I have a 7-node homelab and was
tired of manually wrangling distributed inference across machines.

It's a self-hosted GPU cluster management platform. Think HiveOS but
for AI inference instead of mining.

What's built:
- Gateway with 150+ API endpoints (782 tests passing)
- Dashboard: Proxmox-style 3-panel React SPA with 12 tabs, real-time
  SSE, resource tree, embedded terminal
- CLI: 111 commands with sparklines, progress bars, ASCII art
- 6 backends: Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2
- Auto-discovery via UDP broadcast (zero config)
- OpenAI-compatible API
- MCP server for AI agents
- One-line install + setup wizard

Tech: TypeScript gateway, React dashboard, Ubuntu 24.04 base for the
OS image, systemd-hardened agent daemon.

What I'm most proud of: `docker compose up` and you have a working
cluster dashboard in under a minute.

Known gaps: AMD GPU support is stubbed (NVIDIA-first for now),
federation between clusters is early, the ISO builder needs more
hardware testing.

Demo: https://tentaclaw.io
GitHub: https://github.com/TentaCLAW-OS/TentaCLAW

Would love feedback on install friction and which backends to
prioritize. If you try it and hit a bug, please open an issue —
I'll fix it same day.
```

**Metric:** 50+ points, front page within 2 hours, 20+ comments.

**Contingency:** If stuck below 10 points after 1 hour, do NOT ask friends to upvote (HN detects this and penalizes). Instead: (a) reply thoughtfully to every single comment to boost engagement, (b) post a follow-up comment with a concrete benchmark result, (c) accept the loss and focus energy on Reddit. You can try HN again in 2 weeks with a different angle.

**CRITICAL: For the next 8 hours, reply to EVERY HN comment within 10 minutes.** Have these responses pre-loaded:

| They say | You reply |
|----------|-----------|
| "Just use K8s" | "K8s is great for general orchestration. TentaCLAW is purpose-built for GPU inference — it auto-detects GPUs by type and VRAM, routes models to appropriate hardware, and needs zero Docker/K8s knowledge. It's closer to HiveOS than K8s." |
| "Why not Docker Swarm?" | "Swarm doesn't understand GPUs natively. TentaCLAW detects GPU model, VRAM capacity, and thermal state, then schedules inference workloads accordingly. It's GPU-aware at every layer." |
| "This is just a wrapper around Ollama" | "Ollama is a great single-node tool — we support it as one of 6 backends. TentaCLAW adds multi-node orchestration, auto-discovery, centralized dashboard, billing, and cluster-wide scheduling. Ollama is the engine; TentaCLAW is the fleet management." |
| "Why TypeScript for a systems tool?" | "The gateway and dashboard are TypeScript. The OS layer, GPU detection, and network scripts are POSIX shell. The agent daemon talks to the gateway via HTTP/SSE. TypeScript lets us ship fast and get community contributions." |
| "No AMD support?" | "NVIDIA-first because that's what I have for testing. AMD detection is stubbed — the architecture supports it, just needs someone with AMD hardware to validate. PRs very welcome." |
| "How does this compare to GPUStack?" | "GPUStack (4.7K stars) is Python-based and focused on single-cluster management. TentaCLAW adds: bootable ISO, auto-discovery, 6 backends vs GPUStack's 2, embedded CLI with 111 commands, federation between clusters, and a full billing system for shared clusters." |
| "Will this scale beyond homelab?" | "The architecture is designed for it — federation, namespace isolation, SSO, and multi-tenant billing are all built. But I'm being honest: it's tested on 7 nodes. If you have a bigger cluster, I'd love to help you test it." |

---

**09:00 AM PT (12:00 PM ET) — Reddit r/LocalLLaMA**

**Title:**
```
I built a self-hosted platform that turns scattered GPUs into one inference pool — open source, 6 backends, Proxmox-style dashboard
```

**Body:**
```
Hey r/LocalLLaMA — I've been building TentaCLAW OS for the past several
months and just open-sourced it.

**The problem:** I have 7 machines in my homelab with GPUs (RTX 4070 Ti
Super + various others). Running distributed inference meant SSH-ing into
each one, manually configuring backends, and hoping nothing crashed
overnight.

**What TentaCLAW does:**
- Install on any machine → it auto-discovers other nodes via UDP broadcast
- Proxmox-style dashboard with 12 tabs (summary, metrics, models, terminal, logs, billing...)
- 6 inference backends: Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2
- 111 CLI commands with sparklines, progress bars, and ASCII art
- OpenAI-compatible API (drop-in replacement for your existing code)
- MCP server so AI agents can use your cluster
- Built-in billing for shared clusters (charge friends/clients per-token or flat rate)

**Install:**
```
curl -fsSL https://tentaclaw.io/install | bash
```

Or Docker:
```
git clone https://github.com/TentaCLAW-OS/TentaCLAW && cd TentaCLAW
docker compose up
```

**Screenshots:** [Link to imgur album or inline Reddit images]

**GitHub:** https://github.com/TentaCLAW-OS/TentaCLAW
**Website:** https://tentaclaw.io
**Discord:** https://discord.gg/tentaclaw

It's MIT licensed. 782 tests passing. Feedback welcome — especially on
what models/hardware combos to test and which backend you'd use first.

What would you run on a 7-node cluster?
```

**Immediately post first comment:**
```
Creator here. Quick backstory: I run a 7-node homelab (5 CPU nodes,
1 GPU node with RTX 4070 Ti Super, 1 inference-only). I was using a
mix of Ollama and vLLM manually and it was painful. HiveOS made GPU
mining dead simple — I wanted the same experience for inference.

Known limitations:
- AMD GPU support is stubbed, not tested (NVIDIA-first)
- The ISO builder is early — Docker/manual install is more reliable
- Federation between separate clusters is alpha
- No Windows agent yet (Linux-only)

What I'm working on next is driven by what you all want. The
feature-request channel on Discord is open.
```

**Metric:** 50+ upvotes, 20+ comments within 6 hours.

**Contingency:** If it gets removed by mods (self-promotion rules), message the mods with: "Hey, I posted about my open-source project. Happy to adjust the post format if it doesn't fit the rules. It's MIT licensed with no paid tier required." Most mods will reinstate genuine open-source posts.

---

**10:00 AM PT (1:00 PM ET) — Reddit r/selfhosted**

**Title:**
```
Open-sourced my GPU cluster manager — self-hosted, no cloud, turns any machine into an inference node
```

**Body:**
```
Hi r/selfhosted — sharing a project I've been working on.

TentaCLAW OS is a self-hosted GPU cluster management platform. It turns
machines with GPUs into nodes in a distributed AI inference cluster.

Why I built it: I'm anti-SaaS. I run a 7-node homelab and didn't want
to pay per-token for inference when I have hardware sitting idle.

Key self-hosted features:
- Runs entirely on your network — zero cloud dependency
- UDP auto-discovery (no manual IP configuration)
- Proxmox-style dashboard (if you love Proxmox, you'll feel at home)
- Built-in billing (run your own inference-as-a-service for your team)
- OpenAI-compatible API (point your apps at your cluster instead of OpenAI)
- Docker Compose for easy deployment

Install: `curl -fsSL https://tentaclaw.io/install | bash`
Docker: `docker compose up`

MIT licensed. 782 tests. TypeScript gateway + React dashboard.

GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
Discord: https://discord.gg/tentaclaw

What other self-hosted AI tools do you run? I want to make sure
TentaCLAW integrates well with the ecosystem.
```

**Metric:** 30+ upvotes, 10+ comments.

**Contingency:** Same as r/LocalLLaMA mod strategy.

---

**12:00 PM PT — Monitoring & Engagement checkpoint**

- [ ] Check all platforms. Reply to every comment you haven't replied to yet.
- [ ] Screenshot current stats (stars, upvotes, comments) for Day 0 retrospective.
- [ ] If HN is on front page: celebrate quietly. Do NOT tweet "We're on the front page of HN!" (HN penalizes this).
- [ ] If HN didn't take off: that's normal. Reddit and Twitter are your backup. Don't dwell.

---

**02:00 PM PT — LinkedIn post**

```
I just open-sourced TentaCLAW OS — a self-hosted GPU cluster management
platform.

The problem: Running distributed AI inference across multiple machines
is painful. Manual SSH, config files, no visibility into what's running where.

The solution: TentaCLAW turns scattered GPUs into one inference pool.
Auto-discovery, Proxmox-style dashboard, 6 backends, OpenAI-compatible API.

Think HiveOS but for AI inference instead of mining.

What I built:
→ 150+ API endpoints, 782 tests
→ Dashboard with 12 tabs, real-time metrics
→ 111 CLI commands
→ 6 backends (Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2)
→ One-line install

MIT licensed. GitHub: https://github.com/TentaCLAW-OS/TentaCLAW

The $117B inference market shouldn't be locked behind per-token APIs.
Your hardware. Your models. Your data.

#opensource #ai #inference #gpu #selfhosted #llm
```

**Metric:** 20+ reactions, 5+ comments. LinkedIn's algo favors posts with early comments — reply to every one.

**Contingency:** LinkedIn is a slow burn. If engagement is low, it's fine. This plants a seed for enterprise leads later.

---

**04:00 PM PT — Dev.to cross-post**

Publish a condensed version of the r/LocalLLaMA post on Dev.to with the title:

```
I Built an Open-Source HiveOS for AI Inference Clusters
```

Add tags: `opensource`, `ai`, `selfhosted`, `typescript`

Include all screenshots and the GIF.

**Metric:** 50+ reactions on Dev.to within 48 hours.

---

**06:00 PM PT — Discord announcement**

Post in `#announcements`:

```
@everyone

TentaCLAW OS is live.

GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
Website: https://tentaclaw.io
HN: [link to your Show HN post]
Reddit: [link to r/LocalLLaMA post]

We launched today. If you're here, you're early. Welcome to The Tank.

Tell us about your setup in #introductions — what GPUs are you running?
What models do you want to serve?

— Alexa
```

---

**09:00 PM PT — Day 0 wrap-up**

- [ ] Reply to any remaining comments across all platforms
- [ ] Record Day 0 metrics in the tracker below
- [ ] Screenshot star history graph
- [ ] Write 3 bullet points on what worked and what didn't (for the retrospective)
- [ ] Go to sleep. Tomorrow is Day 1 and you need to keep responding.

**Day 0 Target Metrics:**

| Metric | Target | Stretch |
|--------|--------|---------|
| GitHub Stars | 100 | 300 |
| HN Points | 50 | 200 |
| r/LocalLLaMA upvotes | 50 | 200 |
| r/selfhosted upvotes | 30 | 100 |
| Twitter impressions | 10K | 50K |
| Discord members | 10 | 30 |
| Docker pulls / installs | 20 | 50 |

---

### DAY 1 (Wednesday)

**Morning routine (8:00 AM PT):**
- [ ] Check all platforms for new comments. Reply to every one.
- [ ] Check GitHub issues — respond to any filed overnight. Fix trivial bugs same-day.
- [ ] Check Discord — welcome new members individually by name.

**09:00 AM PT — Reddit r/homelab**

**Title:**
```
Turned my 7-node homelab into a distributed AI inference cluster — here's the open-source tool I built
```

**Body:**
```
Hey r/homelab — I have a 7-node Proxmox homelab (5 CPU nodes, 1 GPU
node with RTX 4070 Ti Super, 1 inference-only) and I got tired of
manually managing inference workloads across them.

So I built TentaCLAW OS — it's like HiveOS but for AI inference instead
of mining. Install the agent on any machine, it auto-discovers the
cluster via UDP broadcast, and you manage everything from a Proxmox-style
dashboard.

My setup:
- 7 nodes (mix of CPU and GPU)
- Running Llama 3 70B distributed across nodes
- All managed from one dashboard with real-time metrics

[Screenshot of dashboard showing 7-node cluster]

It's MIT licensed and open source: https://github.com/TentaCLAW-OS/TentaCLAW

Install: `curl -fsSL https://tentaclaw.io/install | bash`

What's your homelab running for AI? Would love to see other setups.
```

**Metric:** 50+ upvotes. r/homelab loves hardware setup posts. Include photos of actual hardware if possible.

**02:00 PM PT — GitHub housekeeping**

- [ ] Respond to every open issue (even if just "Thanks for reporting, looking into it")
- [ ] If any bug was reported on HN/Reddit, fix it and push a commit referencing the reporter: "Fix GPU detection on [specific hardware] — reported by @username on HN"
- [ ] Update README if anyone flagged confusion about install steps

**06:00 PM PT — Twitter engagement**

- [ ] Quote-tweet any positive mentions with a thank-you
- [ ] Reply to anyone who tried TentaCLAW and shared results
- [ ] Post a tweet with Day 1 stats (if impressive):

```
Day 1 update on TentaCLAW OS:

⭐ [X] GitHub stars
💬 [X] HN comments
🔧 [X] bugs reported and fixed
🐙 [X] Discord members

Thank you. Seriously. Every star, comment, and bug report matters.

If you haven't tried it: curl -fsSL https://tentaclaw.io/install | bash

What should I build next?
```

---

### DAY 2 (Thursday)

**08:00 AM PT — Comment sweep**
- [ ] Reply to all new comments on HN, Reddit, Twitter, Discord
- [ ] Prioritize fixing any bugs that block the install or first-run experience

**10:00 AM PT — Reddit r/MachineLearning**

Only post here if Day 0 posts got 50+ upvotes (social proof matters for this sub).

**Title:**
```
[P] TentaCLAW OS — open-source distributed GPU inference platform (6 backends, auto-discovery, OpenAI-compatible API)
```

**Body:** Technical focus. Mention architecture (gateway/agent pattern), scheduler design, backend abstraction layer, benchmark numbers. This audience wants depth, not marketing.

**Metric:** 20+ upvotes. This sub is harder to break through — don't be discouraged.

**02:00 PM PT — First blog post published**

Publish "Why I Built TentaCLAW OS" on your blog and Dev.to. Structure:

1. The problem (running inference across scattered hardware is painful)
2. What exists today and why it's not enough (Ollama=single-node, K8s=too complex, HiveOS=mining-only)
3. What I built (with screenshots and architecture diagram)
4. What's next (roadmap driven by community feedback)
5. CTA: Star on GitHub, join Discord

Submit to HN as a regular post (not Show HN — you already used that). Title: "Why I Built an Open-Source HiveOS for AI Inference"

**Metric:** 20+ HN points, 500+ blog views.

---

### DAY 3 (Friday)

**08:00 AM PT — Comment sweep and bug fixes**

**10:00 AM PT — Reddit r/linux**

**Title:**
```
I built a custom Linux distro for managing GPU inference clusters — open source, based on Ubuntu 24.04
```

Focus on the Linux/systems angle: debootstrap build, systemd hardening, GRUB BIOS+UEFI, PXE boot, agent daemon architecture.

**Metric:** 30+ upvotes.

**02:00 PM PT — Release v0.3.1**

Ship a patch release with every bug reported in the first 3 days fixed. Even if the fixes are small, the release signals responsiveness.

```bash
git tag v0.3.1
git push origin v0.3.1
# Create GitHub Release with notes listing every fixed bug and who reported it
```

Post in Discord `#announcements`:
```
v0.3.1 shipped — 3 days after launch, every reported bug is fixed.

Changelog:
- [list fixes, credit reporters by name]

Thank you to everyone who filed issues. Keep them coming.
```

Tweet:
```
v0.3.1 shipped — every bug reported in the first 3 days is fixed.

When you file an issue on TentaCLAW, it gets fixed. That's the deal.

https://github.com/TentaCLAW-OS/TentaCLAW/releases/tag/v0.3.1
```

**Metric:** The release itself is the metric. Shipping fast builds trust.

---

### DAY 4 (Saturday)

**Reduced hours — 1-2 hours total**

- [ ] Morning comment sweep (30 min)
- [ ] Fix any critical bugs
- [ ] Evening comment sweep (30 min)
- [ ] Post in Discord casually — share what you're working on next week

Saturday is when r/homelab and r/selfhosted browsers are most active. If your Day 1 homelab post is still getting engagement, reply to new comments.

---

### DAY 5 (Sunday)

**Reduced hours — 1-2 hours total**

- [ ] Comment sweep
- [ ] Draft Week 2 content: comparison article outline, YouTube outreach emails
- [ ] Write the "Cluster Badge" specification (see Week 2)

**06:00 PM PT — Sunday evening HN window**

If your Show HN didn't hit the front page on Day 0, try a different angle:

**Title:**
```
The inference market is $117B but most open-source tools are single-node only
```

**URL:** Link to your blog post. This is a discussion-style post, not a Show HN. Frame it as commentary on the market gap.

**Metric:** 30+ points. Sunday evening HN has less competition.

---

### DAY 6 (Monday)

**08:00 AM PT — Week 1 retrospective**

- [ ] Record all metrics in the tracker
- [ ] Identify the top 3 pieces of feedback from the community
- [ ] List the top 3 bugs/friction points from install attempts
- [ ] Write a plan for Week 2 based on what you learned

**10:00 AM PT — Reddit r/opensource**

**Title:**
```
Open-sourcing TentaCLAW OS — a GPU inference cluster manager (MIT licensed, 782 tests, community-driven roadmap)
```

Focus on the open-source philosophy: why MIT license, why self-hosted, what the contribution model looks like.

**Metric:** 20+ upvotes.

**02:00 PM PT — GitHub Discussions launch post**

Create a pinned Discussion in the "Announcements" category:

```
Title: Welcome to TentaCLAW OS — Roadmap & How to Get Involved

TentaCLAW OS launched last week. Here's where we are and where we're going.

Current state:
- Gateway: 150+ endpoints, 782 tests
- Dashboard: 12-tab Proxmox-style SPA
- CLI: 111 commands
- Backends: Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2

Community-driven roadmap (vote with thumbs up):
1. [ ] AMD GPU support
2. [ ] Windows agent
3. [ ] Raspberry Pi / ARM support
4. [ ] Web-based terminal improvements
5. [ ] Model marketplace integration
6. [ ] Prometheus/Grafana export
7. [ ] [Your suggestion here]

How to contribute:
- "good first issue" label: https://github.com/TentaCLAW-OS/TentaCLAW/labels/good%20first%20issue
- CONTRIBUTING.md: [link]
- Discord: https://discord.gg/tentaclaw

Thank you to everyone who starred, tried it, filed bugs, and joined the community this week.
```

---

**Week 1 Target Metrics:**

| Metric | Target | Stretch |
|--------|--------|---------|
| GitHub Stars | 250 | 500 |
| Discord Members | 20 | 50 |
| GitHub Issues Filed | 10 | 25 |
| Docker Pulls / Installs | 50 | 150 |
| First External PR | 1 | 3 |
| Newsletter Signups | 50 | 150 |
| Twitter Followers | 100 | 300 |

---

## Week 2: Fix & Seed (Days 7-13)

**Theme:** Fix every friction point from Week 1. Build trust. Seed the ecosystem.

### DAY 7 (Tuesday)

**08:00 AM PT — Friction audit**

Review every install attempt, bug report, and complaint from Week 1. Categorize:

| Issue | Category | Priority | Fix by |
|-------|----------|----------|--------|
| [e.g., "Install script fails on Debian 12"] | Install friction | P0 | Day 8 |
| [e.g., "Dashboard doesn't load on Firefox"] | First-run friction | P0 | Day 8 |
| [e.g., "CLI help text is confusing"] | Polish | P1 | Day 10 |

**Rule:** Every P0 (blocks install or first-run) gets fixed this week. No exceptions.

**10:00 AM PT — "Shareable Artifact" system**

Build the **Cluster Badge Generator** — when someone installs TentaCLAW, they should be able to generate a shareable image showing their cluster specs. This is the "behavioral distribution" primitive from the virality research.

**Concept:**
```
┌──────────────────────────────────────────┐
│  🐙 TentaCLAW Cluster                    │
│                                          │
│  Nodes: 7    GPUs: 4x RTX 4070 Ti       │
│  VRAM: 64 GB    Backends: Ollama, vLLM   │
│  Uptime: 99.2%    Models: 3 active       │
│                                          │
│  tentaclaw.io          #MyTentaCLAWCluster│
└──────────────────────────────────────────┘
```

Add a CLI command: `tentaclaw cluster badge` that generates a PNG.
Add a dashboard button: "Share Your Cluster" that downloads the badge.

**Metric:** Badge generator shipped by Day 10.

**02:00 PM PT — Publish comparison article**

**Title:** "TentaCLAW OS vs GPUStack vs Ollama vs K8s: GPU Inference Platform Comparison (2026)"

**Structure:**

| Feature | TentaCLAW | GPUStack | Ollama | K8s + GPU Operator |
|---------|-----------|----------|--------|--------------------|
| Multi-node | Yes | Yes | No | Yes |
| Auto-discovery | Yes (UDP) | No | No | No |
| Dashboard | Yes (12 tabs) | Basic | No | Grafana (separate) |
| Backends | 6 | 2 | 1 | Any (manual) |
| Install time | 60 seconds | 5 min | 30 sec | 30+ min |
| GPU-aware scheduling | Yes | Yes | N/A | Plugin required |
| Billing built-in | Yes | No | No | No |
| MCP server | Yes | No | No | No |

Publish on blog, Dev.to, and submit to HN.

**Metric:** 1,000+ views, 10+ HN points, shared in 2+ communities.

---

### DAY 8 (Wednesday)

**All day: Fix P0 friction issues from the audit**

Every bug that blocks someone from going install -> working dashboard gets fixed today.

Push fixes as individual commits with clear messages. Tag reporters.

**06:00 PM PT — Tweet the fixes**

```
Shipped 6 fixes today based on community feedback:

- [Fix 1] (reported by @user)
- [Fix 2] (reported by @user)
- [Fix 3] (from Discord)

If you hit an issue with TentaCLAW, file it. We fix same-week.

https://github.com/TentaCLAW-OS/TentaCLAW
```

---

### DAY 9 (Thursday)

**10:00 AM PT — "Good First Issue" sprint**

Create 5 new "good first issue" tickets that are genuinely approachable:

Examples:
- "Add --json flag to `tentaclaw cluster status` command"
- "Add GPU temperature warning threshold to config"
- "Improve error message when gateway is unreachable"
- "Add dark/light theme toggle to dashboard"
- "Add Prometheus metrics export endpoint"

Each issue must have:
- Clear description of what needs to change
- Which file(s) to modify
- Expected input/output
- Labels: `good first issue`, `help wanted`

**Metric:** At least 1 external contributor picks up an issue within 72 hours.

**02:00 PM PT — YouTube creator outreach (Round 1)**

Send personalized DMs/emails to 5 YouTube creators. Template:

```
Subject: Open-source GPU cluster tool — might interest your audience

Hi [Name],

I built TentaCLAW OS, an open-source platform that turns scattered GPUs
into one AI inference cluster. Think HiveOS but for LLMs.

It launched [X] days ago and has [X] GitHub stars and [X] installs.

30-second demo: [GIF link]
2-minute video: [YouTube link]
GitHub: https://github.com/TentaCLAW-OS/TentaCLAW

I think your audience would dig the homelab/self-hosted angle. Happy
to provide a test setup, answer questions, or send hardware.

No pressure — just thought you'd find it interesting.

— Alexa
```

**Target creators (in priority order):**
1. Techno Tim (700K subs, homelab focus — best fit)
2. NetworkChuck (4M subs, networking + AI)
3. Jeff Geerling (1M subs, Linux + cluster builds)
4. Wolfgang's Channel (300K subs, self-hosting)
5. Craft Computing (400K subs, GPU hardware)

**Metric:** 2+ responses within a week. Even "cool project, not right now" is a win — you're on their radar.

---

### DAY 10 (Friday)

**10:00 AM PT — Release v0.4.0**

This release should include:
- All P0 fixes from the friction audit
- Cluster badge generator
- Any quick wins from community feature requests
- Improved error messages and install experience

Create a GitHub Release with detailed changelog.

**Post everywhere:**
- Discord `#announcements`
- Twitter thread showing what changed
- Reddit comment on original posts: "Update: v0.4.0 shipped with [X] community-requested changes"

**Metric:** Release published, 0 critical bugs reported within 24 hours.

---

### DAY 11 (Saturday)

**Reduced hours**

- [ ] Comment sweep
- [ ] Welcome any new Discord members
- [ ] Draft Product Hunt listing assets

---

### DAY 12 (Sunday)

**02:00 PM PT — Product Hunt prep**

Prepare all PH assets:
- [ ] Tagline: "The open-source HiveOS for AI inference clusters"
- [ ] Description (300 chars): "TentaCLAW OS turns scattered GPUs into one self-healing inference cluster. 6 backends (Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2), auto-discovery, Proxmox-style dashboard, 111 CLI commands. MIT licensed."
- [ ] Gallery: 5 images (dashboard summary, metrics, CLI sparklines, architecture diagram, benchmark card)
- [ ] Maker comment drafted
- [ ] Launch scheduled for Tuesday Day 14 at 12:01 AM PT
- [ ] Contact a PH Hunter (reach out to Flo Merian @fmerian on Twitter if not done already)
- [ ] Email your list (if any) with "We're launching on Product Hunt Tuesday — your upvote in the first 4 hours matters most"

---

### DAY 13 (Monday)

**08:00 AM PT — Week 2 retrospective**

- [ ] Record metrics
- [ ] Review: What content performed? What flopped?
- [ ] Count: How many installs via Docker vs curl vs source?
- [ ] Identify top 3 community-requested features for Week 3

**02:00 PM PT — Pre-launch tweet**

```
TentaCLAW OS launches on Product Hunt tomorrow.

Turn scattered GPUs into one inference pool.
Open source. Self-hosted. Six backends. Zero cloud.

We'll be live at 12:01 AM PT: [Product Hunt upcoming page link]

Would mean a lot if you upvoted early.
```

---

**Week 2 Target Metrics:**

| Metric | Target | Stretch |
|--------|--------|---------|
| GitHub Stars (cumulative) | 400 | 700 |
| Discord Members | 30 | 60 |
| External PRs Merged | 2 | 5 |
| Docker Pulls (cumulative) | 100 | 300 |
| Blog Post Views | 2,000 | 5,000 |
| Newsletter Signups | 100 | 300 |

---

## Week 3: Second Wave (Days 14-20)

**Theme:** Product Hunt launch. YouTube coverage. Enterprise angle. Second spike.

### DAY 14 (Tuesday) — PRODUCT HUNT LAUNCH

**12:01 AM PT — Submit to Product Hunt**

- [ ] Submit with all prepared assets
- [ ] Post maker comment immediately:

```
Hey Product Hunt! I'm Alexa, creator of TentaCLAW OS.

I built this because I have a 7-node homelab and was tired of manually
managing distributed inference. Flash a USB, boot any machine, and it
joins your GPU cluster automatically.

The $117B inference market shouldn't require per-token API payments
when you have hardware sitting idle.

What's built:
- 150+ API endpoints, 782 tests
- Proxmox-style dashboard (12 tabs, real-time SSE)
- 111 CLI commands with sparklines
- 6 backends: Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2
- OpenAI-compatible API
- One-line install

MIT licensed. No paid tier required. Your hardware, your models, your data.

I'd love to hear: what would you run on a self-hosted inference cluster?
```

**12:30 AM PT — Twitter announcement**

```
TentaCLAW OS is live on Product Hunt!

Turn scattered GPUs into one AI inference pool.
Open source. MIT licensed. 6 backends. Zero cloud.

Upvote: [Product Hunt link]
GitHub: https://github.com/TentaCLAW-OS/TentaCLAW

Your upvote in the first 4 hours matters most. Thank you.
```

**All day — PH engagement**

- [ ] Respond to every PH comment within 30 minutes
- [ ] Share PH link on LinkedIn, Discord, Reddit (as comments on existing posts, not new posts)
- [ ] Track ranking every 2 hours
- [ ] Push hard at 12:00 PM PT and 5:00 PM PT (engagement dip recovery windows)

**Target:** 100+ upvotes. Top 10 daily. If you hit 200+, you'll likely be Top 5 and get featured in PH newsletter.

**Contingency:** If PH engagement is low, focus energy on: (a) direct outreach to PH community members you've engaged with, (b) posting in relevant PH collections, (c) sharing on LinkedIn where PH upvotes often come from.

---

### DAY 15 (Wednesday)

**10:00 AM PT — Product Hunt retrospective**

- [ ] Record final PH ranking and upvote count
- [ ] Screenshot the PH page for social proof
- [ ] Thank everyone who upvoted (Twitter post)

**02:00 PM PT — Enterprise-angle blog post**

**Title:** "Run Your Own AI Infrastructure: The Business Case for Self-Hosted Inference"

Focus: Cost comparison between OpenAI API ($15/M input tokens for GPT-4) vs self-hosted cluster ($X/month hardware amortization). Include a calculator or table. This targets CTOs and engineering managers.

Publish on blog, Dev.to, LinkedIn article.

**Metric:** 500+ LinkedIn views, 2+ inbound inquiries about enterprise use.

---

### DAY 16 (Thursday)

**10:00 AM PT — Second Reddit wave**

Return to r/LocalLLaMA with an update post (don't spam — only if you have genuinely new content):

**Title:**
```
2-week update on TentaCLAW OS: [X] stars, [X] installs, new cluster badge generator, and everything we fixed
```

Share: metrics, top community requests, what you shipped, what's next. This is the "trust baseline" cadence from the virality research.

**02:00 PM PT — YouTube outreach Round 2**

Follow up with creators who didn't respond. DM new creators:
- DB Tech (100K subs, self-hosting)
- Lawrence Systems (300K subs, networking/servers)
- Raid Owl (200K subs, Proxmox/homelab)
- Hardware Haven (150K subs, server builds)

Include your PH results as social proof.

---

### DAY 17 (Friday)

**10:00 AM PT — Release v0.5.0**

This release should include the top 3 community-requested features. Name them in the changelog with credit.

**02:00 PM PT — "Cost Calculator" tool**

Build and publish an interactive cost comparison tool on tentaclaw.io/calculator:

```
Your Setup:
- GPUs: [dropdown] × [quantity]
- Monthly inference tokens: [input]
- Current provider: [OpenAI / Anthropic / Together / etc.]

Your Savings with TentaCLAW:
- Current cost: $X,XXX/month
- Self-hosted cost: $XXX/month (hardware amortized over 3 years)
- Annual savings: $XX,XXX
- ROI: X months to break even
```

This is extremely shareable and drives organic traffic via SEO ("AI inference cost calculator").

**Metric:** Calculator live on website. 100+ uses in first week.

---

### DAY 18-19 (Saturday-Sunday)

**Reduced hours**

- [ ] Comment sweeps
- [ ] Discord engagement
- [ ] Draft Week 4 content
- [ ] Record a casual "Week 3 update" video (selfie-style, 2-3 minutes, share on Twitter)

---

### DAY 20 (Monday)

**08:00 AM PT — Week 3 retrospective**

- [ ] Record all metrics
- [ ] Identify: Are installs growing week-over-week? Where do users drop off?
- [ ] Review: Which platforms drive the most stars? Double down there.

**02:00 PM PT — GitHub Sponsors setup**

- [ ] Enable GitHub Sponsors on the repo
- [ ] Create tiers: $5 (name in README), $25 (logo + Discord role), $100 (logo on website + priority support), $500 (dedicated support channel)
- [ ] Tweet about it: "If TentaCLAW saves you API costs, consider sponsoring development."

---

**Week 3 Target Metrics:**

| Metric | Target | Stretch |
|--------|--------|---------|
| GitHub Stars (cumulative) | 650 | 900 |
| Discord Members | 40 | 75 |
| Product Hunt Upvotes | 100 | 250 |
| External PRs Merged (cumulative) | 5 | 10 |
| Docker Pulls (cumulative) | 200 | 500 |
| YouTube Creator Responses | 2 | 4 |
| Newsletter Signups (cumulative) | 150 | 400 |

---

## Week 4: Compound (Days 21-30)

**Theme:** Community contest. Contributor incentives. Compounding growth. Hit 1,000 stars.

### DAY 21 (Tuesday)

**10:00 AM PT — Launch "Show Your Cluster" contest**

**Announcement (Discord, Twitter, Reddit, GitHub Discussions):**

```
CONTEST: Show Your TentaCLAW Cluster

Share a screenshot or photo of your TentaCLAW cluster setup.

How to enter:
1. Install TentaCLAW OS on 2+ machines
2. Run `tentaclaw cluster badge` to generate your cluster card
3. Post it on Twitter with #MyTentaCLAWCluster and tag @TentaCLAW_OS
   OR post in #show-your-cluster on Discord

Prizes:
- Best Cluster (most nodes): TentaCLAW t-shirt + featured on website
- Most Creative Setup: CLAWtopus sticker pack + featured on README
- Best Benchmarks: TentaCLAW hoodie + co-authored blog post

Deadline: [Day 30]
Winners announced: [Day 30]

Every valid entry gets the "Early Adopter" Discord role.
```

**Metric:** 10+ entries by Day 30. Every entry is user-generated content that markets TentaCLAW.

---

### DAY 22 (Wednesday)

**10:00 AM PT — Contributor recognition**

- [ ] Add a "Contributors" section to README with avatars (use `all-contributors` bot or manual)
- [ ] Send personalized thank-you DMs to every person who merged a PR
- [ ] Tweet spotlighting a contributor: "Shoutout to @user who added [feature]. This is what open source is about."

**02:00 PM PT — SEO blog post**

**Title:** "How to Build a Home AI Inference Cluster for Under $2,000"

This is a long-tail SEO play. Structure as a step-by-step tutorial:
1. Hardware shopping list (used workstations, GPUs)
2. Network setup
3. Install TentaCLAW OS
4. Configure backends
5. Run first model
6. Benchmark results

Target keyword: "home AI inference cluster" — low competition, high intent.

**Metric:** 1,000+ organic views within 30 days via search.

---

### DAY 23 (Thursday)

**10:00 AM PT — MCP integration push**

MCP (Model Context Protocol) has 97M monthly SDK downloads. Lean into this.

**Post on Twitter:**
```
TentaCLAW OS ships with a built-in MCP server.

Your AI agents can:
- Discover available models across your cluster
- Route inference to the best available GPU
- Monitor cluster health and performance
- Deploy new models

No API keys. No rate limits. Your cluster, your agents.

MCP config for Claude Desktop / Cursor:
{
  "mcpServers": {
    "tentaclaw": {
      "command": "tentaclaw",
      "args": ["mcp", "serve"]
    }
  }
}
```

**Post on r/ClaudeAI and r/cursor:**

```
PSA: You can connect Claude Desktop / Cursor to your own GPU cluster via MCP

TentaCLAW OS has a built-in MCP server. Add it to your Claude Desktop config and your AI assistant can run inference on your local hardware instead of using cloud APIs.

[Instructions + config snippet]

GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
```

**Metric:** 30+ upvotes on r/ClaudeAI, 10+ new installs from MCP angle.

---

### DAY 24 (Friday)

**10:00 AM PT — Release v0.6.0**

Major feature release. Target: whatever the #1 community-requested feature is.

**02:00 PM PT — Publish benchmark deep-dive**

**Title:** "Running Llama 3 70B Across 7 Nodes: TentaCLAW Benchmark Results"

Include: tokens/sec, latency, GPU utilization, comparison to single-node, comparison to cloud API latency. Use charts and graphs. This is "developer catnip" — concrete numbers that get screenshotted and shared.

Submit to HN. This is your second HN attempt with a data-driven angle.

**Metric:** 50+ HN points, widely shared in AI communities.

---

### DAY 25-26 (Saturday-Sunday)

**Reduced hours**

- [ ] Comment sweeps
- [ ] Discord engagement
- [ ] Judge early contest entries, provide encouragement
- [ ] Record "Month 1 update" video (5 min, metrics + roadmap)

---

### DAY 27 (Monday)

**10:00 AM PT — Ecosystem integration blog posts**

Publish 2-3 short integration guides:
- "Connect TentaCLAW to Open WebUI in 5 Minutes"
- "Using TentaCLAW as a Backend for LangChain"
- "TentaCLAW + Continue.dev: Self-Hosted AI Coding Assistant"

Each guide is a gateway to a different community. Cross-post to relevant subreddits and Discords.

**Metric:** Each guide drives 20+ installs from its respective community.

---

### DAY 28 (Tuesday)

**10:00 AM PT — "State of TentaCLAW" blog post**

Transparent metrics post. Publish everything:

```
30 Days of TentaCLAW OS — By the Numbers

Stars: [X]
Installs: [X]
Discord Members: [X]
PRs Merged: [X]
Issues Closed: [X]
Contributors: [X]
Countries: [X]

What worked:
- [Top growth driver]
- [Second driver]

What didn't work:
- [Thing that flopped]
- [Lesson learned]

What's next:
- [Top 3 roadmap items based on community votes]
- v1.0 target date: [date]

Thank you to every person who starred, installed, filed a bug,
submitted a PR, or just said something kind.

This is just the beginning.
```

Submit to HN as "30 Days of Open-Sourcing TentaCLAW OS — What Worked and What Didn't." Transparency posts consistently do well on HN.

**Metric:** 50+ HN points, 20+ new stars from this post alone.

---

### DAY 29 (Wednesday)

**10:00 AM PT — Contest judging**

- [ ] Review all "Show Your Cluster" entries
- [ ] Select winners
- [ ] Prepare announcement graphics
- [ ] Order prizes (stickers, t-shirts, hoodie)

**02:00 PM PT — Contributor milestone recognition**

- [ ] Anyone who merged 3+ PRs gets "Core Contributor" Discord role
- [ ] Top contributor gets a tweet spotlight
- [ ] Create a "Hall of Fame" section in the docs

---

### DAY 30 (Thursday)

**10:00 AM PT — Contest winners announced**

**Discord + Twitter + GitHub Discussions:**

```
"Show Your Cluster" Contest Winners!

Best Cluster: @user — [X] nodes, [description]
Most Creative: @user — [description]
Best Benchmarks: @user — [numbers]

Every participant earned the "Early Adopter" role.

[Screenshots of winning clusters]

Thank you for building with TentaCLAW. This is what the community
looks like 30 days in. Imagine month 6.
```

**02:00 PM PT — 30-day retrospective and v1.0 roadmap**

Post a GitHub Discussion pinning the v1.0 roadmap:

```
Title: Road to v1.0 — Your Votes Decide What Ships

Based on 30 days of community feedback, here's the v1.0 roadmap.
Thumbs-up the items you want most:

Must-have (v1.0):
- [ ] AMD GPU support (full, not stubbed)
- [ ] Windows agent
- [ ] ARM / Raspberry Pi support
- [ ] Prometheus/Grafana metrics export
- [ ] Improved model marketplace / HuggingFace browser

Nice-to-have (v1.1):
- [ ] Web-based terminal improvements
- [ ] Multi-cluster federation (stable)
- [ ] Custom backend plugin API
- [ ] Mobile dashboard (responsive)
- [ ] LDAP/Active Directory SSO

Target: v1.0 in 60 days.

Star the repo, join Discord, and tell us what you need.
```

**06:00 PM PT — Final metrics snapshot**

Record everything. Compare to goals. Celebrate wins. Analyze misses.

---

## Press Kit One-Pager

Save as `assets/press/press-kit.md` and export as PDF.

```
TENTACLAW OS — PRESS KIT

ONE-LINE:
TentaCLAW OS turns scattered GPUs into one self-healing AI inference cluster.

WHAT IT IS:
Open-source, self-hosted GPU cluster management platform. Install on any
machine with a GPU, and it auto-discovers other nodes to form a distributed
inference cluster. Like HiveOS but for AI instead of mining.

KEY NUMBERS:
- 150+ API endpoints
- 782 tests passing
- 12-tab Proxmox-style dashboard
- 111 CLI commands
- 6 inference backends
- MIT licensed

BACKENDS SUPPORTED:
Ollama, vLLM, SGLang, llama.cpp, BitNet, ExLlamaV2

INSTALL:
curl -fsSL https://tentaclaw.io/install | bash

LINKS:
- GitHub: https://github.com/TentaCLAW-OS/TentaCLAW
- Website: https://tentaclaw.io
- Discord: https://discord.gg/tentaclaw
- Demo video: [YouTube link]

FOUNDER:
Alexa — [bio/email]

SCREENSHOTS:
[Available in assets/press/ folder]

BRAND:
- Mascot: CLAWtopus (octopus)
- Tagline: "Eight arms. One mind. Zero compromises."
- Colors: #00d4aa (teal), #8b5cf6 (purple), #ffdd00 (gold)
```

---

## Metrics Tracker

Copy this table and fill in daily. Track in a spreadsheet or Notion.

| Day | Date | Stars | Discord | Installs | HN Pts | Reddit Votes | Twitter Impr | PRs | Notes |
|-----|------|-------|---------|----------|--------|-------------|-------------|-----|-------|
| 0 | Apr 1 | | | | | | | | Launch day |
| 1 | Apr 2 | | | | | | | | |
| 2 | Apr 3 | | | | | | | | |
| 3 | Apr 4 | | | | | | | | v0.3.1 release |
| 4 | Apr 5 | | | | | | | | Weekend |
| 5 | Apr 6 | | | | | | | | |
| 6 | Apr 7 | | | | | | | | |
| 7 | Apr 8 | | | | | | | | Comparison article |
| 8 | Apr 9 | | | | | | | | Fix day |
| 9 | Apr 10 | | | | | | | | Good first issues |
| 10 | Apr 11 | | | | | | | | v0.4.0 release |
| 11 | Apr 12 | | | | | | | | Weekend |
| 12 | Apr 13 | | | | | | | | PH prep |
| 13 | Apr 14 | | | | | | | | |
| 14 | Apr 15 | | | | | | | | Product Hunt day |
| 15 | Apr 16 | | | | | | | | Enterprise post |
| 16 | Apr 17 | | | | | | | | Reddit wave 2 |
| 17 | Apr 18 | | | | | | | | v0.5.0 + calculator |
| 18 | Apr 19 | | | | | | | | Weekend |
| 19 | Apr 20 | | | | | | | | |
| 20 | Apr 21 | | | | | | | | Sponsors setup |
| 21 | Apr 22 | | | | | | | | Contest launch |
| 22 | Apr 23 | | | | | | | | Contributor day |
| 23 | Apr 24 | | | | | | | | MCP push |
| 24 | Apr 25 | | | | | | | | v0.6.0 + benchmarks |
| 25 | Apr 26 | | | | | | | | Weekend |
| 26 | Apr 27 | | | | | | | | |
| 27 | Apr 28 | | | | | | | | Integration guides |
| 28 | Apr 29 | | | | | | | | State of TentaCLAW |
| 29 | Apr 30 | | | | | | | | Contest judging |
| 30 | May 1 | | | | | | | | Winners + retrospective |

---

## Emergency Playbooks

### "We're getting roasted on HN"

1. Do NOT get defensive. Thank every critic.
2. Acknowledge valid points: "You're right, [X] is a limitation. Here's our plan..."
3. Fix any legitimate bugs mentioned within hours (yes, hours)
4. Post a follow-up comment: "Thanks for the feedback. We just shipped a fix for [X]. Updated README to clarify [Y]."
5. The fastest way to flip HN sentiment: ship a fix during the thread's lifetime.

### "Install script is broken and people are reporting it"

1. Acknowledge immediately on every platform: "We're aware of the install issue and fixing it now."
2. Provide Docker alternative: "While we fix the install script, use: `docker compose up`"
3. Fix. Test on 3 different environments. Push.
4. Post: "Install script fixed. Sorry about that. Here's what went wrong: [brief explanation]."
5. Ship a patch release (e.g., v0.3.2) even if it's a one-line fix. Releases signal competence.

### "Nobody is engaging (crickets)"

1. Check timing. Re-share at a different time of day.
2. Ask 3-5 friends to leave genuine comments (not upvotes — comments carry more weight).
3. Post in smaller, more targeted communities (specific GPU Discord servers, homelab forums).
4. Create more visual content (GIFs, screenshots, diagrams) — text posts get less engagement.
5. Reply to relevant threads on Reddit/HN where someone is asking about distributed inference. Don't spam your link — genuinely help and mention TentaCLAW naturally.

### "A YouTuber wants to cover us but the demo isn't working"

1. Drop everything. Fix the demo path.
2. Offer to pair with them on a call to set up TentaCLAW on their hardware.
3. Record a backup demo video they can use as B-roll.
4. Provide a VM image with TentaCLAW pre-installed if their hardware isn't compatible.
5. YouTuber coverage is worth 100x a Reddit post. Prioritize ruthlessly.

### "We hit 1,000 stars early"

1. Celebrate publicly: "1,000 stars in [X] days! Thank you."
2. Set a new goal: 2,500 by day 60.
3. Announce a milestone celebration: merge a fun PR (easter egg, ASCII art, CLAWtopus animation).
4. Use the momentum: "If you starred, try installing. If you installed, file a bug. If it works, share your cluster."
5. This is the time to pitch bigger YouTubers and submit conference CFPs.

---

## Content Calendar Summary

| Day | Platform | Content Type | Key Action |
|-----|----------|-------------|------------|
| 0 | HN, Reddit, Twitter, LinkedIn, Dev.to | Launch posts | THE launch day |
| 1 | Reddit r/homelab | Homelab angle | Cross-community |
| 2 | Reddit r/MachineLearning, Blog | Technical + "Why I Built" | Depth content |
| 3 | Reddit r/linux | Linux distro angle | Release v0.3.1 |
| 5 | HN | Market commentary | Sunday evening window |
| 6 | Reddit r/opensource | OSS philosophy | Week 1 retro |
| 7 | Blog, Dev.to, HN | Comparison article | Trust building |
| 9 | YouTube DMs | Creator outreach | Seed future coverage |
| 10 | GitHub, Discord, Twitter | v0.4.0 release | Ship community fixes |
| 14 | Product Hunt | PH launch | Second spike |
| 15 | LinkedIn, Blog | Enterprise angle | New audience |
| 16 | Reddit r/LocalLLaMA | 2-week update | Return visit |
| 17 | Website | Cost calculator | SEO tool |
| 21 | All platforms | Contest launch | UGC campaign |
| 22 | Blog | SEO tutorial | Long-tail traffic |
| 23 | Reddit r/ClaudeAI, r/cursor | MCP angle | AI agent community |
| 24 | HN, Blog | Benchmark deep-dive | Data-driven content |
| 27 | Blog, subreddits | Integration guides | Ecosystem hooks |
| 28 | HN, Blog | 30-day retrospective | Transparency play |
| 30 | All platforms | Contest winners + roadmap | Close the loop |

---

## Final Checklist: What "Launched" Means

You are not launched until ALL of these are true:

- [ ] Someone who has never seen TentaCLAW can go from the GitHub README to a running dashboard in under 5 minutes
- [ ] The repo has 10+ stars from people you don't personally know
- [ ] At least 1 bug has been reported and fixed by someone outside the core team
- [ ] Discord has at least 1 conversation that happened without you starting it
- [ ] Someone has shared a screenshot of their TentaCLAW cluster unprompted

When all five are true, you've launched. Everything before that is pre-launch.

---

*"Eight arms. One mind. Zero compromises."*

*This plan was built for execution, not inspiration. Follow it day by day. Ship every day. Reply to every comment. Fix every bug. The stars will follow.*
