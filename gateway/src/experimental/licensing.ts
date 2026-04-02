// F:\tentaclaw-os\gateway\src\licensing.ts
// License Key System — Free Forever, Pro When Ready
// TentaCLAW says: "Free for the family. Pro for the business. Enterprise for the empire."

/**
 * TentaCLAW Gateway — Licensing Module
 *
 * Provides license key generation, validation, feature gating,
 * node counting, and upgrade prompts. Uses RSA signatures for
 * offline validation. Zero external deps — Node.js crypto only.
 *
 * Tier hierarchy: community -> pro -> enterprise -> enterprise-plus
 *
 * Self-hosted. No SaaS. Your data stays on your hardware.
 * TentaCLAW says: "Free for the family. Pro for the business. Enterprise for the empire."
 */

import { getDb } from './db';
import {
    generateKeyPairSync,
    createSign,
    createVerify,
    randomBytes,
    createHash,
} from 'crypto';
import fs from 'fs';
import path from 'path';

// =============================================================================
// Types & Interfaces
// =============================================================================

export type LicenseTier = 'community' | 'pro' | 'enterprise' | 'enterprise-plus';

export interface License {
    key: string;
    tier: LicenseTier;
    maxNodes: number;
    features: string[];
    issuedTo: string;
    issuedAt: string;
    expiresAt: string | null;
    signature: string;
}

export interface LicenseStatus {
    tier: LicenseTier;
    nodesUsed: number;
    nodesAllowed: number;
    features: string[];
    daysRemaining: number | null;
    valid: boolean;
}

export interface LicenseGenerationOptions {
    expiresInDays?: number;
    maxNodes?: number;
    features?: string[];
}

export interface LicenseValidationResult {
    valid: boolean;
    license: License | null;
    error?: string;
}

export interface NodeLimitWarning {
    message: string;
    nodesUsed: number;
    nodesAllowed: number;
    atLimit: boolean;
}

export interface UpgradePrompt {
    message: string;
    currentTier: LicenseTier;
    suggestedTier: LicenseTier;
    url: string;
}

export interface LockedFeature {
    feature: string;
    availableIn: LicenseTier;
}

export interface LicenseCLIData {
    tier: LicenseTier;
    key: string;
    issuedTo: string;
    nodesUsed: number;
    nodesAllowed: number;
    features: string[];
    lockedFeatures: LockedFeature[];
    daysRemaining: number | null;
    valid: boolean;
    upgradeUrl: string;
}

// =============================================================================
// Constants
// =============================================================================

export const TIER_LIMITS: Record<LicenseTier, { maxNodes: number; features: string[] }> = {
    community: {
        maxNodes: 5,
        features: [
            'dashboard',
            'cli',
            'inference',
            'auto-discovery',
            'monitoring',
            'clawhub-install',
            'flight-sheets',
            'mock-mode',
        ],
    },
    pro: {
        maxNodes: 100,
        features: [
            'dashboard',
            'cli',
            'inference',
            'auto-discovery',
            'monitoring',
            'clawhub-install',
            'flight-sheets',
            'mock-mode',
            'team-rbac',
            'advanced-scheduling',
            'fleet-updates',
            'usage-analytics',
            'api-playground',
            'priority-support',
            'clawhub-publish',
            'fine-tuning',
            'benchmarking',
        ],
    },
    enterprise: {
        maxNodes: 10000,
        features: [
            'dashboard',
            'cli',
            'inference',
            'auto-discovery',
            'monitoring',
            'clawhub-install',
            'flight-sheets',
            'mock-mode',
            'team-rbac',
            'advanced-scheduling',
            'fleet-updates',
            'usage-analytics',
            'api-playground',
            'priority-support',
            'clawhub-publish',
            'fine-tuning',
            'benchmarking',
            'sso-oidc',
            'sso-saml',
            'scim',
            'audit-logs',
            'compliance-reports',
            'multi-tenancy',
            'namespaces',
            'sla-monitoring',
            'siem-export',
            'cloud-burst',
            'federation',
            'dlp',
        ],
    },
    'enterprise-plus': {
        maxNodes: Infinity,
        features: [
            'dashboard',
            'cli',
            'inference',
            'auto-discovery',
            'monitoring',
            'clawhub-install',
            'flight-sheets',
            'mock-mode',
            'team-rbac',
            'advanced-scheduling',
            'fleet-updates',
            'usage-analytics',
            'api-playground',
            'priority-support',
            'clawhub-publish',
            'fine-tuning',
            'benchmarking',
            'sso-oidc',
            'sso-saml',
            'scim',
            'audit-logs',
            'compliance-reports',
            'multi-tenancy',
            'namespaces',
            'sla-monitoring',
            'siem-export',
            'cloud-burst',
            'federation',
            'dlp',
            'dedicated-support',
            'custom-integrations',
            'architecture-review',
            'private-clawhub',
            'white-label',
        ],
    },
};

/** All tiers ordered from lowest to highest. */
const TIER_ORDER: LicenseTier[] = ['community', 'pro', 'enterprise', 'enterprise-plus'];

/** All features across all tiers (union). */
const ALL_FEATURES: string[] = TIER_LIMITS['enterprise-plus'].features;

/** Threshold in seconds for active node counting (5 minutes). */
const ACTIVE_NODE_THRESHOLD_SECS = 300;

/** Default license file path for offline validation. */
const DEFAULT_LICENSE_PATH = process.env.TENTACLAW_LICENSE_PATH
    || '/etc/tentaclaw/license.key';

/** Data directory for keypair storage. */
const DATA_DIR = process.env.TENTACLAW_DATA_DIR || path.join(process.cwd(), 'data');

/** Pricing page URL. */
const PRICING_URL = 'https://tentaclaw.io/pricing';

/** Stripe checkout base URL. */
const CHECKOUT_URL = 'https://tentaclaw.io/checkout';

// =============================================================================
// Schema Initialization
// =============================================================================

let _schemaInitialized = false;

/**
 * Ensure licensing-related DB tables exist. Idempotent — safe to call repeatedly.
 */
function ensureSchema(): void {
    if (_schemaInitialized) return;
    const db = getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS license (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            key TEXT NOT NULL,
            tier TEXT NOT NULL DEFAULT 'community',
            max_nodes INTEGER NOT NULL DEFAULT 5,
            features TEXT NOT NULL DEFAULT '[]',
            issued_to TEXT NOT NULL DEFAULT 'Community User',
            issued_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT,
            signature TEXT NOT NULL DEFAULT '',
            payload TEXT NOT NULL DEFAULT '{}',
            activated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS license_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL,
            tier TEXT NOT NULL,
            issued_to TEXT NOT NULL,
            activated_at TEXT DEFAULT (datetime('now')),
            deactivated_at TEXT
        );
    `);

    // Seed default community license if table is empty
    const existing = db.prepare('SELECT id FROM license WHERE id = 1').get();
    if (!existing) {
        seedCommunityLicense();
    }

    _schemaInitialized = true;
}

// =============================================================================
// RSA Key Pair Management
// =============================================================================

let _cachedPrivateKey: string | null = null;
let _cachedPublicKey: string | null = null;

/**
 * Get or generate the RSA key pair for license signing.
 * Keys are stored in the data directory or read from environment variables.
 */
function getKeyPair(): { privateKey: string; publicKey: string } {
    if (_cachedPrivateKey && _cachedPublicKey) {
        return { privateKey: _cachedPrivateKey, publicKey: _cachedPublicKey };
    }

    // Check environment variables first
    const envPrivate = process.env.TENTACLAW_LICENSE_PRIVATE_KEY;
    const envPublic = process.env.TENTACLAW_LICENSE_PUBLIC_KEY;
    if (envPrivate && envPublic) {
        _cachedPrivateKey = envPrivate;
        _cachedPublicKey = envPublic;
        return { privateKey: envPrivate, publicKey: envPublic };
    }

    // Check file system
    const privateKeyPath = path.join(DATA_DIR, 'license_private.pem');
    const publicKeyPath = path.join(DATA_DIR, 'license_public.pem');

    if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
        _cachedPrivateKey = fs.readFileSync(privateKeyPath, 'utf8');
        _cachedPublicKey = fs.readFileSync(publicKeyPath, 'utf8');
        return { privateKey: _cachedPrivateKey, publicKey: _cachedPublicKey };
    }

    // Generate new key pair
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Persist to disk
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

    _cachedPrivateKey = privateKey;
    _cachedPublicKey = publicKey;
    return { privateKey, publicKey };
}

/**
 * Get the public key only (safe to distribute to nodes for offline verification).
 */
export function getPublicKey(): string {
    return getKeyPair().publicKey;
}

// =============================================================================
// License Key Generation
// =============================================================================

/**
 * Generate a unique license key string.
 * Format: TC-{TIER}-{RANDOM}-{CHECKSUM}
 *
 * Example: TC-PRO-A7F3B9C2E1D4-X8K2
 */
function generateKeyString(tier: LicenseTier): string {
    const tierCode = tier.toUpperCase().replace('-', '');
    const random = randomBytes(6).toString('hex').toUpperCase();
    const raw = `TC-${tierCode}-${random}`;
    const checksum = createHash('sha256')
        .update(raw)
        .digest('hex')
        .slice(0, 4)
        .toUpperCase();
    return `${raw}-${checksum}`;
}

/**
 * Sign a license payload with the private key.
 */
function signPayload(payload: string): string {
    const { privateKey } = getKeyPair();
    const sign = createSign('SHA256');
    sign.update(payload);
    sign.end();
    return sign.sign(privateKey, 'base64');
}

/**
 * Verify a signature against a payload using the public key.
 */
function verifySignature(payload: string, signature: string): boolean {
    const { publicKey } = getKeyPair();
    const verify = createVerify('SHA256');
    verify.update(payload);
    verify.end();
    try {
        return verify.verify(publicKey, signature, 'base64');
    } catch {
        return false;
    }
}

/**
 * Generate a complete RSA-signed license key for a given tier.
 *
 * @param tier - The license tier
 * @param issuedTo - Customer name or email
 * @param options - Optional overrides for expiry, maxNodes, features
 * @returns The generated License object
 */
export function generateLicenseKey(
    tier: LicenseTier,
    issuedTo: string,
    options?: LicenseGenerationOptions,
): License {
    const key = generateKeyString(tier);
    const tierLimits = TIER_LIMITS[tier];

    const maxNodes = options?.maxNodes ?? tierLimits.maxNodes;
    const features = options?.features ?? tierLimits.features;
    const issuedAt = new Date().toISOString();
    const expiresAt = options?.expiresInDays
        ? new Date(Date.now() + options.expiresInDays * 86_400_000).toISOString()
        : tier === 'community' ? null : new Date(Date.now() + 365 * 86_400_000).toISOString();

    const payload = JSON.stringify({
        key,
        tier,
        maxNodes,
        features,
        issuedTo,
        issuedAt,
        expiresAt,
    });

    const signature = signPayload(payload);

    return {
        key,
        tier,
        maxNodes,
        features,
        issuedTo,
        issuedAt,
        expiresAt,
        signature,
    };
}

// =============================================================================
// License Validation
// =============================================================================

/**
 * Validate a license by verifying its RSA signature and checking expiry.
 */
export function validateLicense(license: License): LicenseValidationResult {
    // Rebuild the payload that was signed
    const payload = JSON.stringify({
        key: license.key,
        tier: license.tier,
        maxNodes: license.maxNodes,
        features: license.features,
        issuedTo: license.issuedTo,
        issuedAt: license.issuedAt,
        expiresAt: license.expiresAt,
    });

    // Verify RSA signature (skip for default community key with empty signature)
    if (license.signature && !verifySignature(payload, license.signature)) {
        return { valid: false, license: null, error: 'Invalid license signature' };
    }

    // Check expiry
    if (license.expiresAt) {
        const expiryDate = new Date(license.expiresAt);
        if (expiryDate.getTime() < Date.now()) {
            return { valid: false, license, error: 'License has expired' };
        }
    }

    // Verify tier is recognized
    if (!TIER_LIMITS[license.tier]) {
        return { valid: false, license: null, error: `Unknown license tier: ${license.tier}` };
    }

    return { valid: true, license };
}

/**
 * Validate a license from a file on disk (offline validation).
 * Reads the license JSON from the specified path (or default /etc/tentaclaw/license.key),
 * verifies the RSA signature without any network call.
 */
export function validateLicenseOffline(keyFilePath?: string): LicenseValidationResult {
    const filePath = keyFilePath || DEFAULT_LICENSE_PATH;

    if (!fs.existsSync(filePath)) {
        return { valid: false, license: null, error: `License file not found: ${filePath}` };
    }

    let licenseData: License;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        licenseData = JSON.parse(raw) as License;
    } catch {
        return { valid: false, license: null, error: 'Failed to parse license file' };
    }

    return validateLicense(licenseData);
}

/**
 * Get the currently active license from the database.
 */
export function getCurrentLicense(): License {
    ensureSchema();
    const db = getDb();

    const row = db.prepare(`
        SELECT key, tier, max_nodes, features, issued_to, issued_at, expires_at, signature
        FROM license WHERE id = 1
    `).get() as {
        key: string;
        tier: LicenseTier;
        max_nodes: number;
        features: string;
        issued_to: string;
        issued_at: string;
        expires_at: string | null;
        signature: string;
    } | undefined;

    if (!row) {
        // Should not happen because ensureSchema seeds community, but be safe
        return getDefaultCommunityLicense();
    }

    return {
        key: row.key,
        tier: row.tier,
        maxNodes: row.max_nodes,
        features: JSON.parse(row.features),
        issuedTo: row.issued_to,
        issuedAt: row.issued_at,
        expiresAt: row.expires_at,
        signature: row.signature,
    };
}

/**
 * Get a full license status report.
 */
export function getLicenseStatus(): LicenseStatus {
    const license = getCurrentLicense();
    const nodesUsed = getActiveNodeCount();
    const validation = validateLicense(license);

    let daysRemaining: number | null = null;
    if (license.expiresAt) {
        const msRemaining = new Date(license.expiresAt).getTime() - Date.now();
        daysRemaining = Math.max(0, Math.ceil(msRemaining / 86_400_000));
    }

    return {
        tier: license.tier,
        nodesUsed,
        nodesAllowed: license.maxNodes,
        features: license.features,
        daysRemaining,
        valid: validation.valid,
    };
}

// =============================================================================
// License Activation
// =============================================================================

/**
 * Activate a license key by storing it in the database.
 * Validates the license before activation.
 */
export function activateLicense(license: License): LicenseValidationResult {
    const validation = validateLicense(license);
    if (!validation.valid) {
        return validation;
    }

    ensureSchema();
    const db = getDb();

    // Archive the current license
    const current = db.prepare('SELECT key, tier, issued_to, activated_at FROM license WHERE id = 1').get() as {
        key: string;
        tier: string;
        issued_to: string;
        activated_at: string;
    } | undefined;

    if (current) {
        db.prepare(`
            INSERT INTO license_history (key, tier, issued_to, activated_at, deactivated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
        `).run(current.key, current.tier, current.issued_to, current.activated_at);
    }

    // Store the payload as JSON for reference
    const payload = JSON.stringify({
        key: license.key,
        tier: license.tier,
        maxNodes: license.maxNodes,
        features: license.features,
        issuedTo: license.issuedTo,
        issuedAt: license.issuedAt,
        expiresAt: license.expiresAt,
    });

    // Upsert the active license
    db.prepare(`
        INSERT INTO license (id, key, tier, max_nodes, features, issued_to, issued_at, expires_at, signature, payload, activated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            key = excluded.key,
            tier = excluded.tier,
            max_nodes = excluded.max_nodes,
            features = excluded.features,
            issued_to = excluded.issued_to,
            issued_at = excluded.issued_at,
            expires_at = excluded.expires_at,
            signature = excluded.signature,
            payload = excluded.payload,
            activated_at = datetime('now')
    `).run(
        license.key,
        license.tier,
        license.maxNodes,
        JSON.stringify(license.features),
        license.issuedTo,
        license.issuedAt,
        license.expiresAt,
        license.signature,
        payload,
    );

    return { valid: true, license };
}

// =============================================================================
// Node Counting
// =============================================================================

/**
 * Count nodes that have reported stats within the last 5 minutes.
 */
export function getActiveNodeCount(): number {
    ensureSchema();
    const db = getDb();

    const cutoff = new Date(Date.now() - ACTIVE_NODE_THRESHOLD_SECS * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);

    const row = db.prepare(`
        SELECT COUNT(*) as count FROM nodes
        WHERE status = 'online' AND last_seen_at >= ?
    `).get(cutoff) as { count: number };

    return row.count;
}

/**
 * Check if the current license node limit has been reached.
 */
export function isNodeLimitReached(): boolean {
    const license = getCurrentLicense();
    const activeNodes = getActiveNodeCount();
    return activeNodes >= license.maxNodes;
}

/**
 * Get a human-readable node limit warning.
 */
export function getNodeLimitWarning(): NodeLimitWarning {
    const license = getCurrentLicense();
    const nodesUsed = getActiveNodeCount();
    const nodesAllowed = license.maxNodes;
    const atLimit = nodesUsed >= nodesAllowed;

    let message: string;
    if (atLimit) {
        const nextTier = getNextTier(license.tier);
        if (nextTier) {
            const nextLimit = TIER_LIMITS[nextTier].maxNodes;
            const limitStr = nextLimit === Infinity ? 'unlimited' : String(nextLimit);
            message = `${nodesUsed}/${nodesAllowed} nodes used. Upgrade to ${nextTier} for ${limitStr} nodes.`;
        } else {
            message = `${nodesUsed}/${nodesAllowed} nodes used. You are on the highest tier.`;
        }
    } else {
        message = `${nodesUsed}/${nodesAllowed} nodes used`;
    }

    return { message, nodesUsed, nodesAllowed, atLimit };
}

// =============================================================================
// Feature Gating
// =============================================================================

/**
 * Check if a feature is enabled under the current license.
 */
export function isFeatureEnabled(feature: string): boolean {
    const license = getCurrentLicense();
    return license.features.includes(feature);
}

/**
 * Middleware-style check: returns null if licensed, or an error response object
 * with a 403-style message if not.
 */
export function requireFeature(feature: string): { status: 403; error: string; upgradeUrl: string } | null {
    if (isFeatureEnabled(feature)) {
        return null;
    }

    const license = getCurrentLicense();
    const requiredTier = getFeatureTier(feature);
    const tierLabel = requiredTier || 'a higher';

    return {
        status: 403,
        error: `Feature "${feature}" requires a ${tierLabel} license. Current tier: ${license.tier}.`,
        upgradeUrl: getUpgradeUrl(),
    };
}

/**
 * List all features that are available on higher tiers but locked on the current license.
 */
export function getLockedFeatures(): LockedFeature[] {
    const license = getCurrentLicense();
    const enabledSet = new Set(license.features);
    const locked: LockedFeature[] = [];

    for (const feature of ALL_FEATURES) {
        if (!enabledSet.has(feature)) {
            const availableIn = getFeatureTier(feature);
            if (availableIn) {
                locked.push({ feature, availableIn });
            }
        }
    }

    return locked;
}

// =============================================================================
// Upgrade Prompts
// =============================================================================

/**
 * Get a context-aware upgrade prompt based on current usage and limits.
 */
export function getUpgradePrompt(): UpgradePrompt | null {
    const license = getCurrentLicense();
    const nodesUsed = getActiveNodeCount();
    const nextTier = getNextTier(license.tier);

    if (!nextTier) {
        return null; // Already on highest tier
    }

    let message: string;
    const nodeRatio = license.maxNodes > 0 ? nodesUsed / license.maxNodes : 0;

    if (nodeRatio >= 1) {
        message = `You're at ${nodesUsed}/${license.maxNodes} nodes. Upgrade to ${nextTier} to add more nodes and unlock advanced features.`;
    } else if (nodeRatio >= 0.8) {
        message = `You're using ${nodesUsed}/${license.maxNodes} nodes. Getting close! Upgrade to ${nextTier} for more capacity.`;
    } else {
        const lockedCount = getLockedFeatures().length;
        if (lockedCount > 0) {
            message = `Unlock ${lockedCount} additional features with ${nextTier}. Visit ${PRICING_URL} for details.`;
        } else {
            return null; // No reason to prompt
        }
    }

    return {
        message,
        currentTier: license.tier,
        suggestedTier: nextTier,
        url: getUpgradeUrl(),
    };
}

/**
 * Get the upgrade/pricing URL.
 */
export function getUpgradeUrl(): string {
    const license = getCurrentLicense();
    return `${PRICING_URL}?current=${license.tier}`;
}

/**
 * Get the Stripe checkout URL for a specific tier.
 */
export function getCheckoutUrl(tier: LicenseTier): string {
    return `${CHECKOUT_URL}?tier=${tier}`;
}

// =============================================================================
// License CLI Data Export
// =============================================================================

/**
 * Export license data formatted for CLI display.
 * Used by: `tentaclaw license status`
 */
export function getLicenseCLIData(): LicenseCLIData {
    const license = getCurrentLicense();
    const status = getLicenseStatus();
    const lockedFeatures = getLockedFeatures();

    return {
        tier: license.tier,
        key: maskKey(license.key),
        issuedTo: license.issuedTo,
        nodesUsed: status.nodesUsed,
        nodesAllowed: status.nodesAllowed,
        features: license.features,
        lockedFeatures,
        daysRemaining: status.daysRemaining,
        valid: status.valid,
        upgradeUrl: getUpgradeUrl(),
    };
}

// =============================================================================
// License API Route Handlers
// =============================================================================

/**
 * GET /api/v1/license -- current license status
 */
export function handleGetLicense(): {
    status: number;
    body: LicenseStatus & { key: string; issuedTo: string };
} {
    const license = getCurrentLicense();
    const status = getLicenseStatus();

    return {
        status: 200,
        body: {
            ...status,
            key: maskKey(license.key),
            issuedTo: license.issuedTo,
        },
    };
}

/**
 * POST /api/v1/license/activate -- activate a license key
 */
export function handleActivateLicense(licensePayload: License): {
    status: number;
    body: { success: boolean; license?: LicenseStatus; error?: string };
} {
    const result = activateLicense(licensePayload);

    if (!result.valid) {
        return {
            status: 400,
            body: { success: false, error: result.error },
        };
    }

    const status = getLicenseStatus();
    return {
        status: 200,
        body: { success: true, license: status },
    };
}

/**
 * GET /api/v1/license/features -- available and locked features
 */
export function handleGetFeatures(): {
    status: number;
    body: {
        enabled: string[];
        locked: LockedFeature[];
        upgrade: UpgradePrompt | null;
    };
} {
    const license = getCurrentLicense();
    const locked = getLockedFeatures();
    const upgrade = getUpgradePrompt();

    return {
        status: 200,
        body: {
            enabled: license.features,
            locked,
            upgrade,
        },
    };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Seed the default community license.
 */
function seedCommunityLicense(): void {
    const db = getDb();
    const communityFeatures = TIER_LIMITS.community.features;

    db.prepare(`
        INSERT OR IGNORE INTO license (id, key, tier, max_nodes, features, issued_to, issued_at, expires_at, signature, payload)
        VALUES (1, ?, 'community', 5, ?, 'Community User', datetime('now'), NULL, '', '{}')
    `).run(
        'TC-COMMUNITY-000000000000-0000',
        JSON.stringify(communityFeatures),
    );
}

/**
 * Get the default community license object (fallback).
 */
function getDefaultCommunityLicense(): License {
    return {
        key: 'TC-COMMUNITY-000000000000-0000',
        tier: 'community',
        maxNodes: TIER_LIMITS.community.maxNodes,
        features: TIER_LIMITS.community.features,
        issuedTo: 'Community User',
        issuedAt: new Date().toISOString(),
        expiresAt: null,
        signature: '',
    };
}

/**
 * Get the next tier above the given tier, or null if already at highest.
 */
function getNextTier(current: LicenseTier): LicenseTier | null {
    const idx = TIER_ORDER.indexOf(current);
    if (idx < 0 || idx >= TIER_ORDER.length - 1) return null;
    return TIER_ORDER[idx + 1];
}

/**
 * Determine which tier first includes a given feature.
 */
function getFeatureTier(feature: string): LicenseTier | null {
    for (const tier of TIER_ORDER) {
        if (TIER_LIMITS[tier].features.includes(feature)) {
            return tier;
        }
    }
    return null;
}

/**
 * Mask a license key for safe display: TC-PRO-A7F3...E1D4-X8K2
 */
function maskKey(key: string): string {
    // Format: TC-TIER-RANDOM-CHECKSUM
    const parts = key.split('-');
    if (parts.length < 3) return key;

    // Find the random segment (the longest hex segment)
    // For TC-COMMUNITY-000000000000-0000 -> TC-COMMUNITY-0000...0000-0000
    // For TC-PRO-A7F3B9C2E1D4-X8K2 -> TC-PRO-A7F3...E1D4-X8K2
    const prefix = parts.slice(0, 2).join('-');
    const checksum = parts[parts.length - 1];
    const middle = parts.slice(2, parts.length - 1).join('-');

    if (middle.length <= 8) {
        return `${prefix}-${middle}-${checksum}`;
    }

    const masked = `${middle.slice(0, 4)}...${middle.slice(-4)}`;
    return `${prefix}-${masked}-${checksum}`;
}

/**
 * Reset the schema initialization flag (for testing).
 */
export function _resetSchemaFlag(): void {
    _schemaInitialized = false;
}

/**
 * Reset the cached key pair (for testing).
 */
export function _resetKeyPairCache(): void {
    _cachedPrivateKey = null;
    _cachedPublicKey = null;
}
