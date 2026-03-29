# TentaCLAW OS — Roadmap to v1.0

> Reverse-engineered from HiveOS architecture, adapted for AI inference.
> 1000 phases organized into 20 milestones.

## Current State (v0.2.0)

- 72 API endpoints, 11 DB tables, 57 tests
- 4 real AMD GPU nodes reporting (9 GPUs, 25 Ollama models)
- CLAWtopus CLI with model search, doctor mode, package manager
- Dashboard (needs major work)
- Mock agent for development
- AMD + NVIDIA GPU detection via sysfs/nvidia-smi

## What HiveOS Does That We Don't (Yet)

### Critical Gaps
1. **Rig.conf auto-generation** — HiveOS generates config on first boot from Farm Hash URL
2. **Watchdog** — GPU hang detection, auto-reboot, hashrate (tok/s) monitoring with thresholds
3. **Per-GPU overclocking from dashboard** — core clock, mem clock, power limit, fan curve per card
4. **Auto-fan** — temperature-based fan curve that runs locally on each node
5. **Remote shell** — web-based terminal into any rig from the dashboard
6. **Telegram/Discord alerts** — real-time notifications, not just in-dashboard
7. **Bulk operations** — select 50 rigs, apply flight sheet to all
8. **Auto-update** — agent self-updates from gateway or GitHub
9. **VPN/WAN** — rigs behind NAT can still connect (like HiveOS uses WireGuard)
10. **Worker screenshots** — see what the rig's screen shows (for debugging)
11. **Uptime tracking** — historical uptime percentage per rig
12. **Wallet management** → replaced by **API key management** for inference
13. **Pool management** → replaced by **Model registry** and **endpoint routing**

---

## Phase 1-50: WATCHDOG & SELF-HEALING (Milestone 1)

The #1 feature that makes HiveOS indispensable. If a GPU hangs or inference stops, the system fixes itself.

### Phase 1-10: Watchdog Core
- [ ] 1. Agent-side watchdog thread — monitors GPU responsiveness every 30s
- [ ] 2. Tok/s threshold monitoring — alert if tok/s drops below configured minimum
- [ ] 3. GPU hang detection — if sysfs stops responding, flag GPU as hung
- [ ] 4. Auto-restart Ollama on crash detection
- [ ] 5. Auto-reboot node if GPU driver crashes (configurable)
- [ ] 6. Watchdog config in rig.conf (thresholds, actions, cooldowns)
- [ ] 7. Watchdog status endpoint — GET /api/v1/nodes/:id/watchdog
- [ ] 8. Watchdog history — log every intervention
- [ ] 9. Dashboard watchdog panel — shows last action, uptime, restarts
- [ ] 10. CLI: `clawtopus watchdog status` / `clawtopus watchdog config`

### Phase 11-20: Smart Recovery
- [ ] 11. Inference health probe — actually send a test prompt and verify response
- [ ] 12. Model corruption detection — if model fails to load 3x, mark as corrupt
- [ ] 13. Auto-re-pull corrupt models from Ollama library
- [ ] 14. Memory leak detection — track RSS over time, restart if growing
- [ ] 15. Disk space watchdog — if < 5GB free, auto-clean old models
- [ ] 16. Network partition handling — if gateway unreachable, queue stats locally
- [ ] 17. Offline mode — agent continues running inference even without gateway
- [ ] 18. Recovery log — every auto-fix action logged with timestamp and result
- [ ] 19. Configurable escalation — warn → restart service → restart GPU → reboot
- [ ] 20. Cool-down periods — don't reboot in a loop (max 3 reboots per hour)

### Phase 21-30: Uptime & Reliability Metrics
- [ ] 21. Uptime tracker — per-node uptime percentage (24h, 7d, 30d)
- [ ] 22. MTTR (mean time to recovery) calculation
- [ ] 23. MTBF (mean time between failures) per GPU
- [ ] 24. Availability score per node (factors in reboots, hangs, offline periods)
- [ ] 25. Fleet reliability dashboard panel
- [ ] 26. SLA tracking — "99.5% uptime this month"
- [ ] 27. Historical downtime events timeline
- [ ] 28. Predictive maintenance — flag GPUs with increasing temp trends
- [ ] 29. Export reliability reports (JSON/CSV)
- [ ] 30. CLI: `clawtopus uptime` / `clawtopus reliability`

### Phase 31-40: Per-GPU Overclocking
- [ ] 31. AMD GPU overclock via sysfs (pp_od_clk_voltage, power_cap)
- [ ] 32. NVIDIA GPU overclock via nvidia-smi / nvidia-settings
- [ ] 33. Per-GPU overclock profiles stored in DB
- [ ] 34. Apply overclock on boot (systemd service)
- [ ] 35. Dashboard overclock editor — sliders for core/mem/power/fan per GPU
- [ ] 36. Overclock presets: stock, efficiency, performance, max
- [ ] 37. Auto-tune — binary search for stable max clocks
- [ ] 38. Overclock revert on crash (safety net)
- [ ] 39. Temperature-based throttling (reduce clocks if > threshold)
- [ ] 40. CLI: `clawtopus overclock <nodeId> <gpuIdx> --core +100 --mem +500 --power 80%`

### Phase 41-50: Auto-Fan Control
- [ ] 41. Fan curve engine — temp-to-fan-speed mapping
- [ ] 42. AMD fan control via sysfs hwmon pwm1_enable + pwm1
- [ ] 43. Default fan curves: quiet, balanced, aggressive, full-blast
- [ ] 44. Custom fan curves per node or per GPU
- [ ] 45. Dashboard fan curve editor (drag points on a graph)
- [ ] 46. Fan speed monitoring in real-time dashboard
- [ ] 47. Fan failure detection (fan at 0% but GPU > 80°C)
- [ ] 48. Emergency fan override (all fans to 100% on critical temp)
- [ ] 49. Fan curve sync — apply same curve to all nodes with same GPU
- [ ] 50. CLI: `clawtopus fan <nodeId> --curve balanced`

---

## Phase 51-100: REMOTE ACCESS & CONTROL (Milestone 2)

### Phase 51-60: Remote Shell
- [ ] 51. WebSocket-based terminal — gateway proxies shell to agent
- [ ] 52. Agent opens reverse shell tunnel to gateway on connect
- [ ] 53. Dashboard terminal widget — xterm.js in browser
- [ ] 54. Authentication — only farm owner can access shells
- [ ] 55. Command history and audit log
- [ ] 56. Multi-tab — open shells to multiple nodes simultaneously
- [ ] 57. File upload/download through the shell
- [ ] 58. Shell timeout — auto-disconnect after 30min idle
- [ ] 59. CLI: `clawtopus ssh <nodeId>` — SSH-like experience via gateway proxy
- [ ] 60. Read-only mode for monitoring (non-destructive)

### Phase 61-70: Notifications & Alerting
- [ ] 61. Telegram bot integration — send alerts to Telegram chat
- [ ] 62. Discord webhook integration
- [ ] 63. Email alerts (SMTP config)
- [ ] 64. Webhook URL — POST alerts to any endpoint
- [ ] 65. Alert rules engine — configurable conditions and actions
- [ ] 66. Alert escalation — Telegram first, then email if not acked in 10min
- [ ] 67. Alert grouping — don't spam 50 messages for 50 GPUs overheating
- [ ] 68. Quiet hours / maintenance windows
- [ ] 69. Per-node alert suppression
- [ ] 70. Dashboard notification center with read/unread

### Phase 71-80: Bulk Operations
- [ ] 71. Select multiple nodes in dashboard (checkbox)
- [ ] 72. Bulk apply flight sheet to selection
- [ ] 73. Bulk reboot selection
- [ ] 74. Bulk overclock profile apply
- [ ] 75. Bulk command execution
- [ ] 76. Bulk tag assignment
- [ ] 77. "Select all online" / "Select by tag" shortcuts
- [ ] 78. Bulk operation progress tracking
- [ ] 79. Undo last bulk operation (where possible)
- [ ] 80. CLI: `clawtopus bulk reboot --tag production`

### Phase 81-100: Auto-Update & Maintenance
- [ ] 81. Agent version tracking in gateway DB
- [ ] 82. Agent auto-update — download new version from gateway
- [ ] 83. Rolling update — update 1 node at a time, verify health before next
- [ ] 84. Rollback — if new version crashes, auto-revert to previous
- [ ] 85. Gateway self-update from GitHub releases
- [ ] 86. Ollama version tracking and auto-update
- [ ] 87. Model auto-update — re-pull models when new versions available
- [ ] 88. Maintenance mode — take node offline gracefully (drain requests first)
- [ ] 89. Scheduled maintenance windows (e.g., reboot at 3am Sunday)
- [ ] 90. Update changelog visible in dashboard
- [ ] 91. OS package updates (apt upgrade) via agent
- [ ] 92. Kernel update tracking
- [ ] 93. Driver update tracking (amdgpu, nvidia)
- [ ] 94. Security patch alerts
- [ ] 95. Disk health monitoring (SMART)
- [ ] 96. Network speed test between nodes
- [ ] 97. Power supply monitoring (where hardware supports it)
- [ ] 98. USB device inventory
- [ ] 99. BIOS/firmware version tracking
- [ ] 100. Hardware change detection (new GPU added, RAM changed)

---

## Phase 101-200: INFERENCE INTELLIGENCE (Milestone 3)

### Phase 101-120: Smart Load Balancing
- [ ] 101. Request queue per node with priority levels
- [ ] 102. Weighted round-robin based on GPU VRAM + tok/s
- [ ] 103. Sticky sessions — same user hits same node for context continuity
- [ ] 104. Model affinity — prefer nodes that already have model loaded
- [ ] 105. Geographic routing (for multi-site clusters)
- [ ] 106. Cost-based routing — prefer cheapest node (power cost aware)
- [ ] 107. Quality-based routing — prefer nodes with best benchmark scores
- [ ] 108. Failover — if primary node down, route to backup
- [ ] 109. Circuit breaker — if node error rate > 5%, stop routing to it
- [ ] 110. Request timeout with automatic retry on different node
- [ ] 111. Streaming response proxy (SSE passthrough for chat)
- [ ] 112. Request logging — log every inference request with latency, tokens, node
- [ ] 113. Request analytics dashboard — req/s, p50/p95/p99 latency
- [ ] 114. Rate limiting per API key
- [ ] 115. Token counting and usage tracking per key
- [ ] 116. Cost estimation per request
- [ ] 117. Batch inference endpoint — submit many prompts, get results async
- [ ] 118. Priority queues — paid users get faster routing
- [ ] 119. A/B model testing — route % of traffic to new model
- [ ] 120. Canary deployments — deploy model to 1 node, verify, then roll out

### Phase 121-150: Model Management
- [ ] 121. Model registry — track all models across all nodes
- [ ] 122. Model health status — loaded, loading, error, not-pulled
- [ ] 123. Model auto-pull on deploy — if node doesn't have model, pull it
- [ ] 124. Model garbage collection — remove models unused for N days
- [ ] 125. Model pinning — "always keep this model loaded on this node"
- [ ] 126. Model preloading — load model into GPU memory on boot
- [ ] 127. Model size estimation — predict VRAM usage before pull
- [ ] 128. GGUF quantization awareness — show Q4, Q5, Q8 options
- [ ] 129. Model compatibility check — "this model needs 48GB, your GPU has 16GB"
- [ ] 130. Model benchmarking on pull — auto-run benchmark after install
- [ ] 131. Model leaderboard — rank models by tok/s across your cluster
- [ ] 132. Model favorites / bookmarks
- [ ] 133. Model description and tags from HuggingFace
- [ ] 134. Custom model support — load GGUF files from local path
- [ ] 135. Model sharing between nodes (P2P transfer, not re-download)
- [ ] 136. Model backup to NAS/S3
- [ ] 137. Model version tracking (detect when Ollama updates a model)
- [ ] 138. Model performance regression alerts
- [ ] 139. Model A/B comparison tool
- [ ] 140. Multi-model inference — chain models in a pipeline
- [ ] 141. LoRA adapter support
- [ ] 142. Model warm-up — send test prompts to pre-fill KV cache
- [ ] 143. Model scheduling — load model X during business hours, model Y overnight
- [ ] 144. GPU memory management — unload least-used model when VRAM full
- [ ] 145. Cross-node model distribution optimization
- [ ] 146. Model pull progress in dashboard (real-time progress bars)
- [ ] 147. Parallel model pull across nodes
- [ ] 148. Model integrity verification (checksum)
- [ ] 149. Model access control — which API keys can use which models
- [ ] 150. Model cost tracking — tokens served per model per day

---

## Phase 151-250: PRODUCTION-GRADE API (Milestone 4)

### Phase 151-180: API Key Management
- [ ] 151. API key generation (create/revoke)
- [ ] 152. API key scopes (read-only, inference-only, admin)
- [ ] 153. API key rate limits (per key)
- [ ] 154. API key usage tracking (requests, tokens, cost)
- [ ] 155. API key expiration dates
- [ ] 156. API key per-model restrictions
- [ ] 157. Dashboard API key management panel
- [ ] 158. CLI: `clawtopus apikey create --name "my-app" --scope inference`
- [ ] 159. API key rotation — generate new key, grace period for old
- [ ] 160. API key audit log — who used what key when
- [ ] 161. JWT token support (for web apps)
- [ ] 162. OAuth2 provider (so external apps can authenticate)
- [ ] 163. CORS configuration per API key
- [ ] 164. IP allowlist per API key
- [ ] 165. Usage alerts — "key X used 90% of its monthly quota"
- [ ] 166. Usage dashboard — graphs of requests/tokens per key over time
- [ ] 167. Billing integration hooks
- [ ] 168. Multi-tenant support — multiple users sharing one cluster
- [ ] 169. Organization/team support
- [ ] 170. Role-based access control (admin, operator, viewer)

### Phase 171-200: OpenAI-Compatible API Polish
- [ ] 171. Full OpenAI Chat Completions spec compliance
- [ ] 172. Function calling / tool use support
- [ ] 173. JSON mode (structured output)
- [ ] 174. Vision API support (for multimodal models)
- [ ] 175. Embeddings API with batching
- [ ] 176. Model listing with capabilities metadata
- [ ] 177. Streaming with proper SSE format
- [ ] 178. Token usage in response headers
- [ ] 179. Error responses matching OpenAI format
- [ ] 180. Request validation middleware
- [ ] 181. Request/response logging (opt-in)
- [ ] 182. Prompt caching — identical prompts return cached response
- [ ] 183. Response caching with TTL
- [ ] 184. Request deduplication (same prompt from same user within 1s)
- [ ] 185. Prompt templating — pre-defined system prompts per API key
- [ ] 186. Content filtering / moderation hooks
- [ ] 187. Max tokens enforcement
- [ ] 188. Stop sequence support
- [ ] 189. Temperature/top_p/top_k passthrough
- [ ] 190. Seed support for reproducibility
- [ ] 191. Logprobs support
- [ ] 192. Multiple completion choices (n > 1)
- [ ] 193. Suffix/prefix support
- [ ] 194. Fine-tuning API (trigger fine-tune jobs on cluster)
- [ ] 195. Model alias — "gpt-4" routes to "llama3.1:70b"
- [ ] 196. Fallback chains — if model A fails, try model B
- [ ] 197. Load shedding — reject requests when queue > threshold
- [ ] 198. Health endpoint per model (is model X available?)
- [ ] 199. OpenAPI/Swagger spec generation
- [ ] 200. SDK generation (Python, TypeScript, Go clients)

---

## Phase 201-300: DASHBOARD OVERHAUL (Milestone 5)

### Phase 201-230: HiveOS-Style Dashboard
- [ ] 201. React/Svelte rewrite (ditch vanilla JS)
- [ ] 202. Real-time WebSocket updates (not polling)
- [ ] 203. Worker list with HiveOS-style row layout
- [ ] 204. GPU cards inline — temp bar, util ring, VRAM bar per GPU
- [ ] 205. Expandable worker detail — full GPU info, commands, logs
- [ ] 206. Sortable/filterable worker table
- [ ] 207. Farm selector dropdown (multi-farm)
- [ ] 208. Dark mode (HiveOS green-on-black aesthetic)
- [ ] 209. Responsive mobile layout
- [ ] 210. Keyboard shortcuts (j/k navigate, r refresh, etc.)
- [ ] 211. GPU temperature heatmap (color grid of all GPUs)
- [ ] 212. Cluster topology view (visual map of nodes)
- [ ] 213. Real-time inference request flow visualization
- [ ] 214. Historical charts — tok/s, temp, VRAM, power over time
- [ ] 215. Configurable dashboard widgets (drag and drop)
- [ ] 216. Multiple dashboard layouts (overview, detail, monitoring)
- [ ] 217. Full-screen mode for NOC/wall displays
- [ ] 218. Print-friendly reports
- [ ] 219. Embeddable widgets (iframe for status pages)
- [ ] 220. Theme customization (brand colors)

### Phase 231-250: Dashboard Interactions
- [ ] 231. Right-click context menu on workers
- [ ] 232. Drag-and-drop flight sheet assignment
- [ ] 233. Inline editing of worker names/tags
- [ ] 234. Command palette (Ctrl+K) — search commands
- [ ] 235. Toast notifications for real-time events
- [ ] 236. Confirmation dialogs for destructive actions
- [ ] 237. Undo/redo for configuration changes
- [ ] 238. Activity feed — who did what when
- [ ] 239. User presence — see who else is viewing dashboard
- [ ] 240. Annotations — add notes to nodes/events
- [ ] 241. Bookmarks — save filtered views
- [ ] 242. Export data — CSV/JSON from any table
- [ ] 243. Screenshot/share — generate shareable cluster status image
- [ ] 244. Tour/onboarding — first-time user walkthrough
- [ ] 245. Settings persistence (localStorage)
- [ ] 246. Multi-language support (i18n)
- [ ] 247. Accessibility (ARIA, keyboard nav, screen reader)
- [ ] 248. Performance — virtualized tables for 1000+ nodes
- [ ] 249. Offline mode — cached data when gateway unreachable
- [ ] 250. PWA — installable web app

---

## Phase 251-350: NETWORK & SECURITY (Milestone 6)

### Phase 251-280: Networking
- [ ] 251. WireGuard VPN auto-setup — nodes behind NAT connect to gateway
- [ ] 252. mTLS between agent and gateway
- [ ] 253. Agent authentication (shared secret / certificate)
- [ ] 254. Encrypted stats transport
- [ ] 255. Gateway clustering — multiple gateways for HA
- [ ] 256. Gateway load balancer
- [ ] 257. DNS-based service discovery (mDNS for LAN)
- [ ] 258. DHCP integration — auto-assign hostnames
- [ ] 259. Wake-on-LAN support
- [ ] 260. Network topology mapping
- [ ] 261. Bandwidth monitoring between nodes
- [ ] 262. Latency monitoring (ping mesh)
- [ ] 263. Firewall rule management
- [ ] 264. Port forwarding configuration
- [ ] 265. IPv6 support
- [ ] 266. Proxy support (HTTP/SOCKS5)
- [ ] 267. CDN for model distribution
- [ ] 268. P2P model transfer between nodes
- [ ] 269. Network partition detection and handling
- [ ] 270. Automatic reconnection with exponential backoff

### Phase 281-300: Security
- [ ] 281. User authentication (login system)
- [ ] 282. Password hashing (bcrypt/argon2)
- [ ] 283. Session management (JWT)
- [ ] 284. 2FA/TOTP support
- [ ] 285. Audit log — every admin action logged
- [ ] 286. IP-based access control
- [ ] 287. HTTPS/TLS auto-setup (Let's Encrypt)
- [ ] 288. CSP headers
- [ ] 289. Rate limiting on auth endpoints
- [ ] 290. Brute force protection
- [ ] 291. Secret management (encrypted at rest)
- [ ] 292. Node authentication (prevent rogue agents)
- [ ] 293. Firmware integrity verification
- [ ] 294. Secure boot chain
- [ ] 295. Encrypted DB (SQLCipher)
- [ ] 296. Backup encryption
- [ ] 297. GDPR compliance tools
- [ ] 298. Data retention policies
- [ ] 299. Security scan (port scan, vulnerability check)
- [ ] 300. Bug bounty program setup

---

## Phase 301-400: ISO & BARE METAL (Milestone 7)

Build the actual bootable OS.

- [ ] 301-310: Debootstrap Ubuntu 24.04 with custom kernel config
- [ ] 311-320: Auto-detect GPU vendor on boot, load drivers
- [ ] 321-330: First-boot wizard (set farm hash via URL or QR code)
- [ ] 331-340: Auto-install Ollama + TentaCLAW agent
- [ ] 341-350: PXE network boot support
- [ ] 351-360: USB flash image builder
- [ ] 361-370: Auto-update mechanism (A/B partition scheme)
- [ ] 371-380: Read-only root filesystem (immutable OS)
- [ ] 381-390: Factory reset capability
- [ ] 391-400: Hardware compatibility testing + certification

---

## Phase 401-500: DAPHNEY INTEGRATION (Milestone 8)

Connect the AI personality layer.

- [ ] 401-420: DaphneyBrain UE5 ↔ Gateway real-time bridge
- [ ] 421-440: Brain region mapping — each GPU = a neuron cluster
- [ ] 441-460: Daphney voice commands — "deploy llama to all nodes"
- [ ] 461-480: Daphney monitors cluster health, speaks alerts
- [ ] 481-500: Daphney personality responds to inference requests

---

## Phase 501-600: CLAWtopus CLI POLISH (Milestone 9)

- [ ] 501-520: Interactive TUI mode (blessed/ink terminal UI)
- [ ] 521-540: Auto-completion (bash/zsh/fish)
- [ ] 541-560: Configuration wizard (`clawtopus init`)
- [ ] 561-580: Plugin system for custom commands
- [ ] 581-600: npm package publishing + global install

---

## Phase 601-700: MARKETPLACE & ECOSYSTEM (Milestone 10)

- [ ] 601-620: Plugin/extension system
- [ ] 621-640: Model marketplace (community-shared flight sheets)
- [ ] 641-660: Hardware compatibility database
- [ ] 661-680: Community benchmarks (submit + compare)
- [ ] 681-700: TentaCLAW.io website + documentation

---

## Phase 701-800: ENTERPRISE (Milestone 11)

- [ ] Multi-cluster federation
- [ ] LDAP/SAML/SSO authentication
- [ ] Compliance reporting
- [ ] SLA management
- [ ] Cost allocation per department
- [ ] GPU reservation system
- [ ] Capacity planning tools
- [ ] Disaster recovery
- [ ] Geo-distributed clusters
- [ ] Enterprise support portal

---

## Phase 801-900: ADVANCED INFERENCE (Milestone 12)

- [ ] Speculative decoding
- [ ] Tensor parallelism across nodes
- [ ] Pipeline parallelism
- [ ] KV cache sharing across nodes
- [ ] Continuous batching optimization
- [ ] Custom CUDA/ROCm kernels
- [ ] INT4/INT8 quantization at inference time
- [ ] Flash attention integration
- [ ] vLLM backend support
- [ ] TensorRT-LLM backend support

---

## Phase 901-1000: POLISH & LAUNCH (Milestone 13)

- [ ] Comprehensive documentation
- [ ] Video tutorials
- [ ] Automated testing pipeline
- [ ] Performance benchmarking suite
- [ ] Security audit
- [ ] Load testing (10,000 concurrent users)
- [ ] Chaos engineering (kill nodes randomly)
- [ ] Logo and brand finalization
- [ ] Landing page
- [ ] Product Hunt launch
- [ ] Reddit/HN announcement
- [ ] Discord community setup
- [ ] GitHub Sponsors / funding
- [ ] v1.0 release

---

## Priority Order

1. **Watchdog** (Phase 1-50) — makes it production-usable
2. **Remote Shell** (Phase 51-60) — killer feature for management
3. **Notifications** (Phase 61-70) — can't run production without alerts
4. **Per-GPU Overclock** (Phase 31-40) — HiveOS core feature
5. **API Keys** (Phase 151-170) — needed to sell inference access
6. **Dashboard rewrite** (Phase 201-250) — current one is garbage
7. **ISO builder** (Phase 301-400) — makes it a real OS
8. **Everything else** — in order of user demand
