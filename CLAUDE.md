# TentaCLAW OS — Claude Context

## Build & Entry Points
- Gateway entry point: `dist/gateway/src/index.js` (NOT `dist/index.js`) — tsconfig `rootDir:".."` shifts output path
- CLI entry point: `dist/cli/src/index.js` (same reason)
- Agent entry point: `dist/agent/src/index.js`
- Dashboard: Vite `outDir: "../gateway/public"` — builds directly there, no cp needed

## Running Things Locally
- Kill port 8080 on Windows: `powershell -Command "Get-NetTCPConnection -LocalPort 8080 | Select OwningProcess | ForEach { Stop-Process -Id $_.OwningProcess -Force }"`
- Start gateway for testing: `cd gateway && node dist/gateway/src/index.js`
- Start gateway on alt port: `TENTACLAW_PORT=8081 node dist/gateway/src/index.js`
- Run CLI against local gateway: `TENTACLAW_GATEWAY=http://localhost:8080 node cli/dist/cli/src/index.js <cmd>`

## Tests
- Run all: `npm test --workspace=gateway` — 1015 tests, ~18s, vitest with in-memory SQLite
- Tests pass even when `npm run build --workspace=gateway` fails (vitest uses tsx, not tsc output)

## API Shape Gotchas
- `GET /api/v1/nodes` returns `{ nodes: [] }` not a bare array
- `GET /api/v1/benchmarks` returns `{ benchmarks: [] }` not a bare array
- `GET /api/v1/capacity` uses `_mb` suffix fields, not `_gb`
- `GET /api/v1/nodes/hot` returns `{ hot_nodes: [], count: N }`
- `GET /api/v1/nodes/idle` returns `{ idle_nodes: [], count: N }`

## Route Ordering
- Specific routes (`/api/v1/nodes/hot`) must be registered BEFORE wildcard (`/api/v1/nodes/:nodeId`) in the same router
- `nodes/hot` and `nodes/idle` live in `gateway/src/routes/nodes.ts` for this reason

## TypeScript Build
- `noUnusedLocals: true` — removing imports from route files will break the build
- `experimental/` is excluded from tsconfig — files there don't compile with the main build
- Build fails ≠ tests fail (vitest is independent of tsc)

## Node Naming
- Proxmox nodes are called Octopods: Octopod-1, Octopod-2 etc. ("pod" for short)
- pve hostname prefix maps to Octopod names in display

## website/install
- Always keep in sync with root `install.sh`: `cp install.sh website/install`
- GitHub Pages deploys `website/` dir — `tentaclaw.io/install` serves `website/install`
