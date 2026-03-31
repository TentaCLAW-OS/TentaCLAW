# TentaCLAW OS — Incident Response Playbook

## Severity Classification

| Level | Description | Response Time | Fix Window |
|-------|-------------|--------------|------------|
| **P0 (Critical)** | RCE, auth bypass, data exfiltration | Immediate | 24 hours |
| **P1 (High)** | Privilege escalation, SSRF, injection | 4 hours | 7 days |
| **P2 (Medium)** | XSS, CSRF, info disclosure | 1 business day | 30 days |
| **P3 (Low)** | Minor info leak, best-practice gap | 3 business days | 90 days |

## Incident Response Flow

### 1. Detection
- Security researcher report via security@tentaclaw.io
- Automated scanning (Trivy, Semgrep, npm audit) in CI
- Community report via GitHub Security Advisory
- Runtime monitoring alerts

### 2. Triage (Within SLA)
- Assign severity (P0-P3)
- Identify affected versions
- Determine blast radius (which components, which users)
- Create private GitHub Security Advisory (draft)

### 3. Containment
- For P0: Issue emergency advisory within 1 hour
- Identify short-term mitigation (config change, WAF rule, feature flag)
- Communicate mitigation to affected users via Discord #security

### 4. Fix
- Develop fix in private branch (linked to Security Advisory)
- Write regression test that would have caught the issue
- Code review by second maintainer
- Test on staging cluster

### 5. Release
- For P0/P1: Skip normal release cycle, create hotfix release
- Tag release with security notes
- Update GitHub Security Advisory with CVE, affected versions, fix version
- Publish advisory

### 6. Post-Mortem
- Within 7 days of fix release
- Document: timeline, root cause, fix, lessons learned
- Update threat model if needed
- Add to SECURITY-AUDIT.md

## Security Release Template

```markdown
## Security Release: TentaCLAW OS vX.Y.Z

### Affected Versions
- vA.B.C through vX.Y.W

### Severity
P0 (Critical) / P1 (High) / P2 (Medium) / P3 (Low)

### CVE
CVE-YYYY-XXXXX

### Description
[Brief description of the vulnerability without exploitation details]

### Impact
[Who is affected and what could happen]

### Mitigation
[Upgrade to vX.Y.Z or apply workaround]

### Workaround
[If upgrade is not immediately possible]

### Credit
[Reporter name, if they consent to being credited]

### Timeline
- YYYY-MM-DD: Reported
- YYYY-MM-DD: Triaged
- YYYY-MM-DD: Fix developed
- YYYY-MM-DD: Fix released
```

## CI Security Scanning

Every PR runs:
1. `npm audit` — known vulnerability check
2. `trivy image` — container image scan (HIGH/CRITICAL block merge)
3. `semgrep` — SAST with TentaCLAW-specific rules
4. Dependency license check — reject AGPL/GPL in core

Nightly:
5. Full security regression suite
6. OWASP ZAP dynamic scan (when available)
