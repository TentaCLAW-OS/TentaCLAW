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
- Check the [Roadmap](docs/ROADMAP-v1.0.md) for what's planned
- Bug reports and feature requests welcome

## Code Style

- TypeScript for all source code
- Zero runtime dependencies in agent and CLI
- Tests in `tests/` directories using Vitest
- Commit messages: `feat:`, `fix:`, `docs:`, `refactor:`

## TypeScript Strict Mode

All packages use TypeScript strict mode. Before submitting a PR, make sure your code passes type checking with no errors:

```bash
# Type check all packages
cd gateway && npx tsc --noEmit
cd ../agent && npx tsc --noEmit
cd ../cli && npx tsc --noEmit
```

Key rules:
- No `any` types -- use `unknown` and narrow with type guards
- No unused imports or variables
- All function parameters and return types should be explicitly typed
- Strict null checks are enabled -- handle `null` and `undefined` explicitly

## Running Tests

```bash
# Run gateway tests
cd gateway && npm test

# Run agent tests
cd agent && npm test

# Run all tests from the root (if configured)
npm test

# Run tests in watch mode during development
cd gateway && npx vitest
cd agent && npx vitest

# Type check the CLI (no test suite yet)
cd cli && npx tsc --noEmit
```

All PRs must pass the existing test suite. New features should include tests.

## Architecture

```
gateway/       -- Hono + SQLite API server + web dashboard
agent/         -- Node daemon running on each GPU machine
cli/           -- CLAWtopus CLI tool (86 commands)
shared/        -- Shared TypeScript types and utilities
mcp/           -- Model Context Protocol server
sdk/           -- TypeScript SDK for programmatic access
clawhub/       -- Package marketplace (185 packages)
builder/       -- ISO/PXE build system
observability/ -- Prometheus + Grafana stack
deploy/        -- Helm, Terraform, Ansible, Kubernetes manifests
integrations/  -- First-party integrations (Dify, n8n, Home Assistant, etc.)
website/       -- tentaclaw.io landing page
scripts/       -- Installer and utility scripts
```

## Documentation

Full documentation lives in the [`docs/`](docs/) directory:

- [Getting Started](docs/GETTING-STARTED.md)
- [API Reference](docs/API.md)
- [CLI Reference](docs/CLI.md)
- [FAQ](docs/FAQ.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

MIT -- see [LICENSE](LICENSE)
