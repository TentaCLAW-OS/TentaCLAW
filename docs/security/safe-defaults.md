# TentaCLAW OS — Safe Defaults

Every TentaCLAW installation ships with security enabled by default. No configuration required for a safe single-node setup.

## Default Security Configuration

| Setting | Default | Override |
|---------|---------|----------|
| **Bind address** | `127.0.0.1` (localhost only) | `--bind 0.0.0.0` or `TENTACLAW_HOST=0.0.0.0` |
| **Authentication** | Enabled (API keys required) | `--no-auth` or `TENTACLAW_NO_AUTH=true` |
| **Cluster secret** | Auto-generated 256-bit on first boot | `TENTACLAW_CLUSTER_SECRET=<hex>` |
| **Rate limiting (unauth)** | 60 requests/minute | `TENTACLAW_RATE_LIMIT=N` (0 to disable) |
| **Rate limiting (auth)** | 600 requests/minute | `TENTACLAW_RATE_LIMIT_AUTH=N` |
| **Max body size** | 10 MB | `TENTACLAW_MAX_BODY_MB=N` |
| **Log level** | `info` (debug suppressed) | `TENTACLAW_LOG_LEVEL=debug` |
| **TLS certificates** | Auto-generated self-signed CA | Custom CA via security module |
| **API key storage** | SHA-256 hashed (never plaintext) | N/A |
| **Cluster key file** | `~/.tentaclaw/cluster.key` mode `0600` | N/A |
| **Secure headers** | All enabled (nosniff, DENY, HSTS) | N/A |

## Cluster Mode

When running in cluster mode (multiple nodes), you must explicitly bind to all interfaces:

```bash
# Single-node (default — safe)
tentaclaw start

# Cluster mode — bind to all interfaces
tentaclaw start --bind 0.0.0.0
```

A warning is printed when binding to `0.0.0.0`. Ensure:
1. Authentication is enabled (default)
2. Firewall rules restrict access to trusted networks
3. Cluster secret is distributed to all agents

## Security Checklist

On every startup, TentaCLAW prints a security checklist:

- **Authentication**: Enabled/Disabled
- **Cluster secret**: Configured/Not set
- **Bind address**: localhost/all interfaces
- **Rate limiting**: Requests per minute
- **Firewall reminder**: Ports 8080, 41337
- **Update reminder**: Check for new versions

## File Permissions

TentaCLAW checks permissions on sensitive files at startup:

- `~/.tentaclaw/cluster.key` — must be `0600` (owner read/write only)
- World-readable cluster key files are rejected with an error
- Group-readable files generate a warning

## API Key Security

- Keys are prefixed with `tc_` for easy identification
- Only the SHA-256 hash is stored in the database
- Full key is shown only once at creation time
- Keys support scoping: read, write, admin permissions
- Keys support expiration dates
- Keys support per-key rate limits

## Overriding Defaults

All security settings can be customized via environment variables or CLI flags.
Disabling security features always prints a warning to stderr.

### Disable Authentication (NOT recommended)

```bash
tentaclaw start --no-auth
# WARNING: Authentication is DISABLED (--no-auth). API is open to all.
```

### Disable Rate Limiting

```bash
TENTACLAW_RATE_LIMIT=0 tentaclaw start
```

### Custom Cluster Secret

```bash
TENTACLAW_CLUSTER_SECRET=your-256-bit-hex-secret tentaclaw start
```

## Input Validation

- All API payloads are limited to 10 MB (configurable)
- String inputs are sanitized: control characters stripped, HTML entities escaped
- All endpoints validate JSON schema compliance
- Fuzz tested with 500+ randomized payloads per endpoint
