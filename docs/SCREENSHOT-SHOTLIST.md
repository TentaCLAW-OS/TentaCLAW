# TentaCLAW OS Screenshot Shotlist

## Goal
Create the minimum screenshot set needed to make the launch page feel real.

## Shot 1 — Boot Splash
**Filename:** `screenshot-boot.png`

### Must show
- TentaCLAW OS name
- CLAWtopus or boot identity
- readable boot text
- clean terminal framing

### Good caption
**Boot a node. Let CLAWtopus take it from there.**

## Shot 2 — Cluster Dashboard
**Filename:** `screenshot-dashboard.png`

### Must show
- at least 2 nodes
- healthy / online state
- GPU or VRAM stats
- one glance understanding that this is a cluster view

### Good caption
**See the whole tank from one dashboard.**

## Shot 3 — CLI Control
**Filename:** `screenshot-cli.png`

### Must show
- `clawtopus` command
- useful output (`status`, `models`, `deploy`, or `health`)
- tidy theme with minimal junk

### Good caption
**One CLI for the whole cluster.**

## Shot 4 — Inference Proof
**Filename:** `screenshot-inference.png`

### Must show
- deployed model or inference result
- obvious proof that useful work is happening
- ideally tie back to the cluster or dashboard

### Good caption
**Deploy a model. Run inference. Done.**

## Optional Shot 5 — Model Search
**Filename:** `screenshot-model-search.png`

### Must show
- model list or fit check
- VRAM sizing or deployment context

## Optional Shot 6 — Pull Progress
**Filename:** `screenshot-pull-progress.png`

### Must show
- model download progress
- useful operational signal

## Optional Shot 7 — Alerts / Health
**Filename:** `screenshot-alerts.png`

### Must show
- health score, alerts, or warning state
- evidence the system is monitoring real things

## Capture Rules
- Use the same theme and sizing across screenshots
- Avoid cluttered browser tabs or desktop junk
- Crop tight enough to read on mobile
- Prefer proof over aesthetics, but don’t ignore aesthetics
- If a screenshot is confusing without explanation, retake it

## Recommended Order in README / release
1. Boot splash
2. Dashboard
3. CLI
4. Inference proof

## Alt Text Drafts
- **Boot splash:** TentaCLAW OS boot screen with CLAWtopus branding and cluster startup text.
- **Dashboard:** TentaCLAW dashboard showing multiple healthy GPU nodes and cluster stats.
- **CLI:** CLAWtopus CLI output showing cluster status and model management commands.
- **Inference proof:** Successful model deployment or inference response from the cluster.
