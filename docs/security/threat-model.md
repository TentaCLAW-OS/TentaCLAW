# TentaCLAW OS — Threat Model for Shared Hardware Clusters

## 1. Threat Actors

| Actor | Capability | Motivation |
|-------|-----------|------------|
| **Malicious node operator** | Physical access to GPU node, can modify agent | Steal model weights, intercept inference data |
| **Compromised agent process** | Code execution on agent node, network access | Lateral movement, data exfiltration, DoS |
| **Network eavesdropper** | Passive network monitoring between nodes | Intercept model weights, prompts/responses |
| **Rogue API consumer** | Valid API key (possibly stolen/over-scoped) | Unauthorized model access, resource abuse |
| **Insider with cluster access** | Admin credentials, SSH to gateway | Config tampering, secret extraction |
| **Supply-chain attacker** | Compromised model weights on HuggingFace | Backdoored model producing malicious outputs |
| **Prompt injection attacker** | Craft malicious prompts via API | Extract system prompts, bypass guardrails |

## 2. Attack Surfaces

### 2.1 Agent-to-Gateway Communication
- **Risk**: Unencrypted HTTP exposes GPU stats, node IDs, cluster topology
- **Mitigation**: TLS auto-generated certs (implemented), cluster secret auth (implemented)

### 2.2 Model Weights in Transit
- **Risk**: Downloads could be intercepted or tampered
- **Mitigation**: SHA-256 hash verification, SafeTensors format (prevents code execution)

### 2.3 KV Cache Between Nodes
- **Risk**: Distributed inference KV cache contains prompt/response embeddings
- **Mitigation**: RDMA with network isolation, encrypted transfers when available

### 2.4 API Key Storage
- **Risk**: Stolen API keys grant unauthorized access
- **Mitigation**: SHA-256 hashing, scoped permissions, expiration, rate limiting

### 2.5 GPU Memory Residue
- **Risk**: GPU VRAM NOT zeroed between processes. Subsequent model could read residual data.
- **Mitigation**: cudaMemset zeroing on unload, MIG for hardware isolation, one-model-per-GPU policy

### 2.6 Prompt Injection
- **Risk**: Malicious prompts trick model into unintended behavior
- **Mitigation**: Input sanitization (implemented), output validation, defense-in-depth

## 3. STRIDE Analysis

| Threat | Category | Mitigation Status |
|--------|----------|-------------------|
| Spoofed node joins cluster | Spoofing | Cluster secret (DONE) |
| Inference data intercepted | Tampering | TLS certificates (DONE) |
| Admin denies config change | Repudiation | Audit logging (DONE) |
| GPU stats exposed to unauth users | Info Disclosure | API key auth (DONE) |
| Model loading exhausts VRAM | Denial of Service | VRAM quotas (DONE) |
| Viewer role deploys model | Elevation of Privilege | RBAC (DONE) |

## 4. Mitigation Matrix

| Control | Status |
|---------|--------|
| Authentication (API keys) | DONE — SHA-256 hashed, scoped, expiring |
| Authentication (cluster secret) | DONE — 256-bit, auto-generated, 0600 perms |
| Authorization (RBAC) | DONE — 5 built-in roles |
| Encryption in transit (TLS) | DONE — Self-signed CA, node certs |
| Rate limiting | DONE — 60/600 rpm |
| Input validation | DONE — 10MB limit, sanitization, fuzz tested |
| Audit logging | DONE — Security events with actor, IP, action |
| Secure headers | DONE — nosniff, DENY, HSTS |
| Supply chain signing | DONE — Cosign, SBOM, SLSA L3 |
| Model integrity | PARTIAL — SHA-256 on download |
| GPU memory isolation | PARTIAL — MIG support exists |
| Prompt injection defense | PARTIAL — Sanitization only |

## 5. Compliance Mapping

### NIST 800-53
| Control | NIST ID | Feature |
|---------|---------|---------|
| Access Control | AC-2/3/6 | RBAC, API keys, namespace isolation |
| Audit | AU-2/3/12 | Audit logging with timestamps |
| Auth | IA-2/5 | API keys (SHA-256), cluster secret |
| Comms Protection | SC-8/13/28 | TLS, crypto, encryption |
| Integrity | SI-3/4/7 | Input validation, model hashing |

### EU AI Act Article 15 (Cybersecurity)
| Requirement | Implementation |
|------------|----------------|
| Resilience against unauthorized access | Auth, RBAC, rate limiting |
| Protection against adversarial inputs | Validation, sanitization, fuzz testing |
| Protection against model poisoning | Hash verification, signed supply chain |
| Security event logging | Audit logging |
| Incident response | SECURITY.md, CVE process |
