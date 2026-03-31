# TentaCLAW OS — Security Posture

> Your cluster. Your data. Your rules.

## Safe Defaults

TentaCLAW ships with security-first defaults:

- **Bind address**: Gateway binds to `0.0.0.0:8080` by default. For private clusters, set `TENTACLAW_HOST=127.0.0.1` to restrict to localhost only.
- **Authentication**: API key required for all `/api/v1/*` endpoints when `TENTACLAW_API_KEY` is set. Without it, the API is open (for development).
- **Cluster secret**: Agent-to-gateway communication requires a shared `TENTACLAW_CLUSTER_SECRET`. Without it, any device on the network can register as a node.
- **Dashboard auth**: Login page with session tokens. Sessions expire after 24 hours.
- **CORS**: Permissive by default for local development (`*`). For production, place behind a reverse proxy that restricts origins.

## What's Protected

| Component | Auth Method | Default |
|-----------|-----------|---------|
| Dashboard | Session token (login/password) | Required |
| REST API | API key (Bearer token) | Open if no key set |
| Agent -> Gateway | Cluster secret header (`X-Cluster-Secret`) | Open if no secret set |
| WebSocket shell | Session token + admin/operator role | Required |
| SSE events | None (read-only) | Open |

## Network Exposure

- The gateway listens on one port (default 8080, configurable via `TENTACLAW_PORT`)
- No outbound connections except to model registries (Ollama, HuggingFace) when pulling models
- No telemetry. No analytics. No phone-home.
- Agent uses UDP broadcast on port 41337 for auto-discovery (LAN only)

## Security Headers

All responses include production-grade security headers:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Request-ID` on every request for traceability

## Recommended Production Setup

1. Set `TENTACLAW_API_KEY` for API authentication
2. Set `TENTACLAW_CLUSTER_SECRET` for agent registration
3. Use a reverse proxy (Caddy/nginx) with TLS for external access
4. Bind gateway to localhost (`TENTACLAW_HOST=127.0.0.1`) and expose via proxy
5. Change the default admin password immediately (default: `admin` / `admin`)
6. Enable IP blocking for brute-force protection (built-in, activates on repeated auth failures)

## What We Don't Do

- **No telemetry**: We never phone home. Zero data leaves your network.
- **No model access**: We route requests to inference engines. We don't read, store, or modify your prompts or responses (unless you enable prompt caching).
- **No vendor lock-in**: MIT license. Fork it, modify it, self-host forever.
- **No cloud dependency**: Everything runs on your hardware. No external services required.

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Unauthorized API access | API key + rate limiting + IP blocking |
| Rogue node registration | Cluster secret required for agent auth |
| Man-in-the-middle | mTLS support (security module), reverse proxy with TLS |
| Prompt injection | Pass-through to inference engine; guardrails configurable |
| Brute-force login | Auto IP blocking after repeated failures (15-minute lockout) |
| Shell access abuse | Requires admin/operator role + session auth |

## Signed Releases

All releases are tagged and signed via GitHub. Verify:
```bash
git tag -v v1.0.0
```

## Reporting Security Issues

Email: security@tentaclaw.io
Or open a private security advisory on GitHub.

We acknowledge reports within 48 hours and aim to fix critical issues within 7 days.

## Audit Log

TentaCLAW maintains an audit log of:
- All authentication attempts (success + failure)
- API key creation/revocation
- Node registration/deregistration
- Cluster secret rotation
- User management changes

Access via: `GET /api/v1/audit` (admin only)
