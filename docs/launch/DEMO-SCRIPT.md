# Demo Video Script

**Total runtime:** 3:30 - 4:00
**Format:** Screen recording with voiceover (no face cam)
**Resolution:** 1920x1080, 60fps
**Music:** Lo-fi or ambient electronic, low volume under voiceover

---

## Scene 1: Intro (0:00 - 0:10)

**Screen:** TentaCLAW logo animation or static hero image on dark background. Tagline: "Your GPUs. One Brain. Zero Limits."

**Voiceover:**
> "This is TentaCLAW OS -- an open-source operating system that turns scattered GPUs into one unified AI inference cluster."

**Shot list:**
- [ ] Logo/hero graphic (full screen, 3s)
- [ ] Quick cut: dashboard summary view (3s)
- [ ] Quick cut: terminal with `clawtopus status` output (2s)
- [ ] Quick cut: node with GPUs visible (2s)

---

## Scene 2: The Problem (0:10 - 0:30)

**Screen:** Split-screen showing 3-4 terminal windows, each SSH'd into a different machine.

**Voiceover:**
> "If you're running local AI inference, you probably know this pain. Multiple machines, each running Ollama separately. No unified dashboard. No load balancing. No idea which node has free VRAM. If a GPU overheats at 3am, you find out the next morning."

**Shot list:**
- [ ] Terminal: SSH into node 1, run `nvidia-smi` (3s)
- [ ] Terminal: SSH into node 2, run `ollama list` (3s)
- [ ] Terminal: SSH into node 3, see an error/timeout (3s)
- [ ] Red X overlay on the multi-terminal view (1s)

**Voiceover:**
> "TentaCLAW fixes this."

---

## Scene 3: One-Line Install (0:30 - 1:00)

**Screen:** Clean terminal, dark theme.

**Voiceover:**
> "Installation takes one command."

**Shot list:**
- [ ] Type: `curl -fsSL https://tentaclaw.io/install | bash` (5s)
- [ ] Show install output scrolling (fast-forward, 5s)
- [ ] Install complete message with CLAWtopus ASCII art (3s)

**Voiceover:**
> "Or if you prefer Docker..."

**Shot list:**
- [ ] Type: `docker compose up` (3s)
- [ ] Show containers starting (fast-forward, 3s)
- [ ] "Gateway ready" message (2s)

**Voiceover:**
> "The gateway is running. Let's open the dashboard."

**Shot list:**
- [ ] Type: `open http://localhost:8080/dashboard` or click a browser bookmark (3s)
- [ ] Browser opens, login page appears (3s)

---

## Scene 4: Dashboard Tour (1:00 - 2:00)

**Screen:** Browser showing TentaCLAW dashboard.

### 4a: Summary View (1:00 - 1:20)

**Voiceover:**
> "This is the dashboard. On the left, the resource tree -- every node, every GPU, all your models. On the right, the summary: total GPUs, total VRAM, cluster-wide tokens per second, health score."

**Shot list:**
- [ ] Full dashboard view, summary tab active (5s)
- [ ] Mouse hover over resource tree, expand a node (3s)
- [ ] Point out: GPU count, VRAM bar, health grade (3s)
- [ ] Sparkline charts updating in real-time (3s)

### 4b: Nodes View (1:20 - 1:35)

**Voiceover:**
> "Click on a node to see its details. GPU temperatures, VRAM usage, power draw, loaded models, uptime. All updating in real-time via server-sent events."

**Shot list:**
- [ ] Click a node in the tree (2s)
- [ ] Node detail panel with GPU stats (5s)
- [ ] Highlight real-time temperature/VRAM updating (3s)
- [ ] Scroll to see loaded models (3s)

### 4c: Metrics View (1:35 - 1:50)

**Voiceover:**
> "The metrics tab shows inference analytics. Requests per minute, latency percentiles, model usage breakdown. You can see which models are getting hit hardest and where your bottlenecks are."

**Shot list:**
- [ ] Click Metrics tab (2s)
- [ ] Charts showing request volume, latency p50/p95/p99 (5s)
- [ ] Model usage breakdown chart (3s)

### 4d: Flight Sheets (1:50 - 2:00)

**Voiceover:**
> "Flight sheets let you declare what should run where. Define your models, assign them to nodes, apply with one click. Declarative deployment -- like Kubernetes manifests but for inference."

**Shot list:**
- [ ] Click Flight Sheets tab (2s)
- [ ] Show a flight sheet with model assignments (5s)
- [ ] Click "Apply" button (3s)

---

## Scene 5: AI Chat (2:00 - 2:30)

**Screen:** Dashboard chat tab.

**Voiceover:**
> "You can chat with any loaded model directly from the dashboard. Pick a model, type a message, and watch it stream back. The gateway routes your request to the best available node automatically."

**Shot list:**
- [ ] Click Chat tab (2s)
- [ ] Select model from dropdown: `llama3.1:8b` (3s)
- [ ] Type: "Explain how GPU inference clustering works in 3 sentences" (5s)
- [ ] Show streaming response appearing token by token (10s)
- [ ] Response complete (2s)

**Voiceover:**
> "That request was routed to the node with the most free VRAM and lowest queue depth. The client never needs to know which node handled it."

---

## Scene 6: CLI Demo (2:30 - 3:10)

**Screen:** Terminal, dark theme.

**Voiceover:**
> "Everything in the dashboard is also available from the command line. CLAWtopus -- the CLI -- has 86 commands."

**Shot list:**
- [ ] Type: `clawtopus status` -- show cluster overview (5s)
- [ ] Type: `clawtopus nodes` -- show node list with GPUs (5s)
- [ ] Type: `clawtopus top` -- show live monitoring view refreshing (5s)
- [ ] Let `top` refresh 2-3 times to show real-time updates (5s)
- [ ] Ctrl+C to exit `top` (1s)

**Voiceover:**
> "Deploy a model to the best available node with one command."

**Shot list:**
- [ ] Type: `clawtopus deploy llama3.1:8b` (3s)
- [ ] Show deployment output: node selected, model pulling, ready (5s)

**Voiceover:**
> "Chat from the terminal."

**Shot list:**
- [ ] Type: `clawtopus chat --model llama3.1:8b "What is TentaCLAW?"` (3s)
- [ ] Show streaming response in terminal (5s)

---

## Scene 7: Comparison (3:10 - 3:30)

**Screen:** Side-by-side comparison.

**Voiceover:**
> "Without TentaCLAW: SSH into each machine, manage backends separately, no unified view, no load balancing, no alerting. With TentaCLAW: one dashboard, one API, one CLI, auto-discovery, self-healing. Your GPUs, one brain."

**Shot list:**
- [ ] Left side: multiple terminals, chaos (3s)
- [ ] Right side: clean dashboard with everything managed (3s)
- [ ] Animated transition or wipe between the two (2s)
- [ ] Comparison table overlay (5s):

```
Without TentaCLAW          With TentaCLAW
─────────────────          ──────────────
SSH into each node         One dashboard
Manage Ollama separately   One API endpoint
No load balancing          Smart routing
No alerting                Self-healing watchdog
No visibility              Real-time metrics
```

---

## Scene 8: Closing (3:30 - 3:50)

**Screen:** GitHub repo page, then logo.

**Voiceover:**
> "TentaCLAW OS is open source, MIT licensed, and free. 810 tests, 68,000 lines of code, 6 inference backends. Try it today."

**Shot list:**
- [ ] GitHub repo page, star button visible (3s)
- [ ] Overlay: `curl -fsSL https://tentaclaw.io/install | bash` (3s)
- [ ] Overlay links (5s):

```
GitHub:  github.com/TentaCLAW-OS/TentaCLAW
Website: tentaclaw.io
Discord: discord.gg/tentaclaw
```

- [ ] CLAWtopus logo with tagline: "Eight arms. One mind. Zero limits." (3s)
- [ ] Fade to black

---

## Production Notes

### Recording Setup
- **Screen recording:** OBS Studio (1080p, 60fps, CRF 18)
- **Terminal:** Use a clean terminal profile with large font (16-18pt), dark theme
- **Browser:** Full screen or maximized, no bookmarks bar, no other tabs visible
- **Typing:** Pre-type commands in a script, paste them in for clean recordings. Alternatively, use a typing simulator for consistent speed
- **Dashboard:** Use mock agents with interesting data (multiple nodes, varied GPU types, some models loaded)

### Audio
- Record voiceover separately (better quality than live narration)
- Microphone: USB condenser or headset, quiet room
- Edit in Audacity or similar -- normalize, noise gate, light compression
- Background music: royalty-free lo-fi or ambient. Suggestions:
  - Epidemic Sound "coding" playlists
  - YouTube Audio Library (free)
  - Artlist.io

### Editing
- Fast-forward long operations (install, model pulls) with a speed indicator
- Use zoom/crop to highlight specific UI elements when discussed
- Add subtle click animations when interacting with the dashboard
- Lower third text for key features mentioned in voiceover

### Thumbnail
- Dashboard screenshot with CLAWtopus logo overlay
- Text: "TentaCLAW OS -- GPU Cluster for AI"
- Bold, readable at small sizes
