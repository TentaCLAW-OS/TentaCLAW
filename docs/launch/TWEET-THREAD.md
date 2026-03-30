# Twitter/X Launch Thread

Post as a thread (reply chain). Pin the first tweet.

---

## Tweet 1: Announcement (pin this)

```
Introducing TentaCLAW OS -- open-source AI inference cluster OS.

Turn scattered GPUs into one self-healing cluster.
Auto-discovery. 6 backends. 86 CLI commands. Zero config.

Like HiveOS, but for AI instead of mining.

github.com/TentaCLAW-OS/TentaCLAW
```

**Image:** Dashboard summary screenshot (`assets/screenshots/dashboard-summary.png`)

**Alt text:** "TentaCLAW OS dashboard showing cluster summary with 3 nodes, 7 GPUs, VRAM usage, and health score"

---

## Tweet 2: Dashboard

```
The dashboard shows every node, GPU, model, and metric in real-time.

- Resource tree (Proxmox-style)
- GPU temps, VRAM, tok/s
- Health scoring (A-F grades)
- Flight sheets for declarative deploys
- AI chat built in
- 8 themes (yes, dracula is one of them)

All via SSE -- no WebSocket.
```

**Image:** Collage of dashboard views -- summary, metrics, chat, login (`assets/screenshots/` collage)

**Alt text:** "Four dashboard views: cluster summary, metrics charts, AI chat interface, and login page"

---

## Tweet 3: CLI

```
clawtopus -- 86 commands, zero dependencies.

clawtopus status    → cluster overview
clawtopus deploy    → smart model placement
clawtopus top       → live monitoring
clawtopus chat      → talk to your cluster
clawtopus doctor    → diagnose + auto-fix
clawtopus drain     → maintenance mode
clawtopus gpu-map   → visual GPU map

Pure TypeScript. No node_modules at runtime.
```

**Image:** Terminal screenshot showing `clawtopus status` output with node list and GPU stats

**Alt text:** "Terminal showing clawtopus status command with 3 nodes, GPU details, and cluster health"

---

## Tweet 4: Install

```
Install in 60 seconds:

curl -fsSL https://tentaclaw.io/install | bash

Or Docker:

docker compose up

Or mock mode (no GPUs needed):

cd gateway && npm run dev
cd agent && npx tsx src/index.ts --mock

810 tests. 68K lines. MIT licensed.
```

**Image:** Terminal showing the install command completing with CLAWtopus ASCII art

**Alt text:** "Terminal showing TentaCLAW installation completing with ASCII octopus art"

---

## Tweet 5: Links + CTA

```
TentaCLAW OS supports Ollama, vLLM, SGLang, llama.cpp, BitNet, and MLX. Mix NVIDIA + AMD + CPU nodes.

Links:
GitHub: github.com/TentaCLAW-OS/TentaCLAW
Website: tentaclaw.io
Discord: discord.gg/tentaclaw

Star it. Try it. Break it. Tell us what's missing.
```

**Image:** Architecture diagram or comparison table from README

**Alt text:** "TentaCLAW architecture diagram showing gateway coordinating 3 inference nodes with different GPU types"

---

## Posting Notes

- Post all 5 tweets as a thread (reply chain), not individual tweets
- Pin Tweet 1 to your profile
- Post between 9-11am ET on a weekday
- Reply to your own thread with the GitHub link again (visibility)
- Quote-tweet from the project account if separate from personal account
- Tag relevant accounts in a follow-up reply (not in the main thread):
  - @ollaboratory (Ollama)
  - @vaboratory (vLLM if they have one)
  - @LocalLLaMA (if active on X)
- Use hashtags sparingly -- one reply with: `#LocalAI #selfhosted #opensource #LLM #GPU`
