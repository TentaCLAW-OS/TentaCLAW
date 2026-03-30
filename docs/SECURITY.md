# Security Guide

TentaCLAW OS takes security seriously. This guide covers authentication, authorization, and hardening.

## Authentication

### API Keys (Default)

Set `TENTACLAW_API_KEY` environment variable to require authentication:

```bash
export TENTACLAW_API_KEY=your-secret-key
cd gateway && npm run dev
```

All `/api/*` and `/v1/*` endpoints will require a `Bearer` token:

```bash
curl -H "Authorization: Bearer your-secret-key" http://localhost:8080/api/v1/nodes
```

### Scoped API Keys

Create keys with specific permissions:

```bash
# Create read-only key
clawtopus apikey create --name "monitoring" --permissions read

# Create inference-only key
clawtopus apikey create --name "app-backend" --permissions read,write

# Create admin key
clawtopus apikey create --name "admin" --permissions read,write,admin
```

**Permission levels:**
- `read` — GET requests (view nodes, models, stats)
- `write` — POST/PUT/DELETE (deploy models, send commands)
- `admin` — User management, key management, cluster config

### Key Expiry

Keys can have an expiration date:
```bash
clawtopus apikey create --name "temp" --expires "2025-12-31"
```

### User Authentication

For multi-user setups, TentaCLAW supports username/password auth:

```bash
# Login
curl -X POST http://localhost:8080/api/v1/auth/login \
  -d '{"username":"admin","password":"admin"}'
# Returns: { "token": "...", "user": { ... } }
```

Default admin credentials: `admin` / `admin` — **change immediately**.

## Network Security

### TLS/HTTPS

For production, put TentaCLAW behind a reverse proxy with TLS:

```nginx
server {
    listen 443 ssl;
    server_name tentaclaw.example.com;
    ssl_certificate /etc/ssl/certs/tentaclaw.pem;
    ssl_certificate_key /etc/ssl/private/tentaclaw.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

### Firewall

Only expose necessary ports:
```bash
# Gateway only needs 8080
sudo ufw allow 8080/tcp
sudo ufw deny 11434/tcp  # Keep Ollama internal
```

### Agent ↔ Gateway Communication

Agents push stats to the gateway via HTTP POST. In production:
- Use HTTPS between agents and gateway
- Set API keys on both sides
- Use a VPN or private network

## Webhook Security

Webhooks support HMAC signing:

```bash
curl -X POST http://localhost:8080/api/v1/webhooks \
  -d '{"url":"https://your-server.com/hook","secret":"your-hmac-secret"}'
```

Verify webhook signatures by computing `SHA-256(secret + payload)` and comparing with the `X-TentaCLAW-Signature` header.

## Best Practices

1. **Change default admin password** immediately
2. **Use API keys** in production — never run open
3. **Put behind reverse proxy** with TLS for internet-facing deployments
4. **Restrict network access** — agents should only reach the gateway
5. **Rotate API keys** periodically
6. **Monitor audit logs** via `/api/v1/events`

---

*CLAWtopus says: "Eight arms to protect your cluster. Zero arms for attackers."*
