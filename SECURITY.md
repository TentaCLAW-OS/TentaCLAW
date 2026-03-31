# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in TentaCLAW OS, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

### Reporting Process

1. **Email**: Send details to **security@tentaclaw.io**
2. **PGP**: Encrypt sensitive reports with our PGP key (available at `keys.tentaclaw.io`)
3. **GitHub**: Use [GitHub Security Advisories](https://github.com/TentaCLAW-OS/TentaCLAW/security/advisories/new) for private disclosure

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact
- Suggested fix (if any)

### Response Timeline

| Stage | SLA |
|-------|-----|
| Acknowledgment | **7 days** |
| Triage and severity assessment | **14 days** |
| Fix development | **90 days** (P0: 24 hours) |
| Coordinated disclosure | After fix is released |

### Severity Classification

| Level | Description | Response |
|-------|-------------|----------|
| **P0 (Critical)** | RCE, auth bypass, data exfiltration | Patch within 24 hours |
| **P1 (High)** | Privilege escalation, SSRF, SQLi | Patch within 7 days |
| **P2 (Medium)** | XSS, CSRF, information disclosure | Patch within 30 days |
| **P3 (Low)** | Minor info leak, best-practice violation | Patch within 90 days |

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Previous minor | Security fixes only |
| Older versions | No |

## Security Measures

TentaCLAW OS ships with security enabled by default. See [Safe Defaults](docs/security/safe-defaults.md).

### Supply Chain Security

- All release artifacts include SHA-256 checksums
- Container images are signed with [Sigstore cosign](https://www.sigstore.dev/) (keyless)
- SBOM (Software Bill of Materials) attached to every release (CycloneDX format)
- Dependencies scanned weekly via Dependabot
- CI pipeline runs Trivy, Semgrep, and npm audit on every PR

### Runtime Security

- Authentication enabled by default (API keys with SHA-256 hashing)
- Rate limiting: 60 req/min unauthenticated, 600 req/min authenticated
- Cluster secret auto-generated (256-bit) with `0600` file permissions
- Secure HTTP headers on all responses
- Input validation and payload size limiting (10 MB)
- TLS certificate auto-generation for inter-node communication

## Disclosure Policy

We follow a **90-day coordinated disclosure** policy:

1. Reporter submits vulnerability privately
2. We acknowledge within 7 days
3. We develop and test a fix within 90 days
4. We release the fix and publish a security advisory
5. Reporter credited in the advisory (unless they prefer anonymity)

## Bug Bounty

We plan to launch a bug bounty program on HackerOne after v1.0 launch.

| Severity | Reward Range |
|----------|-------------|
| Critical | $1,000 - $5,000 |
| High | $500 - $1,000 |
| Medium | $100 - $500 |
| Low | $50 - $100 |

## Contact

- **Security reports**: security@tentaclaw.io
- **General questions**: GitHub Discussions
- **Community**: Discord ([invite link](https://discord.gg/tentaclaw))
