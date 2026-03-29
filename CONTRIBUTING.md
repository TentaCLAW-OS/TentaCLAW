# Contributing to TentaCLAW OS

Thanks for wanting to help! CLAWtopus appreciates every contribution.

## Quick Start for Contributors

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git
cd TentaCLAW
cd gateway && npm install
cd ../agent && npm install
cd ../cli && npm install

# Start gateway
cd ../gateway && npm run dev

# Start mock agent (no GPUs needed)
cd ../agent && npx tsx src/index.ts --mock

# Open dashboard
open http://localhost:8080/dashboard/
```

## What to Work On

- Issues labeled `good-first-issue` are great starting points
- Check the [MASTER-TentaCLAW-PLAN-v2.md](MASTER-TentaCLAW-PLAN-v2.md) for the roadmap
- Bug reports and feature requests welcome

## Code Style

- TypeScript for all source code
- Zero runtime dependencies in agent and CLI
- Tests in `tests/` directories using Vitest
- Commit messages: `feat:`, `fix:`, `docs:`, `refactor:`

## Architecture

```
gateway/   — Hono + SQLite API server + web dashboard
agent/     — Node daemon running on each GPU machine
cli/       — CLAWtopus CLI tool
shared/    — Shared TypeScript types
scripts/   — Installer and utility scripts
website/   — tentaclaw.io landing page
```

## Testing

```bash
cd gateway && npx vitest run    # Gateway tests
cd agent && npx vitest run      # Agent tests
cd cli && npx tsc --noEmit      # CLI type check
```

## License

MIT — see [LICENSE](LICENSE)
