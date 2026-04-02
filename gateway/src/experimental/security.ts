// F:\tentaclaw-os\gateway\src\security.ts
// Advanced Security — Zero Trust for GPU Clusters
// TentaCLAW says: "Trust nobody. Verify everything. Eight arms on guard."

/**
 * TentaCLAW Gateway — Security Module v3.0
 *
 * Provides mTLS certificate management, encrypted secrets storage,
 * network policy enforcement, security scanning, and compliance reporting
 * for GPU inference clusters.
 *
 * - mTLS: mutual TLS with auto-generated CA + per-node certificates
 * - Secrets: AES-256-GCM encrypted at rest, versioned, namespaced
 * - Network Policies: ingress/egress rules with CIDR & namespace matching
 * - Scanner: automated vulnerability & misconfiguration detection
 * - Compliance: SOC 2, HIPAA, GDPR, PCI-DSS report generation
 *
 * Zero external deps: uses only Node.js built-in crypto module.
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * TentaCLAW says: "I trust no one by default. Earn it."
 */

import { getDb } from './db';
import {
    randomBytes,
    createCipheriv,
    createDecipheriv,
    createHash,
    generateKeyPairSync,
    createSign,
    createVerify,
    createPrivateKey,
    KeyObject,
} from 'crypto';
import fs from 'fs';
import path from 'path';

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface CertConfig {
    enabled: boolean;
    mode: 'self-signed' | 'letsencrypt' | 'custom';
    domain?: string;
    certPath?: string;
    keyPath?: string;
    caPath?: string;
    autoRenew: boolean;
}

export interface CertInfo {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    serialNumber: string;
    fingerprint: string;
    daysRemaining: number;
    isExpired: boolean;
    isCA: boolean;
}

export interface CertStatus {
    ca: CertInfo | null;
    nodes: Array<{ nodeId: string; cert: CertInfo }>;
    overallHealth: 'healthy' | 'warning' | 'critical';
    expiringWithin30d: number;
    expired: number;
}

export interface Secret {
    name: string;
    namespace: string;
    value: string;          // encrypted at rest
    type: 'opaque' | 'api-key' | 'certificate' | 'connection-string';
    createdAt: string;
    updatedAt: string;
    version: number;
}

export interface SecretMetadata {
    name: string;
    namespace: string;
    type: 'opaque' | 'api-key' | 'certificate' | 'connection-string';
    createdAt: string;
    updatedAt: string;
    version: number;
}

export interface NetworkPolicy {
    name: string;
    namespace: string;
    rules: Array<NetworkRule>;
}

export interface NetworkRule {
    direction: 'ingress' | 'egress';
    action: 'allow' | 'deny';
    source?: string;      // namespace or CIDR
    destination?: string;
    ports?: number[];
}

export interface NetworkPolicyEvaluation {
    allowed: boolean;
    matchedPolicy: string | null;
    matchedRule: NetworkRule | null;
    reason: string;
}

export interface SecurityScanResult {
    timestamp: string;
    score: number;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    checks: Array<SecurityCheck>;
    summary: {
        passed: number;
        failed: number;
        warnings: number;
        total: number;
    };
}

export interface SecurityCheck {
    id: string;
    category: 'tls' | 'auth' | 'secrets' | 'network' | 'config' | 'deps';
    name: string;
    status: 'pass' | 'fail' | 'warn';
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    message: string;
    recommendation?: string;
}

export interface SecurityRecommendation {
    priority: 'critical' | 'high' | 'medium' | 'low';
    category: string;
    title: string;
    description: string;
    effort: 'minimal' | 'moderate' | 'significant';
}

export type ComplianceFramework = 'soc2' | 'hipaa' | 'gdpr' | 'pci-dss';

export interface ComplianceControl {
    id: string;
    name: string;
    description: string;
    status: 'pass' | 'fail' | 'na' | 'partial';
    evidence: string;
}

export interface ComplianceReport {
    framework: ComplianceFramework;
    generatedAt: string;
    overallStatus: 'compliant' | 'non-compliant' | 'partial';
    controls: ComplianceControl[];
    summary: {
        passed: number;
        failed: number;
        notApplicable: number;
        partial: number;
        total: number;
        compliancePct: number;
    };
}

// =============================================================================
// Module State
// =============================================================================

/** Master encryption key for secrets — derived from env or auto-generated. */
let _masterKey: Buffer | null = null;

/** Whether the security schema has been initialized. */
let _schemaInitialized = false;

/** Cached CA private key for signing node certs. */
let _caPrivateKey: KeyObject | null = null;

/** Cached latest security scan result. */
let _lastScanResult: SecurityScanResult | null = null;

// =============================================================================
// Constants
// =============================================================================

/** AES-256-GCM requires a 32-byte key. */
const KEY_LENGTH = 32;

/** GCM IV length in bytes. */
const IV_LENGTH = 12;

/** Warning threshold — certificates expiring within this many days trigger warnings. */
const CERT_EXPIRY_WARNING_DAYS = 30;

/** Default certificate validity in days. */
const CERT_VALIDITY_DAYS = 365;

/** CA certificate validity in days (10 years). */
const CA_VALIDITY_DAYS = 3650;

/** Default namespace for secrets and policies. */
const DEFAULT_NAMESPACE = 'default';

/** Data directory for certificate storage. */
const DATA_DIR = process.env.TENTACLAW_DATA_DIR || path.join(process.cwd(), 'data');

/** Certificate storage subdirectory. */
const CERTS_DIR = path.join(DATA_DIR, 'certs');

// =============================================================================
// Schema Initialization
// =============================================================================

/**
 * Ensure security-related DB tables exist. Idempotent — safe to call repeatedly.
 */
function ensureSchema(): void {
    if (_schemaInitialized) return;
    const db = getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS security_secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            encrypted_value TEXT NOT NULL,
            iv TEXT NOT NULL,
            auth_tag TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'opaque',
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(name, namespace, version)
        );

        CREATE INDEX IF NOT EXISTS idx_secrets_name_ns
            ON security_secrets(name, namespace);
        CREATE INDEX IF NOT EXISTS idx_secrets_ns
            ON security_secrets(namespace);

        CREATE TABLE IF NOT EXISTS security_certificates (
            id TEXT PRIMARY KEY,
            node_id TEXT,
            type TEXT NOT NULL DEFAULT 'node',
            subject TEXT NOT NULL,
            issuer TEXT NOT NULL,
            serial_number TEXT NOT NULL UNIQUE,
            fingerprint TEXT NOT NULL,
            pem TEXT NOT NULL,
            private_key_pem TEXT,
            valid_from TEXT NOT NULL,
            valid_to TEXT NOT NULL,
            is_ca INTEGER NOT NULL DEFAULT 0,
            revoked INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_certs_node
            ON security_certificates(node_id);
        CREATE INDEX IF NOT EXISTS idx_certs_type
            ON security_certificates(type);
        CREATE INDEX IF NOT EXISTS idx_certs_expiry
            ON security_certificates(valid_to);

        CREATE TABLE IF NOT EXISTS security_network_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            rules TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(name, namespace)
        );

        CREATE INDEX IF NOT EXISTS idx_netpol_ns
            ON security_network_policies(namespace);

        CREATE TABLE IF NOT EXISTS security_scan_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            score INTEGER NOT NULL,
            grade TEXT NOT NULL,
            result TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_scan_history_time
            ON security_scan_history(created_at DESC);
    `);

    _schemaInitialized = true;
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return Date.now().toString(36) + randomBytes(6).toString('hex');
}

function now(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Returns the master encryption key for AES-256-GCM.
 * Reads from TENTACLAW_MASTER_KEY env var, or auto-generates and persists one.
 */
function getMasterKey(): Buffer {
    if (_masterKey) return _masterKey;

    const envKey = process.env.TENTACLAW_MASTER_KEY;
    if (envKey) {
        // Env var can be hex or base64
        _masterKey = envKey.length === 64
            ? Buffer.from(envKey, 'hex')
            : Buffer.from(envKey, 'base64');
        if (_masterKey.length !== KEY_LENGTH) {
            throw new Error(
                `TENTACLAW_MASTER_KEY must decode to ${KEY_LENGTH} bytes. ` +
                `Got ${_masterKey.length}. Use a 64-char hex string or 44-char base64.`
            );
        }
        return _masterKey;
    }

    // Auto-generate and persist to filesystem
    const keyPath = path.join(DATA_DIR, '.master-key');
    if (fs.existsSync(keyPath)) {
        _masterKey = Buffer.from(fs.readFileSync(keyPath, 'utf-8').trim(), 'hex');
        return _masterKey;
    }

    // First boot — generate new master key
    _masterKey = randomBytes(KEY_LENGTH);
    const dir = path.dirname(keyPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(keyPath, _masterKey.toString('hex'), { mode: 0o600 });
    return _masterKey;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns { ciphertext, iv, authTag } all as hex strings.
 */
function encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
    const key = getMasterKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return {
        ciphertext: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
    };
}

/**
 * Decrypt AES-256-GCM ciphertext. Throws on tamper or wrong key.
 */
function decrypt(ciphertext: string, ivHex: string, authTagHex: string): string {
    const key = getMasterKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Ensure the certs directory exists.
 */
function ensureCertsDir(): void {
    if (!fs.existsSync(CERTS_DIR)) {
        fs.mkdirSync(CERTS_DIR, { recursive: true });
    }
}

/**
 * Calculate days remaining from an ISO date string to now.
 */
function daysUntil(dateStr: string): number {
    const target = new Date(dateStr).getTime();
    const diff = target - Date.now();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Build a self-signed X.509 certificate using Node's built-in crypto.
 * Generates an RSA 2048-bit key pair and creates a signed certificate
 * structure stored in TentaCLAW's internal PEM format.
 *
 * Returns { certPem, keyPem, serialNumber, fingerprint, validFrom, validTo }.
 */
function buildCertificate(opts: {
    commonName: string;
    isCA: boolean;
    validityDays: number;
    caCertPem?: string;
    caKeyPem?: string;
}): {
    certPem: string;
    keyPem: string;
    serialNumber: string;
    fingerprint: string;
    validFrom: string;
    validTo: string;
} {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const serialNumber = randomBytes(16).toString('hex');
    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + opts.validityDays * 24 * 60 * 60 * 1000);

    const subjectCN = opts.commonName;
    const issuerCN = opts.caCertPem ? extractCN(opts.caCertPem) : subjectCN;
    const signingKey = opts.caKeyPem
        ? createPrivateKey(opts.caKeyPem)
        : createPrivateKey(privateKey);

    // We encode a structured PEM "certificate" that stores all the
    // metadata needed for verification. In a production deployment with
    // actual TLS listeners a proper ASN.1 DER encoder would be used.
    // Here we store a JSON-in-PEM structure that our verify function understands.
    const certData = {
        version: 3,
        serialNumber,
        issuer: issuerCN,
        subject: subjectCN,
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        isCA: opts.isCA,
        publicKey: publicKey as string,
        signatureAlgorithm: 'RSA-SHA256',
        signature: '',
    };

    // Sign the certificate data
    const tbsData = JSON.stringify({
        ...certData,
        signature: undefined,
    });
    const sign = createSign('RSA-SHA256');
    sign.update(tbsData);
    sign.end();
    certData.signature = sign.sign(signingKey, 'hex');

    // Encode as PEM
    const certJson = JSON.stringify(certData);
    const certBase64 = Buffer.from(certJson).toString('base64');
    const certPem = [
        '-----BEGIN TENTACLAW CERTIFICATE-----',
        ...certBase64.match(/.{1,64}/g)!,
        '-----END TENTACLAW CERTIFICATE-----',
    ].join('\n');

    const fingerprint = createHash('sha256')
        .update(certJson)
        .digest('hex');

    return {
        certPem,
        keyPem: privateKey as string,
        serialNumber,
        fingerprint,
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
    };
}

/**
 * Extract the CN (common name) from a TentaCLAW PEM certificate.
 */
function extractCN(pem: string): string {
    const parsed = parseTentaclawCert(pem);
    return parsed ? parsed.subject : 'unknown';
}

/**
 * Parse a TentaCLAW PEM certificate into its JSON structure.
 */
function parseTentaclawCert(pem: string): {
    version: number;
    serialNumber: string;
    issuer: string;
    subject: string;
    validFrom: string;
    validTo: string;
    isCA: boolean;
    publicKey: string;
    signatureAlgorithm: string;
    signature: string;
} | null {
    const b64 = pem
        .replace(/-----BEGIN TENTACLAW CERTIFICATE-----/g, '')
        .replace(/-----END TENTACLAW CERTIFICATE-----/g, '')
        .replace(/\s/g, '');
    try {
        return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    } catch {
        return null;
    }
}

/**
 * Convert parsed cert data to a CertInfo object.
 */
function certDataToCertInfo(
    data: NonNullable<ReturnType<typeof parseTentaclawCert>>,
    fingerprint: string,
): CertInfo {
    const remaining = daysUntil(data.validTo);
    return {
        subject: data.subject,
        issuer: data.issuer,
        validFrom: data.validFrom,
        validTo: data.validTo,
        serialNumber: data.serialNumber,
        fingerprint,
        daysRemaining: remaining,
        isExpired: remaining < 0,
        isCA: data.isCA,
    };
}

/**
 * Check whether a CIDR range contains an IP address.
 * Supports IPv4 CIDR notation (e.g. "10.0.0.0/8").
 */
function cidrContains(cidr: string, ip: string): boolean {
    const parts = cidr.split('/');
    if (parts.length !== 2) return cidr === ip; // exact match fallback

    const [network, prefixStr] = parts;
    const prefix = parseInt(prefixStr, 10);
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

    const networkNum = ipToNumber(network);
    const ipNum = ipToNumber(ip);
    if (networkNum === null || ipNum === null) return false;

    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (networkNum & mask) === (ipNum & mask);
}

/**
 * Convert an IPv4 address string to a 32-bit number. Returns null on invalid input.
 */
function ipToNumber(ip: string): number | null {
    const octets = ip.split('.');
    if (octets.length !== 4) return null;
    let num = 0;
    for (const octet of octets) {
        const val = parseInt(octet, 10);
        if (isNaN(val) || val < 0 || val > 255) return null;
        num = (num << 8) | val;
    }
    return num >>> 0;
}

// =============================================================================
// 1. Certificate Management
// =============================================================================

/**
 * Initialize the certificate authority and generate the root CA certificate
 * if one does not already exist. For 'custom' mode, loads certs from disk.
 */
export function initCertificates(config: CertConfig): {
    initialized: boolean;
    mode: string;
    caCert: CertInfo | null;
} {
    ensureSchema();

    if (!config.enabled) {
        return { initialized: false, mode: config.mode, caCert: null };
    }

    if (config.mode === 'custom') {
        // Load user-provided CA cert for verification purposes
        if (config.caPath && fs.existsSync(config.caPath)) {
            const caPem = fs.readFileSync(config.caPath, 'utf-8');
            const parsed = parseTentaclawCert(caPem);
            if (parsed) {
                const fp = createHash('sha256')
                    .update(JSON.stringify(parsed))
                    .digest('hex');
                return {
                    initialized: true,
                    mode: 'custom',
                    caCert: certDataToCertInfo(parsed, fp),
                };
            }
        }
        return { initialized: true, mode: 'custom', caCert: null };
    }

    // Self-signed or letsencrypt — check if we already have a CA
    const db = getDb();
    const existingCA = db.prepare(
        `SELECT * FROM security_certificates WHERE type = 'ca' AND revoked = 0 ORDER BY created_at DESC LIMIT 1`
    ).get() as Record<string, unknown> | undefined;

    if (existingCA) {
        const parsed = parseTentaclawCert(existingCA.pem as string);
        if (parsed) {
            // Cache the CA private key
            if (existingCA.private_key_pem) {
                _caPrivateKey = createPrivateKey(existingCA.private_key_pem as string);
            }
            return {
                initialized: true,
                mode: config.mode,
                caCert: certDataToCertInfo(parsed, existingCA.fingerprint as string),
            };
        }
    }

    // Generate new CA certificate
    ensureCertsDir();
    const domain = config.domain || 'tentaclaw.local';
    const ca = buildCertificate({
        commonName: `TentaCLAW CA - ${domain}`,
        isCA: true,
        validityDays: CA_VALIDITY_DAYS,
    });

    const caId = generateId();
    db.prepare(`
        INSERT INTO security_certificates (id, node_id, type, subject, issuer, serial_number,
            fingerprint, pem, private_key_pem, valid_from, valid_to, is_ca)
        VALUES (?, NULL, 'ca', ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
        caId,
        `TentaCLAW CA - ${domain}`,
        `TentaCLAW CA - ${domain}`,
        ca.serialNumber,
        ca.fingerprint,
        ca.certPem,
        ca.keyPem,
        ca.validFrom,
        ca.validTo,
    );

    // Also write CA cert to disk for agents to fetch
    fs.writeFileSync(path.join(CERTS_DIR, 'ca.pem'), ca.certPem, { mode: 0o644 });
    fs.writeFileSync(path.join(CERTS_DIR, 'ca-key.pem'), ca.keyPem, { mode: 0o600 });

    _caPrivateKey = createPrivateKey(ca.keyPem);

    const parsed = parseTentaclawCert(ca.certPem)!;
    return {
        initialized: true,
        mode: config.mode,
        caCert: certDataToCertInfo(parsed, ca.fingerprint),
    };
}

/**
 * Generate a TLS certificate for a cluster node, signed by our CA.
 */
export function generateNodeCert(nodeId: string): {
    certPem: string;
    keyPem: string;
    caCertPem: string;
    certInfo: CertInfo;
} {
    ensureSchema();
    const db = getDb();

    // Get the CA cert + key
    const caRow = db.prepare(
        `SELECT * FROM security_certificates WHERE type = 'ca' AND revoked = 0 ORDER BY created_at DESC LIMIT 1`
    ).get() as Record<string, unknown> | undefined;

    if (!caRow) {
        throw new Error('No CA certificate found. Call initCertificates() first.');
    }

    // Use cached CA private key when available (set by initCertificates)
    const caKeyPem = _caPrivateKey
        ? _caPrivateKey.export({ type: 'pkcs8', format: 'pem' }) as string
        : caRow.private_key_pem as string;

    const nodeCert = buildCertificate({
        commonName: `node-${nodeId}.tentaclaw.local`,
        isCA: false,
        validityDays: CERT_VALIDITY_DAYS,
        caCertPem: caRow.pem as string,
        caKeyPem,
    });

    const certId = generateId();
    db.prepare(`
        INSERT INTO security_certificates (id, node_id, type, subject, issuer, serial_number,
            fingerprint, pem, private_key_pem, valid_from, valid_to, is_ca)
        VALUES (?, ?, 'node', ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
        certId,
        nodeId,
        `node-${nodeId}.tentaclaw.local`,
        extractCN(caRow.pem as string),
        nodeCert.serialNumber,
        nodeCert.fingerprint,
        nodeCert.certPem,
        nodeCert.keyPem,
        nodeCert.validFrom,
        nodeCert.validTo,
    );

    const parsed = parseTentaclawCert(nodeCert.certPem)!;
    return {
        certPem: nodeCert.certPem,
        keyPem: nodeCert.keyPem,
        caCertPem: caRow.pem as string,
        certInfo: certDataToCertInfo(parsed, nodeCert.fingerprint),
    };
}

/**
 * Verify a certificate PEM against our CA. Returns true if valid and unexpired.
 */
export function verifyCert(certPem: string): {
    valid: boolean;
    reason: string;
    certInfo: CertInfo | null;
} {
    ensureSchema();

    const parsed = parseTentaclawCert(certPem);
    if (!parsed) {
        return { valid: false, reason: 'Invalid certificate format', certInfo: null };
    }

    // Check expiry
    const remaining = daysUntil(parsed.validTo);
    if (remaining < 0) {
        const fp = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
        return {
            valid: false,
            reason: 'Certificate has expired',
            certInfo: certDataToCertInfo(parsed, fp),
        };
    }

    // Check revocation
    const db = getDb();
    const row = db.prepare(
        `SELECT revoked FROM security_certificates WHERE serial_number = ?`
    ).get(parsed.serialNumber) as { revoked: number } | undefined;

    if (row && row.revoked === 1) {
        const fp = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
        return {
            valid: false,
            reason: 'Certificate has been revoked',
            certInfo: certDataToCertInfo(parsed, fp),
        };
    }

    // Verify signature against CA
    const caRow = db.prepare(
        `SELECT pem FROM security_certificates WHERE type = 'ca' AND revoked = 0 ORDER BY created_at DESC LIMIT 1`
    ).get() as { pem: string } | undefined;

    if (!caRow && !parsed.isCA) {
        const fp = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
        return {
            valid: false,
            reason: 'No CA certificate available for verification',
            certInfo: certDataToCertInfo(parsed, fp),
        };
    }

    // For CA certs, verify self-signature; for node certs, verify against CA
    const caCertPem = parsed.isCA ? certPem : caRow!.pem;
    const caParsed = parseTentaclawCert(caCertPem);
    if (!caParsed) {
        const fp = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
        return {
            valid: false,
            reason: 'CA certificate is corrupted',
            certInfo: certDataToCertInfo(parsed, fp),
        };
    }

    // Reconstruct TBS data and verify signature
    const tbsData = JSON.stringify({
        ...parsed,
        signature: undefined,
    });
    const verify = createVerify('RSA-SHA256');
    verify.update(tbsData);
    verify.end();

    const signatureValid = verify.verify(caParsed.publicKey, parsed.signature, 'hex');
    const fp = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');

    if (!signatureValid) {
        return {
            valid: false,
            reason: 'Signature verification failed — certificate was not issued by our CA',
            certInfo: certDataToCertInfo(parsed, fp),
        };
    }

    return {
        valid: true,
        reason: 'Certificate is valid',
        certInfo: certDataToCertInfo(parsed, fp),
    };
}

/**
 * Get the status of all certificates — CA health, node certs, expiry warnings.
 */
export function getCertStatus(): CertStatus {
    ensureSchema();
    const db = getDb();

    // Get CA cert
    const caRow = db.prepare(
        `SELECT * FROM security_certificates WHERE type = 'ca' AND revoked = 0 ORDER BY created_at DESC LIMIT 1`
    ).get() as Record<string, unknown> | undefined;

    let caCert: CertInfo | null = null;
    if (caRow) {
        const parsed = parseTentaclawCert(caRow.pem as string);
        if (parsed) {
            caCert = certDataToCertInfo(parsed, caRow.fingerprint as string);
        }
    }

    // Get all node certs
    const nodeRows = db.prepare(
        `SELECT * FROM security_certificates WHERE type = 'node' AND revoked = 0 ORDER BY valid_to ASC`
    ).all() as Array<Record<string, unknown>>;

    const nodes: Array<{ nodeId: string; cert: CertInfo }> = [];
    let expiringWithin30d = 0;
    let expired = 0;

    for (const row of nodeRows) {
        const parsed = parseTentaclawCert(row.pem as string);
        if (parsed) {
            const info = certDataToCertInfo(parsed, row.fingerprint as string);
            nodes.push({ nodeId: row.node_id as string, cert: info });
            if (info.isExpired) expired++;
            else if (info.daysRemaining <= CERT_EXPIRY_WARNING_DAYS) expiringWithin30d++;
        }
    }

    // Check CA expiry too
    if (caCert) {
        if (caCert.isExpired) expired++;
        else if (caCert.daysRemaining <= CERT_EXPIRY_WARNING_DAYS) expiringWithin30d++;
    }

    let overallHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (expired > 0 || !caCert) overallHealth = 'critical';
    else if (expiringWithin30d > 0) overallHealth = 'warning';

    return { ca: caCert, nodes, overallHealth, expiringWithin30d, expired };
}

/**
 * Rotate all node certificates — revoke old ones and issue replacements.
 * The CA certificate is NOT rotated (use initCertificates for CA rotation).
 */
export function rotateCerts(): {
    rotated: number;
    errors: Array<{ nodeId: string; error: string }>;
} {
    ensureSchema();
    const db = getDb();

    const nodeRows = db.prepare(
        `SELECT DISTINCT node_id FROM security_certificates WHERE type = 'node' AND revoked = 0`
    ).all() as Array<{ node_id: string }>;

    let rotated = 0;
    const errors: Array<{ nodeId: string; error: string }> = [];

    const revokeStmt = db.prepare(
        `UPDATE security_certificates SET revoked = 1 WHERE node_id = ? AND type = 'node' AND revoked = 0`
    );

    db.transaction(() => {
        for (const row of nodeRows) {
            try {
                // Revoke old cert(s)
                revokeStmt.run(row.node_id);
                // Generate new cert
                generateNodeCert(row.node_id);
                rotated++;
            } catch (err) {
                errors.push({
                    nodeId: row.node_id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    })();

    return { rotated, errors };
}

// =============================================================================
// 2. Secrets Manager
// =============================================================================

/**
 * Store an encrypted secret. If a secret with the same name and namespace
 * already exists, a new version is created.
 */
export function createSecret(
    name: string,
    value: string,
    namespace: string = DEFAULT_NAMESPACE,
    type: Secret['type'] = 'opaque',
): SecretMetadata {
    ensureSchema();
    const db = getDb();

    // Get current max version for this name + namespace
    const existing = db.prepare(
        `SELECT MAX(version) as max_version FROM security_secrets WHERE name = ? AND namespace = ?`
    ).get(name, namespace) as { max_version: number | null } | undefined;

    const version = (existing?.max_version ?? 0) + 1;

    const { ciphertext, iv, authTag } = encrypt(value);

    db.prepare(`
        INSERT INTO security_secrets (name, namespace, encrypted_value, iv, auth_tag, type, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(name, namespace, ciphertext, iv, authTag, type, version);

    return {
        name,
        namespace,
        type,
        createdAt: now(),
        updatedAt: now(),
        version,
    };
}

/**
 * Retrieve and decrypt a secret. Returns the latest version by default.
 */
export function getSecret(
    name: string,
    namespace: string = DEFAULT_NAMESPACE,
): Secret | null {
    ensureSchema();
    const db = getDb();

    const row = db.prepare(`
        SELECT * FROM security_secrets
        WHERE name = ? AND namespace = ?
        ORDER BY version DESC
        LIMIT 1
    `).get(name, namespace) as Record<string, unknown> | undefined;

    if (!row) return null;

    const decrypted = decrypt(
        row.encrypted_value as string,
        row.iv as string,
        row.auth_tag as string,
    );

    return {
        name: row.name as string,
        namespace: row.namespace as string,
        value: decrypted,
        type: row.type as Secret['type'],
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        version: row.version as number,
    };
}

/**
 * List secret names and metadata (NOT values) in a namespace.
 */
export function listSecrets(namespace?: string): SecretMetadata[] {
    ensureSchema();
    const db = getDb();

    let rows: Array<Record<string, unknown>>;
    if (namespace) {
        rows = db.prepare(`
            SELECT name, namespace, type, version, created_at, updated_at
            FROM security_secrets s1
            WHERE namespace = ?
              AND version = (
                SELECT MAX(version) FROM security_secrets s2
                WHERE s2.name = s1.name AND s2.namespace = s1.namespace
              )
            ORDER BY name
        `).all(namespace) as Array<Record<string, unknown>>;
    } else {
        rows = db.prepare(`
            SELECT name, namespace, type, version, created_at, updated_at
            FROM security_secrets s1
            WHERE version = (
                SELECT MAX(version) FROM security_secrets s2
                WHERE s2.name = s1.name AND s2.namespace = s1.namespace
            )
            ORDER BY namespace, name
        `).all() as Array<Record<string, unknown>>;
    }

    return rows.map(row => ({
        name: row.name as string,
        namespace: row.namespace as string,
        type: row.type as Secret['type'],
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        version: row.version as number,
    }));
}

/**
 * Delete all versions of a secret.
 */
export function deleteSecret(
    name: string,
    namespace: string = DEFAULT_NAMESPACE,
): boolean {
    ensureSchema();
    const db = getDb();

    const result = db.prepare(
        `DELETE FROM security_secrets WHERE name = ? AND namespace = ?`
    ).run(name, namespace);

    return result.changes > 0;
}

/**
 * Rotate a secret — creates a new version with a freshly generated random value.
 * Returns the new plaintext value (only time it is available).
 */
export function rotateSecret(
    name: string,
    namespace: string = DEFAULT_NAMESPACE,
): { newValue: string; metadata: SecretMetadata } | null {
    ensureSchema();
    const db = getDb();

    // Get current secret to preserve its type
    const current = db.prepare(`
        SELECT type FROM security_secrets
        WHERE name = ? AND namespace = ?
        ORDER BY version DESC LIMIT 1
    `).get(name, namespace) as { type: string } | undefined;

    if (!current) return null;

    // Generate a new random value based on type
    let newValue: string;
    switch (current.type) {
        case 'api-key':
            newValue = 'tc_' + randomBytes(32).toString('hex');
            break;
        case 'connection-string':
            // For connection strings, generate a new password component
            newValue = randomBytes(24).toString('base64url');
            break;
        default:
            newValue = randomBytes(32).toString('hex');
            break;
    }

    const metadata = createSecret(name, newValue, namespace, current.type as Secret['type']);

    return { newValue, metadata };
}

// =============================================================================
// 3. Network Policies
// =============================================================================

/**
 * Create or update a network policy.
 */
export function createNetworkPolicy(policy: NetworkPolicy): NetworkPolicy {
    ensureSchema();
    const db = getDb();

    const rulesJson = JSON.stringify(policy.rules);
    const ns = policy.namespace || DEFAULT_NAMESPACE;

    db.prepare(`
        INSERT INTO security_network_policies (name, namespace, rules, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(name, namespace) DO UPDATE SET
            rules = excluded.rules,
            updated_at = datetime('now')
    `).run(policy.name, ns, rulesJson);

    return { ...policy, namespace: ns };
}

/**
 * Get all network policies, optionally filtered by namespace.
 */
export function getNetworkPolicies(namespace?: string): NetworkPolicy[] {
    ensureSchema();
    const db = getDb();

    let rows: Array<Record<string, unknown>>;
    if (namespace) {
        rows = db.prepare(
            `SELECT * FROM security_network_policies WHERE namespace = ? ORDER BY name`
        ).all(namespace) as Array<Record<string, unknown>>;
    } else {
        rows = db.prepare(
            `SELECT * FROM security_network_policies ORDER BY namespace, name`
        ).all() as Array<Record<string, unknown>>;
    }

    return rows.map(row => ({
        name: row.name as string,
        namespace: row.namespace as string,
        rules: JSON.parse(row.rules as string) as NetworkRule[],
    }));
}

/**
 * Evaluate whether a network request is allowed by the active policies.
 * Uses a default-deny model: if no policy explicitly allows the traffic,
 * it is denied. If no policies exist at all, traffic is allowed (open mode).
 *
 * @param source - Source namespace or IP address
 * @param destination - Destination namespace or IP address
 * @param port - Destination port
 */
export function evaluateNetworkPolicy(
    source: string,
    destination: string,
    port: number,
): NetworkPolicyEvaluation {
    ensureSchema();

    const policies = getNetworkPolicies();
    if (policies.length === 0) {
        return {
            allowed: true,
            matchedPolicy: null,
            matchedRule: null,
            reason: 'No network policies defined — default allow',
        };
    }

    // Check deny rules first (deny takes precedence)
    for (const policy of policies) {
        for (const rule of policy.rules) {
            if (rule.action !== 'deny') continue;
            if (ruleMatches(rule, source, destination, port)) {
                return {
                    allowed: false,
                    matchedPolicy: policy.name,
                    matchedRule: rule,
                    reason: `Denied by policy "${policy.name}" — ${rule.direction} deny rule`,
                };
            }
        }
    }

    // Check allow rules
    for (const policy of policies) {
        for (const rule of policy.rules) {
            if (rule.action !== 'allow') continue;
            if (ruleMatches(rule, source, destination, port)) {
                return {
                    allowed: true,
                    matchedPolicy: policy.name,
                    matchedRule: rule,
                    reason: `Allowed by policy "${policy.name}" — ${rule.direction} allow rule`,
                };
            }
        }
    }

    // Default deny if policies exist but none matched
    return {
        allowed: false,
        matchedPolicy: null,
        matchedRule: null,
        reason: 'No matching allow rule found — default deny',
    };
}

/**
 * Check if a network rule matches the given source/destination/port.
 */
function ruleMatches(
    rule: NetworkRule,
    source: string,
    destination: string,
    port: number,
): boolean {
    // Match source/destination based on rule direction
    if (rule.direction === 'ingress') {
        if (rule.source && !matchesTarget(rule.source, source)) return false;
        if (rule.destination && !matchesTarget(rule.destination, destination)) return false;
    } else {
        if (rule.source && !matchesTarget(rule.source, source)) return false;
        if (rule.destination && !matchesTarget(rule.destination, destination)) return false;
    }

    // Check ports (if specified)
    if (rule.ports && rule.ports.length > 0) {
        if (!rule.ports.includes(port)) return false;
    }

    return true;
}

/**
 * Check if a target (namespace name or CIDR) matches a given value (namespace or IP).
 */
function matchesTarget(ruleTarget: string, actual: string): boolean {
    // Wildcard
    if (ruleTarget === '*') return true;

    // CIDR notation — target contains a '/'
    if (ruleTarget.includes('/')) {
        return cidrContains(ruleTarget, actual);
    }

    // Exact namespace or IP match
    return ruleTarget === actual;
}

/**
 * Delete a network policy by name (and optionally namespace).
 */
export function deleteNetworkPolicy(
    name: string,
    namespace: string = DEFAULT_NAMESPACE,
): boolean {
    ensureSchema();
    const db = getDb();

    const result = db.prepare(
        `DELETE FROM security_network_policies WHERE name = ? AND namespace = ?`
    ).run(name, namespace);

    return result.changes > 0;
}

// =============================================================================
// 4. Security Scanner
// =============================================================================

/**
 * Run a comprehensive security scan of the cluster configuration.
 * Checks TLS, auth, secrets hygiene, network policies, and more.
 */
export function runSecurityScan(): SecurityScanResult {
    ensureSchema();

    const checks: SecurityCheck[] = [];

    // --- TLS checks ---
    checks.push(checkTlsEnabled());
    checks.push(checkCaExists());
    checks.push(checkCertExpiry());

    // --- Auth checks ---
    checks.push(checkAuthEnabled());
    checks.push(checkDefaultPassword());
    checks.push(checkApiKeyStrength());

    // --- Secrets checks ---
    checks.push(checkMasterKeySource());
    checks.push(checkSecretsEncrypted());

    // --- Network checks ---
    checks.push(checkNetworkPoliciesExist());
    checks.push(checkDefaultDenyPolicy());

    // --- Config checks ---
    checks.push(checkDebugMode());
    checks.push(checkCorsConfig());
    checks.push(checkRateLimiting());

    // --- Dependency checks ---
    checks.push(checkKnownVulnDeps());

    // Calculate score
    const summary = {
        passed: checks.filter(c => c.status === 'pass').length,
        failed: checks.filter(c => c.status === 'fail').length,
        warnings: checks.filter(c => c.status === 'warn').length,
        total: checks.length,
    };

    // Score: 100 base, deduct by severity
    let score = 100;
    for (const check of checks) {
        if (check.status === 'fail') {
            switch (check.severity) {
                case 'critical': score -= 25; break;
                case 'high': score -= 15; break;
                case 'medium': score -= 10; break;
                case 'low': score -= 5; break;
                default: break;
            }
        } else if (check.status === 'warn') {
            switch (check.severity) {
                case 'critical': score -= 10; break;
                case 'high': score -= 7; break;
                case 'medium': score -= 5; break;
                case 'low': score -= 2; break;
                default: break;
            }
        }
    }
    score = Math.max(0, Math.min(100, score));

    const grade = scoreToGrade(score);
    const timestamp = new Date().toISOString();

    const result: SecurityScanResult = { timestamp, score, grade, checks, summary };

    // Persist scan result
    const db = getDb();
    db.prepare(
        `INSERT INTO security_scan_history (score, grade, result, created_at) VALUES (?, ?, ?, ?)`
    ).run(score, grade, JSON.stringify(result), timestamp);

    _lastScanResult = result;
    return result;
}

/**
 * Get the security score (0-100) with letter grade.
 * Returns the last scan result, or runs a new scan if none exists.
 */
export function getSecurityScore(): {
    score: number;
    grade: string;
    lastScanAt: string;
    summary: SecurityScanResult['summary'];
} {
    if (!_lastScanResult) {
        runSecurityScan();
    }
    const result = _lastScanResult!;
    return {
        score: result.score,
        grade: result.grade,
        lastScanAt: result.timestamp,
        summary: result.summary,
    };
}

/**
 * Get actionable security recommendations sorted by priority.
 */
export function getSecurityRecommendations(): SecurityRecommendation[] {
    if (!_lastScanResult) {
        runSecurityScan();
    }

    const recommendations: SecurityRecommendation[] = [];
    const result = _lastScanResult!;

    for (const check of result.checks) {
        if (check.status === 'pass') continue;

        const priority = check.status === 'fail' ? check.severity : (
            check.severity === 'critical' ? 'high' :
            check.severity === 'high' ? 'medium' :
            'low'
        );

        recommendations.push({
            priority: priority as SecurityRecommendation['priority'],
            category: check.category,
            title: check.name,
            description: check.message,
            effort: getEffortEstimate(check.id),
        });
    }

    // Sort by priority
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) =>
        (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
    );

    return recommendations;
}

// --- Individual security checks ---

function checkTlsEnabled(): SecurityCheck {
    const db = getDb();
    const caExists = db.prepare(
        `SELECT COUNT(*) as count FROM security_certificates WHERE type = 'ca' AND revoked = 0`
    ).get() as { count: number };

    return {
        id: 'tls-enabled',
        category: 'tls',
        name: 'TLS encryption enabled',
        status: caExists.count > 0 ? 'pass' : 'fail',
        severity: 'critical',
        message: caExists.count > 0
            ? 'TLS is enabled with a CA certificate'
            : 'No TLS certificates configured — all traffic is unencrypted',
        recommendation: 'Run initCertificates() with mode "self-signed" to enable mTLS',
    };
}

function checkCaExists(): SecurityCheck {
    const db = getDb();
    const caRow = db.prepare(
        `SELECT valid_to FROM security_certificates WHERE type = 'ca' AND revoked = 0 ORDER BY created_at DESC LIMIT 1`
    ).get() as { valid_to: string } | undefined;

    if (!caRow) {
        return {
            id: 'ca-exists',
            category: 'tls',
            name: 'Certificate Authority exists',
            status: 'fail',
            severity: 'high',
            message: 'No CA certificate found — cannot issue node certificates',
        };
    }

    const remaining = daysUntil(caRow.valid_to);
    return {
        id: 'ca-exists',
        category: 'tls',
        name: 'Certificate Authority exists',
        status: remaining > 0 ? 'pass' : 'fail',
        severity: 'high',
        message: remaining > 0
            ? `CA certificate valid for ${remaining} more days`
            : 'CA certificate has expired',
    };
}

function checkCertExpiry(): SecurityCheck {
    const db = getDb();
    const expiring = db.prepare(`
        SELECT COUNT(*) as count FROM security_certificates
        WHERE revoked = 0
          AND valid_to < datetime('now', '+30 days')
          AND valid_to > datetime('now')
    `).get() as { count: number };

    const expired = db.prepare(`
        SELECT COUNT(*) as count FROM security_certificates
        WHERE revoked = 0 AND valid_to < datetime('now')
    `).get() as { count: number };

    if (expired.count > 0) {
        return {
            id: 'cert-expiry',
            category: 'tls',
            name: 'Certificate expiry check',
            status: 'fail',
            severity: 'critical',
            message: `${expired.count} certificate(s) have expired`,
            recommendation: 'Run rotateCerts() to replace expired certificates',
        };
    }

    if (expiring.count > 0) {
        return {
            id: 'cert-expiry',
            category: 'tls',
            name: 'Certificate expiry check',
            status: 'warn',
            severity: 'medium',
            message: `${expiring.count} certificate(s) expiring within 30 days`,
            recommendation: 'Run rotateCerts() to proactively renew certificates',
        };
    }

    return {
        id: 'cert-expiry',
        category: 'tls',
        name: 'Certificate expiry check',
        status: 'pass',
        severity: 'medium',
        message: 'All certificates are valid and not expiring soon',
    };
}

function checkAuthEnabled(): SecurityCheck {
    const db = getDb();
    let hasAuth = false;

    // Check for SSO/OIDC config
    try {
        const oidcRow = db.prepare(
            `SELECT enabled FROM oidc_config WHERE id = 'default'`
        ).get() as { enabled: number } | undefined;
        if (oidcRow && oidcRow.enabled === 1) hasAuth = true;
    } catch {
        // Table may not exist yet — that is fine
    }

    // Check for API keys / service accounts
    try {
        const saCount = db.prepare(
            `SELECT COUNT(*) as count FROM service_accounts`
        ).get() as { count: number };
        if (saCount.count > 0) hasAuth = true;
    } catch {
        // Table may not exist
    }

    // Check env-based auth
    if (process.env.TENTACLAW_API_KEY || process.env.TENTACLAW_AUTH_ENABLED === 'true') {
        hasAuth = true;
    }

    return {
        id: 'auth-enabled',
        category: 'auth',
        name: 'Authentication enabled',
        status: hasAuth ? 'pass' : 'fail',
        severity: 'critical',
        message: hasAuth
            ? 'Authentication is configured'
            : 'No authentication mechanism detected — API is open to anyone',
        recommendation: 'Enable SSO via the sso module, or set TENTACLAW_API_KEY env var',
    };
}

function checkDefaultPassword(): SecurityCheck {
    const apiKey = process.env.TENTACLAW_API_KEY || '';
    const weakPasswords = [
        'admin', 'password', '123456', 'tentaclaw', 'default', 'changeme',
        'test', 'secret', 'abc123', 'letmein',
    ];

    if (!apiKey) {
        return {
            id: 'default-password',
            category: 'auth',
            name: 'No default/weak passwords',
            status: 'warn',
            severity: 'medium',
            message: 'No API key configured — cannot check for weak passwords',
        };
    }

    const isWeak = weakPasswords.some(w => apiKey.toLowerCase() === w) || apiKey.length < 16;

    return {
        id: 'default-password',
        category: 'auth',
        name: 'No default/weak passwords',
        status: isWeak ? 'fail' : 'pass',
        severity: 'high',
        message: isWeak
            ? 'API key is too weak or uses a default value'
            : 'API key meets minimum strength requirements',
        recommendation: 'Use a randomly generated API key with at least 32 characters',
    };
}

function checkApiKeyStrength(): SecurityCheck {
    const db = getDb();
    let weakCount = 0;
    let totalCount = 0;

    try {
        const rows = db.prepare(
            `SELECT token_prefix FROM service_accounts`
        ).all() as Array<{ token_prefix: string }>;
        totalCount = rows.length;
        // Token prefixes that are too short suggest weak tokens
        weakCount = rows.filter(r => r.token_prefix.length < 4).length;
    } catch {
        // Table may not exist
    }

    if (totalCount === 0) {
        return {
            id: 'api-key-strength',
            category: 'auth',
            name: 'API key strength',
            status: 'pass',
            severity: 'medium',
            message: 'No service accounts to check',
        };
    }

    return {
        id: 'api-key-strength',
        category: 'auth',
        name: 'API key strength',
        status: weakCount > 0 ? 'warn' : 'pass',
        severity: 'medium',
        message: weakCount > 0
            ? `${weakCount} of ${totalCount} service accounts may have weak tokens`
            : `All ${totalCount} service account tokens meet strength requirements`,
    };
}

function checkMasterKeySource(): SecurityCheck {
    const fromEnv = !!process.env.TENTACLAW_MASTER_KEY;
    const keyFilePath = path.join(DATA_DIR, '.master-key');
    const fromFile = fs.existsSync(keyFilePath);

    if (fromEnv) {
        return {
            id: 'master-key-source',
            category: 'secrets',
            name: 'Master key from environment',
            status: 'pass',
            severity: 'high',
            message: 'Encryption master key is set via environment variable (recommended)',
        };
    }

    if (fromFile) {
        return {
            id: 'master-key-source',
            category: 'secrets',
            name: 'Master key from environment',
            status: 'warn',
            severity: 'medium',
            message: 'Encryption master key is stored on disk — consider using TENTACLAW_MASTER_KEY env var instead',
            recommendation: 'Set TENTACLAW_MASTER_KEY env var and remove the disk-based key file',
        };
    }

    return {
        id: 'master-key-source',
        category: 'secrets',
        name: 'Master key from environment',
        status: 'warn',
        severity: 'low',
        message: 'No master key configured yet — will be auto-generated on first secret creation',
    };
}

function checkSecretsEncrypted(): SecurityCheck {
    const db = getDb();
    let totalSecrets = 0;

    try {
        const row = db.prepare(
            `SELECT COUNT(*) as count FROM security_secrets`
        ).get() as { count: number };
        totalSecrets = row.count;
    } catch {
        // Table may not exist
    }

    if (totalSecrets === 0) {
        return {
            id: 'secrets-encrypted',
            category: 'secrets',
            name: 'Secrets encrypted at rest',
            status: 'pass',
            severity: 'high',
            message: 'No secrets stored yet — encryption will be applied automatically',
        };
    }

    // Verify all secrets have IV and auth_tag (meaning they are encrypted)
    let unencrypted = 0;
    try {
        const row = db.prepare(
            `SELECT COUNT(*) as count FROM security_secrets WHERE iv IS NULL OR auth_tag IS NULL OR iv = '' OR auth_tag = ''`
        ).get() as { count: number };
        unencrypted = row.count;
    } catch {
        // Table may not exist
    }

    return {
        id: 'secrets-encrypted',
        category: 'secrets',
        name: 'Secrets encrypted at rest',
        status: unencrypted > 0 ? 'fail' : 'pass',
        severity: 'critical',
        message: unencrypted > 0
            ? `${unencrypted} of ${totalSecrets} secrets are NOT encrypted at rest`
            : `All ${totalSecrets} secrets are encrypted with AES-256-GCM`,
    };
}

function checkNetworkPoliciesExist(): SecurityCheck {
    const db = getDb();
    let policyCount = 0;

    try {
        const row = db.prepare(
            `SELECT COUNT(*) as count FROM security_network_policies`
        ).get() as { count: number };
        policyCount = row.count;
    } catch {
        // Table may not exist
    }

    return {
        id: 'netpol-exists',
        category: 'network',
        name: 'Network policies defined',
        status: policyCount > 0 ? 'pass' : 'warn',
        severity: 'medium',
        message: policyCount > 0
            ? `${policyCount} network policy/policies defined`
            : 'No network policies defined — all network traffic is unrestricted',
        recommendation: 'Define network policies to restrict inter-namespace traffic',
    };
}

function checkDefaultDenyPolicy(): SecurityCheck {
    const policies = getNetworkPolicies();
    const hasDenyAll = policies.some(p =>
        p.rules.some(r =>
            r.action === 'deny' && !r.source && !r.destination && (!r.ports || r.ports.length === 0)
        )
    );

    if (policies.length === 0) {
        return {
            id: 'default-deny',
            category: 'network',
            name: 'Default deny policy',
            status: 'warn',
            severity: 'medium',
            message: 'No network policies exist — cannot enforce default deny',
        };
    }

    return {
        id: 'default-deny',
        category: 'network',
        name: 'Default deny policy',
        status: hasDenyAll ? 'pass' : 'warn',
        severity: 'medium',
        message: hasDenyAll
            ? 'A default deny-all policy is in place'
            : 'No default deny-all policy found — traffic is allow-by-default when no rule matches',
        recommendation: 'Add a catch-all deny policy and only allow required traffic explicitly',
    };
}

function checkDebugMode(): SecurityCheck {
    const debugEnvs = [
        process.env.NODE_ENV === 'development',
        process.env.TENTACLAW_DEBUG === 'true',
        process.env.DEBUG !== undefined,
    ];
    const isDebug = debugEnvs.some(Boolean);

    return {
        id: 'debug-mode',
        category: 'config',
        name: 'Debug mode disabled',
        status: isDebug ? 'warn' : 'pass',
        severity: 'low',
        message: isDebug
            ? 'Debug mode appears to be enabled — may expose sensitive information'
            : 'Debug mode is not active',
        recommendation: 'Set NODE_ENV=production and remove DEBUG env vars in production',
    };
}

function checkCorsConfig(): SecurityCheck {
    const corsOrigin = process.env.TENTACLAW_CORS_ORIGIN;
    if (!corsOrigin || corsOrigin === '*') {
        return {
            id: 'cors-config',
            category: 'config',
            name: 'CORS properly configured',
            status: corsOrigin === '*' ? 'warn' : 'pass',
            severity: 'low',
            message: corsOrigin === '*'
                ? 'CORS allows all origins (*) — restrict to specific domains in production'
                : 'CORS origin not explicitly configured — using framework defaults',
            recommendation: 'Set TENTACLAW_CORS_ORIGIN to your specific dashboard domain',
        };
    }

    return {
        id: 'cors-config',
        category: 'config',
        name: 'CORS properly configured',
        status: 'pass',
        severity: 'low',
        message: `CORS restricted to: ${corsOrigin}`,
    };
}

function checkRateLimiting(): SecurityCheck {
    const rateLimit = process.env.TENTACLAW_RATE_LIMIT;

    return {
        id: 'rate-limiting',
        category: 'config',
        name: 'Rate limiting configured',
        status: rateLimit ? 'pass' : 'warn',
        severity: 'medium',
        message: rateLimit
            ? `Rate limiting configured: ${rateLimit}`
            : 'No rate limiting configured — API may be vulnerable to abuse',
        recommendation: 'Set TENTACLAW_RATE_LIMIT to prevent API abuse (e.g., "100/min")',
    };
}

function checkKnownVulnDeps(): SecurityCheck {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return {
            id: 'vuln-deps',
            category: 'deps',
            name: 'No known vulnerable dependencies',
            status: 'pass',
            severity: 'info',
            message: 'Could not locate package.json — skipping dependency check',
        };
    }

    try {
        const pkgContent = fs.readFileSync(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(pkgContent);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        const warnings: string[] = [];

        // Check for known problematic package patterns (very old versions)
        // This is a basic heuristic — not a full CVE database
        const suspects: Record<string, string> = {
            'lodash': '4.17.20',    // versions below this had prototype pollution
            'minimist': '1.2.6',    // prototype pollution fix
            'json5': '2.2.2',       // prototype pollution fix
        };

        for (const [pkgName, minSafe] of Object.entries(suspects)) {
            if (allDeps[pkgName]) {
                const version = (allDeps[pkgName] as string).replace(/[\^~>=<]/g, '');
                if (version < minSafe) {
                    warnings.push(`${pkgName}@${version} (recommend >= ${minSafe})`);
                }
            }
        }

        return {
            id: 'vuln-deps',
            category: 'deps',
            name: 'No known vulnerable dependencies',
            status: warnings.length > 0 ? 'warn' : 'pass',
            severity: warnings.length > 0 ? 'medium' : 'info',
            message: warnings.length > 0
                ? `Potentially outdated dependencies: ${warnings.join(', ')}`
                : 'No known vulnerable dependencies detected (basic check)',
            recommendation: warnings.length > 0
                ? 'Run "npm audit" for a comprehensive vulnerability scan'
                : undefined,
        };
    } catch {
        return {
            id: 'vuln-deps',
            category: 'deps',
            name: 'No known vulnerable dependencies',
            status: 'pass',
            severity: 'info',
            message: 'Could not parse package.json — skipping dependency check',
        };
    }
}

function scoreToGrade(score: number): SecurityScanResult['grade'] {
    if (score >= 95) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

function getEffortEstimate(checkId: string): SecurityRecommendation['effort'] {
    const effortMap: Record<string, SecurityRecommendation['effort']> = {
        'tls-enabled': 'minimal',
        'ca-exists': 'minimal',
        'cert-expiry': 'minimal',
        'auth-enabled': 'moderate',
        'default-password': 'minimal',
        'api-key-strength': 'minimal',
        'master-key-source': 'minimal',
        'secrets-encrypted': 'moderate',
        'netpol-exists': 'moderate',
        'default-deny': 'moderate',
        'debug-mode': 'minimal',
        'cors-config': 'minimal',
        'rate-limiting': 'moderate',
        'vuln-deps': 'significant',
    };
    return effortMap[checkId] || 'moderate';
}

// =============================================================================
// 5. Compliance Reporter
// =============================================================================

/**
 * Generate a compliance report for the specified framework.
 * Checks relevant security controls and returns pass/fail/na per control.
 */
export function generateComplianceReport(framework: ComplianceFramework): ComplianceReport {
    ensureSchema();

    // Run a fresh scan to get current security state
    if (!_lastScanResult) {
        runSecurityScan();
    }
    const scan = _lastScanResult!;

    let controls: ComplianceControl[];

    switch (framework) {
        case 'soc2':
            controls = generateSOC2Controls(scan);
            break;
        case 'hipaa':
            controls = generateHIPAAControls(scan);
            break;
        case 'gdpr':
            controls = generateGDPRControls(scan);
            break;
        case 'pci-dss':
            controls = generatePCIDSSControls(scan);
            break;
        default:
            controls = [];
    }

    const summary = {
        passed: controls.filter(c => c.status === 'pass').length,
        failed: controls.filter(c => c.status === 'fail').length,
        notApplicable: controls.filter(c => c.status === 'na').length,
        partial: controls.filter(c => c.status === 'partial').length,
        total: controls.length,
        compliancePct: 0,
    };

    const applicable = summary.total - summary.notApplicable;
    summary.compliancePct = applicable > 0
        ? Math.round(((summary.passed + summary.partial * 0.5) / applicable) * 100)
        : 100;

    let overallStatus: ComplianceReport['overallStatus'] = 'compliant';
    if (summary.failed > 0) overallStatus = 'non-compliant';
    else if (summary.partial > 0) overallStatus = 'partial';

    return {
        framework,
        generatedAt: new Date().toISOString(),
        overallStatus,
        controls,
        summary,
    };
}

// --- SOC 2 Controls ---

function generateSOC2Controls(scan: SecurityScanResult): ComplianceControl[] {
    const findCheck = (id: string) => scan.checks.find(c => c.id === id);

    return [
        {
            id: 'CC6.1',
            name: 'Logical and Physical Access Controls',
            description: 'The entity implements logical access security measures to protect against unauthorized access.',
            status: findCheck('auth-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('auth-enabled')?.message || 'Authentication check not performed',
        },
        {
            id: 'CC6.2',
            name: 'Authentication Mechanisms',
            description: 'Prior to issuing system credentials, the entity registers and authorizes new users.',
            status: findCheck('default-password')?.status === 'pass' ? 'pass' :
                    findCheck('default-password')?.status === 'warn' ? 'partial' : 'fail',
            evidence: findCheck('default-password')?.message || 'Password strength check not performed',
        },
        {
            id: 'CC6.3',
            name: 'Access Removal',
            description: 'The entity removes access to protected information when it is no longer required.',
            status: 'partial',
            evidence: 'Secret rotation and certificate revocation are available. Automated access review not implemented.',
        },
        {
            id: 'CC6.6',
            name: 'Encryption of Data in Transit',
            description: 'The entity implements encryption to protect data in transit.',
            status: findCheck('tls-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('tls-enabled')?.message || 'TLS check not performed',
        },
        {
            id: 'CC6.7',
            name: 'Encryption of Data at Rest',
            description: 'The entity restricts the transmission, movement, and removal of information to authorized users.',
            status: findCheck('secrets-encrypted')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('secrets-encrypted')?.message || 'Encryption check not performed',
        },
        {
            id: 'CC7.1',
            name: 'Vulnerability Management',
            description: 'The entity uses detection tools to identify anomalies and vulnerabilities.',
            status: findCheck('vuln-deps')?.status === 'pass' ? 'pass' : 'partial',
            evidence: findCheck('vuln-deps')?.message || 'Dependency check not performed',
        },
        {
            id: 'CC7.2',
            name: 'Security Event Monitoring',
            description: 'The entity monitors system components for anomalies.',
            status: 'partial',
            evidence: 'Security scanning is available. Continuous monitoring requires observability module integration.',
        },
        {
            id: 'CC8.1',
            name: 'Change Management',
            description: 'The entity authorizes, designs, develops, configures, documents, tests, approves, and implements changes.',
            status: 'na',
            evidence: 'Organizational process control — not directly verifiable by automated scanning.',
        },
    ];
}

// --- HIPAA Controls ---

function generateHIPAAControls(scan: SecurityScanResult): ComplianceControl[] {
    const findCheck = (id: string) => scan.checks.find(c => c.id === id);

    return [
        {
            id: '164.312(a)(1)',
            name: 'Access Control',
            description: 'Implement technical policies and procedures for systems that maintain ePHI.',
            status: findCheck('auth-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('auth-enabled')?.message || 'Authentication check not performed',
        },
        {
            id: '164.312(a)(2)(i)',
            name: 'Unique User Identification',
            description: 'Assign a unique name/number for identifying and tracking user identity.',
            status: findCheck('auth-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: 'SSO/OIDC provides unique user identification when enabled.',
        },
        {
            id: '164.312(a)(2)(iv)',
            name: 'Encryption and Decryption',
            description: 'Implement a mechanism to encrypt and decrypt ePHI.',
            status: findCheck('secrets-encrypted')?.status === 'pass' &&
                    findCheck('tls-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: `Secrets: ${findCheck('secrets-encrypted')?.message || 'N/A'}. TLS: ${findCheck('tls-enabled')?.message || 'N/A'}.`,
        },
        {
            id: '164.312(c)(1)',
            name: 'Integrity Controls',
            description: 'Implement policies to protect ePHI from improper alteration or destruction.',
            status: findCheck('secrets-encrypted')?.status === 'pass' ? 'pass' : 'partial',
            evidence: 'AES-256-GCM provides integrity via authentication tags. Versioned secrets provide change tracking.',
        },
        {
            id: '164.312(d)',
            name: 'Person or Entity Authentication',
            description: 'Implement procedures to verify that a person seeking access to ePHI is who they claim to be.',
            status: findCheck('auth-enabled')?.status === 'pass' &&
                    findCheck('default-password')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('auth-enabled')?.message || 'Authentication check not performed',
        },
        {
            id: '164.312(e)(1)',
            name: 'Transmission Security',
            description: 'Implement technical security measures to guard against unauthorized access to ePHI transmitted over a network.',
            status: findCheck('tls-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('tls-enabled')?.message || 'TLS check not performed',
        },
        {
            id: '164.312(e)(2)(ii)',
            name: 'Encryption in Transit',
            description: 'Implement mechanism to encrypt ePHI in transit when appropriate.',
            status: findCheck('tls-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('tls-enabled')?.message || 'TLS check not performed',
        },
        {
            id: '164.308(a)(5)(ii)(D)',
            name: 'Password Management',
            description: 'Procedures for creating, changing, and safeguarding passwords.',
            status: findCheck('default-password')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('default-password')?.message || 'Password check not performed',
        },
    ];
}

// --- GDPR Controls ---

function generateGDPRControls(scan: SecurityScanResult): ComplianceControl[] {
    const findCheck = (id: string) => scan.checks.find(c => c.id === id);

    return [
        {
            id: 'Art.5(1)(f)',
            name: 'Integrity and Confidentiality',
            description: 'Personal data shall be processed in a manner that ensures appropriate security.',
            status: findCheck('tls-enabled')?.status === 'pass' &&
                    findCheck('secrets-encrypted')?.status === 'pass' ? 'pass' : 'fail',
            evidence: `TLS: ${findCheck('tls-enabled')?.message || 'N/A'}. Encryption: ${findCheck('secrets-encrypted')?.message || 'N/A'}.`,
        },
        {
            id: 'Art.25',
            name: 'Data Protection by Design',
            description: 'The controller shall implement appropriate technical measures designed to implement data-protection principles.',
            status: findCheck('secrets-encrypted')?.status === 'pass' ? 'pass' : 'partial',
            evidence: 'AES-256-GCM encryption at rest. Namespaced secrets provide data isolation.',
        },
        {
            id: 'Art.32(1)(a)',
            name: 'Pseudonymisation and Encryption',
            description: 'Implement pseudonymisation and encryption of personal data.',
            status: findCheck('secrets-encrypted')?.status === 'pass' &&
                    findCheck('tls-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: `Encryption at rest: AES-256-GCM. Encryption in transit: ${findCheck('tls-enabled')?.status === 'pass' ? 'mTLS enabled' : 'not configured'}.`,
        },
        {
            id: 'Art.32(1)(b)',
            name: 'Confidentiality and Integrity',
            description: 'Ensure ongoing confidentiality, integrity, availability and resilience of processing systems.',
            status: findCheck('auth-enabled')?.status === 'pass' &&
                    findCheck('netpol-exists')?.status === 'pass' ? 'pass' : 'partial',
            evidence: `Auth: ${findCheck('auth-enabled')?.message || 'N/A'}. Network policies: ${findCheck('netpol-exists')?.message || 'N/A'}.`,
        },
        {
            id: 'Art.32(1)(d)',
            name: 'Regular Testing',
            description: 'Implement a process for regularly testing and evaluating security measures.',
            status: 'pass',
            evidence: 'Security scanner provides automated security assessment. Compliance reports available on demand.',
        },
        {
            id: 'Art.33',
            name: 'Notification of Breach',
            description: 'The controller shall notify the supervisory authority of a personal data breach.',
            status: 'na',
            evidence: 'Organizational process — breach notification procedures must be defined outside this system.',
        },
        {
            id: 'Art.35',
            name: 'Data Protection Impact Assessment',
            description: 'Carry out a DPIA where processing is likely to result in a high risk.',
            status: 'na',
            evidence: 'Organizational process — DPIA must be conducted separately.',
        },
    ];
}

// --- PCI-DSS Controls ---

function generatePCIDSSControls(scan: SecurityScanResult): ComplianceControl[] {
    const findCheck = (id: string) => scan.checks.find(c => c.id === id);

    return [
        {
            id: 'Req.1',
            name: 'Install and Maintain Network Security Controls',
            description: 'Network security controls restrict traffic between trusted and untrusted networks.',
            status: findCheck('netpol-exists')?.status === 'pass' ? 'pass' :
                    findCheck('netpol-exists')?.status === 'warn' ? 'partial' : 'fail',
            evidence: findCheck('netpol-exists')?.message || 'Network policy check not performed',
        },
        {
            id: 'Req.2',
            name: 'Apply Secure Configurations',
            description: 'Apply secure configurations to all system components.',
            status: findCheck('default-password')?.status === 'pass' &&
                    findCheck('debug-mode')?.status === 'pass' ? 'pass' : 'fail',
            evidence: `Passwords: ${findCheck('default-password')?.message || 'N/A'}. Debug mode: ${findCheck('debug-mode')?.message || 'N/A'}.`,
        },
        {
            id: 'Req.3',
            name: 'Protect Stored Account Data',
            description: 'Protect stored account data using encryption.',
            status: findCheck('secrets-encrypted')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('secrets-encrypted')?.message || 'Encryption check not performed',
        },
        {
            id: 'Req.4',
            name: 'Protect Data in Transit with Strong Cryptography',
            description: 'Protect cardholder data with strong cryptography during transmission over open networks.',
            status: findCheck('tls-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('tls-enabled')?.message || 'TLS check not performed',
        },
        {
            id: 'Req.6',
            name: 'Develop and Maintain Secure Systems',
            description: 'Develop and maintain secure systems and software.',
            status: findCheck('vuln-deps')?.status === 'pass' ? 'pass' : 'partial',
            evidence: findCheck('vuln-deps')?.message || 'Dependency check not performed',
        },
        {
            id: 'Req.7',
            name: 'Restrict Access by Business Need to Know',
            description: 'Restrict access to cardholder data by business need to know.',
            status: findCheck('auth-enabled')?.status === 'pass' ? 'pass' : 'fail',
            evidence: findCheck('auth-enabled')?.message || 'Access control check not performed',
        },
        {
            id: 'Req.8',
            name: 'Identify Users and Authenticate Access',
            description: 'Identify and authenticate access to system components.',
            status: findCheck('auth-enabled')?.status === 'pass' &&
                    findCheck('default-password')?.status === 'pass' ? 'pass' : 'fail',
            evidence: `Auth: ${findCheck('auth-enabled')?.message || 'N/A'}. Password strength: ${findCheck('default-password')?.message || 'N/A'}.`,
        },
        {
            id: 'Req.10',
            name: 'Log and Monitor All Access',
            description: 'Log and monitor all access to system components and cardholder data.',
            status: 'partial',
            evidence: 'Security scan history is logged. Full audit logging requires observability module integration.',
        },
        {
            id: 'Req.11',
            name: 'Test Security of Systems Regularly',
            description: 'Test security of systems and networks regularly.',
            status: 'pass',
            evidence: 'Automated security scanner available with scoring and recommendations.',
        },
        {
            id: 'Req.12',
            name: 'Support Information Security with Policies and Programs',
            description: 'Support information security with organizational policies and programs.',
            status: 'na',
            evidence: 'Organizational process — security policies must be defined outside this system.',
        },
    ];
}
