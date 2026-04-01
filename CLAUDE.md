# TentaCLAW OS — Claude Context

## Project Overview
Monorepo (npm workspaces): `gateway/`, `agent/`, `cli/`, `dashboard/`, `shared/`, `mcp/`, `sdk/`, `clawhub/`, `builder/`, `deploy/`, `integrations/`, `website/`

## Build & Entry Points (CRITICAL)
- `tsconfig rootDir:".."` shifts all backend output — entry points are NOT what you'd expect:
  - Gateway: `dist/gateway/src/index.js` (NOT `dist/index.js`)
  - Agent: `dist/agent/src/index.js`
  - CLI: `dist/index.js` (exception — CLI tsconfig uses rootDir differently)
- Dashboard: Vite `outDir: "../gateway/public"` — builds directly into gateway, no cp needed
- Build commands: `npm run build --workspace=gateway|agent|cli|dashboard`

## Running Locally
- Start gateway: `cd gateway && node dist/gateway/src/index.js`
- Alt port: `TENTACLAW_PORT=8081 node dist/gateway/src/index.js`
- CLI against local: `TENTACLAW_GATEWAY=http://localhost:8080 node cli/dist/index.js <cmd>`
- Kill port 8080 on Windows: `powershell -Command "Get-NetTCPConnection -LocalPort 8080 | ForEach { Stop-Process -Id $_.OwningProcess -Force }"`

## Tests
- Run: `npm test --workspace=gateway` — 1015 tests, ~18s, vitest + in-memory SQLite
- Tests use `TENTACLAW_DB_PATH=':memory:'` — fully isolated, fresh DB per file
- Tests pass even when `tsc` fails — vitest uses `tsx`, not tsc output
- Cluster secret set to `'test-secret'` in test env

## API Response Shapes (wrapped — not bare arrays)
- `GET /api/v1/nodes` → `{ nodes: [] }`
- `GET /api/v1/benchmarks` → `{ benchmarks: [] }`
- `GET /api/v1/nodes/hot` → `{ hot_nodes: [], count: N }`
- `GET /api/v1/nodes/idle` → `{ idle_nodes: [], count: N }`
- `GET /api/v1/capacity` → uses `_mb` suffix fields (NOT `_gb`)
- `POST /v1/chat/completions` → standard OpenAI shape + `_tentaclaw` routing metadata

## Route Ordering (Hono)
- Specific routes MUST come before wildcards in the same router file
- `/api/v1/nodes/hot` and `/api/v1/nodes/idle` live in `nodes.ts` BEFORE `/api/v1/nodes/:nodeId`
- Route registration order in `index.ts`: nodeRoutes → inferenceRoutes → alertRoutes → flightSheetRoutes → modelRoutes → adminRoutes → dashboardRoutes → namespaceRoutes → miscRoutes

## TypeScript Build Rules
- `noUnusedLocals: true` + `noUnusedParameters: true` — unused imports break the build
- `experimental/` excluded from gateway tsconfig — won't compile with main build
- Build failing ≠ tests failing (they're independent)

## Database
- SQLite via `better-sqlite3`, WAL mode, foreign keys ON
- Path: `TENTACLAW_DB_PATH` env or `./data/tentaclaw.db`
- Migrations auto-apply on boot (`runMigrations()` in `gateway/src/db/init.ts`)
- Domain modules: `db/nodes.ts`, `db/models.ts`, `db/stats.ts`, `db/auth.ts`, etc.

## Auth & Secrets
- Agent auth: `X-Cluster-Secret` header — auto-generated 256-bit secret on first boot
- Disable: `TENTACLAW_NO_AUTH=true`
- API keys: SHA-256 hashed in DB, scoped (read/write/admin), rate-limited
- Master key: `TENTACLAW_API_KEY` env var bypasses DB checks

## Gateway Environment Variables
- `TENTACLAW_PORT` (8080), `TENTACLAW_HOST` (0.0.0.0)
- `TENTACLAW_DB_PATH`, `TENTACLAW_API_KEY`, `TENTACLAW_CLUSTER_SECRET`
- `TENTACLAW_NO_AUTH=true` — disable all auth
- `TENTACLAW_RATE_LIMIT`, `TENTACLAW_CHAT_RATE_LIMIT` (default: 60 rpm)

## Agent Environment Variables
- `TENTACLAW_GATEWAY_URL`, `TENTACLAW_NODE_ID`, `TENTACLAW_FARM_HASH`
- `TENTACLAW_HOSTNAME`, `TENTACLAW_INTERVAL` (default: 10000ms)
- `TENTACLAW_CLUSTER_SECRET` — must match gateway
- `TENTACLAW_MOCK=true` — fake GPU mode for dev
- Config file: `/etc/tentaclaw/rig.conf` (key=value, # comments)

## CLI Environment Variables
- `TENTACLAW_GATEWAY` — gateway URL (overrides auto-discovery)
- `TENTACLAW_API_KEY` — for authenticated requests

## Dashboard
- Zustand stores: `auth`, `cluster`, `chat`, `theme`, `panels`, `ui`, `todos`
- 8 built-in themes in `dashboard/src/lib/themes.ts` — persisted to localStorage
- Tabs: Summary, GPUs, Models, Inference, Metrics, Terminal, Chat, Alerts, Flight Sheets, Settings
- SSE: `GET /api/v1/events` — events: `node_online`, `node_offline`, `stats_update`, `alert`, etc.
- Keybinds: `g s/g/m/i/c/a/t` to switch tabs, `Ctrl+B` left sidebar, `Ctrl+J` right panel, `Ctrl+K` command palette
- Sequential keybind timeout: 800ms between keypresses

## Shared Types
- Location: `shared/types.ts`
- Key: `StatsPayload`, `GatewayCommand`, `GatewayResponse`, `NodeWithStats`, `FlightSheet`, `Alert`, `BackendInfo`
- `CommandAction`: `reload_model | install_model | remove_model | overclock | benchmark | restart_agent | reboot | quantize_model`

## Node Naming Convention
- Proxmox nodes are called **Octopods**: Octopod-1, Octopod-2, etc. ("pod" for short)
- pve hostname prefix → Octopod display name

## website/install Sync
- `tentaclaw.io/install` → GitHub Pages serves `website/install`
- Always sync after changing `install.sh`: `cp install.sh website/install`
- Commit both files together

## Install Script Flow
1. OS detect (Debian/Ubuntu or RHEL) 2. Node.js ≥20 (auto-installs via NodeSource) 3. git 4. Clone/update `/opt/tentaclaw` 5. `npm install` from root 6. `npm run build --workspace=gateway` 7. `npm run build --workspace=dashboard` 8. systemd service with `ExecStart: node dist/gateway/src/index.js`, `WorkingDirectory: /opt/tentaclaw/gateway`

## Known Gotchas
- `sseClients` array in `shared.ts` is in-memory — restart clears all SSE connections
- Model aliases resolve at request time with fallback chain
- Fleet health grade: A≥90, B≥80, C≥70, D≥60, F<60
- VRAM estimates in DB are hardcoded approximations for routing only
- WebSocket shell: agent uses `X-Cluster-Secret`, dashboard uses session/API key
- Command palette easter eggs: `/who`, `/party`, `/meaning`
- Agent auto-discovery: UDP broadcast port 41338, then subnet scan (slow, ~5s)
