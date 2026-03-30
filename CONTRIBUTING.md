# Contributing to TentaCLAW OS

Thanks for wanting to help! CLAWtopus appreciates every contribution.

## Table of Contents

- [Development Setup](#development-setup)
- [Running the Dev Stack](#running-the-dev-stack)
- [What to Work On](#what-to-work-on)
- [Code Style](#code-style)
- [TypeScript Strict Mode](#typescript-strict-mode)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Pull Request Process](#pull-request-process)
- [Architecture](#architecture)
- [Documentation](#documentation)
- [License](#license)

---

## Development Setup

### Prerequisites

- **Node.js** v20+ ([nodejs.org](https://nodejs.org))
- **npm** v9+ (comes with Node.js)
- **Git** ([git-scm.com](https://git-scm.com))

No GPU is required for development. The mock agent simulates realistic hardware.

### Clone and Install

```bash
git clone https://github.com/TentaCLAW-OS/TentaCLAW.git
cd TentaCLAW

# Install all dependencies
cd gateway && npm install && cd ..
cd agent && npm install && cd ..
cd cli && npm install && cd ..

# Or use the Makefile:
make node-deps

# Or use the setup script:
bash setup.sh --deps-only
```

### Build

```bash
# Build all packages
make all

# Or individually:
cd gateway && npm run build
cd agent && npm run build
cd cli && npm run build
```

---

## Running the Dev Stack

You need **two or three terminals** for development.

### Terminal 1: Gateway (with hot reload)

```bash
cd gateway && npm run dev
# or: make gateway-dev
```

The gateway starts on **http://localhost:8080** with the dashboard at **/dashboard**.

### Terminal 2: Mock Agent

```bash
cd agent && npx tsx src/index.ts --mock
# or: make agent-mock
```

This starts a mock agent with 2 simulated GPUs that auto-registers with the gateway.

### Terminal 3: Second Mock Agent (optional)

```bash
cd agent && npx tsx src/index.ts --mock --name gpu-rig-02 --gpus 4
# or: make agent-mock-2
```

### Multi-Node Testing

```bash
# Spawn 4 mock nodes at once
make swarm NODES=4

# Or spawn 8:
cd agent && npx tsx src/spawner.ts --nodes 8 --gateway http://localhost:8080
```

### Docker Development

```bash
make docker-build   # Build images
make docker-up      # Start gateway + mock agent
make docker-logs    # Follow logs
make docker-down    # Stop everything
```

### Quick Reference

```bash
make dev             # Show dev stack instructions
make gateway-dev     # Run gateway with hot reload
make agent-mock      # Run mock agent
make agent-mock-2    # Run second mock agent
make swarm           # Spawn 4 mock nodes
make test            # Run all tests
make typecheck       # Type check all packages
make lint            # Lint all packages
make format          # Format all files with Prettier
```

---

## What to Work On

- Issues labeled `good-first-issue` are great starting points
- Check the [Roadmap](docs/ROADMAP-v1.0.md) for what's planned
- Bug reports and feature requests are welcome
- Documentation improvements are always appreciated

---

## Code Style

### General Rules

- **TypeScript** for all source code
- **Zero runtime dependencies** in agent and CLI (gateway uses Hono + better-sqlite3)
- No `console.log` in library code -- use the `log()` function in the gateway
- Prefer `const` over `let`, never use `var`
- Use template literals for string interpolation
- Single quotes for strings
- No semicolons (unless required for ASI edge cases)

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add GPU temperature alerts
fix: correct VRAM calculation for multi-GPU nodes
docs: update API reference with new endpoints
refactor: extract model routing into separate module
test: add benchmark API integration tests
chore: update dependencies
```

### Formatting

The project uses Prettier for consistent formatting:

```bash
# Format all TypeScript files
make format

# Or directly:
npx prettier --write "**/*.ts" --ignore-path .gitignore
```

### Linting

```bash
# Lint all packages
make lint

# Or individually:
cd gateway && npx eslint src/ --ext .ts
cd agent && npx eslint src/ --ext .ts
cd cli && npx eslint src/ --ext .ts
```

---

## TypeScript Strict Mode

All packages use TypeScript strict mode. Before submitting a PR, make sure your code passes type checking with no errors:

```bash
# Type check all packages
make typecheck

# Or individually:
cd gateway && npx tsc --noEmit
cd agent && npx tsc --noEmit
cd cli && npx tsc --noEmit
```

Key rules:

- No `any` types -- use `unknown` and narrow with type guards
- No unused imports or variables
- All function parameters and return types should be explicitly typed
- Strict null checks are enabled -- handle `null` and `undefined` explicitly
- Use `as const` for literal types where appropriate

---

## Running Tests

```bash
# Run all tests
make test

# Run gateway tests
cd gateway && npm test

# Run agent tests
cd agent && npm test

# Run tests in watch mode (during development)
cd gateway && npx vitest
cd agent && npx vitest

# Run a specific test file
cd gateway && npx vitest run tests/api.test.ts

# Type check the CLI (no test suite yet)
cd cli && npx tsc --noEmit
```

All tests use [Vitest](https://vitest.dev/). Tests run against an in-memory SQLite database and do not require a running gateway or agent.

---

## Writing Tests

### Test Location

Tests live in `tests/` directories alongside the source code:

```
gateway/tests/     -- Gateway API and unit tests
agent/tests/       -- Agent unit tests
```

### Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('Feature Name', () => {
  beforeEach(() => {
    // Reset state before each test
  });

  it('should do the expected thing', () => {
    // Arrange
    const input = { model: 'llama3.1:8b' };

    // Act
    const result = someFunction(input);

    // Assert
    expect(result.status).toBe('ok');
  });
});
```

### Guidelines

- Every new feature should include tests
- Test the happy path and at least one error case
- Test API endpoints with the Hono test client (no HTTP server needed)
- Keep tests fast -- no `setTimeout`, no network calls
- Use descriptive test names that explain the expected behavior

---

## Pull Request Process

### Before Submitting

1. **Branch**: Create a feature branch from `master` (`git checkout -b feat/my-feature`)
2. **Code**: Make your changes following the code style guidelines
3. **Type check**: Run `make typecheck` -- all packages must pass
4. **Test**: Run `make test` -- all tests must pass
5. **Format**: Run `make format` to ensure consistent formatting
6. **Commit**: Use conventional commit messages

### PR Guidelines

- Keep PRs focused -- one feature or fix per PR
- Include a clear description of what changed and why
- Add tests for new functionality
- Update documentation if the public API changes
- Link to any related issues

### Review Process

1. CI checks must pass (type checking + tests)
2. At least one maintainer review is required
3. Address review feedback with additional commits (don't force-push)
4. Maintainer merges when approved

---

## Architecture

For a detailed architecture overview, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Quick Summary

```
gateway/       -- Hono + SQLite API server + web dashboard (6,100+ lines, 200+ endpoints)
agent/         -- Node daemon running on each GPU machine
cli/           -- CLAWtopus CLI tool (86+ commands)
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

Key files to understand:

| File | Lines | What It Does |
|------|-------|-------------|
| `gateway/src/index.ts` | 6,100+ | All route handlers, SSE, WebSocket, inference proxy |
| `gateway/src/db.ts` | ~2,000 | SQLite schema, migrations, all data access |
| `gateway/src/namespaces.ts` | ~500 | Multi-tenancy, quotas, usage tracking |
| `agent/src/index.ts` | ~1,000 | GPU detection, stats collection, command execution |
| `shared/types.ts` | ~200 | Shared TypeScript interfaces |

---

## Documentation

Full documentation lives in the [`docs/`](docs/) directory:

- [Getting Started](docs/GETTING-STARTED.md) -- Quick start tutorial
- [API Reference](docs/API.md) -- Full endpoint documentation (200+ endpoints)
- [Architecture](docs/ARCHITECTURE.md) -- System design and internals
- [Deployment Guide](docs/DEPLOYMENT.md) -- Installation, Docker, production setup
- [CLI Reference](docs/CLI.md) -- CLAWtopus command reference
- [FAQ](docs/FAQ.md) -- Frequently asked questions
- [Troubleshooting](docs/TROUBLESHOOTING.md) -- Common issues and fixes

When adding or modifying API endpoints, update `docs/API.md` accordingly.

---

## License

MIT -- see [LICENSE](LICENSE)
