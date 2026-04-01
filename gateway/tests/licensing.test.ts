/**
 * TentaCLAW Gateway -- Licensing Tests
 *
 * Tests the licensing module: key generation, RSA validation, feature gating,
 * node counting, upgrade prompts, activation, and API route handlers.
 * Uses in-memory SQLite; keypair is generated fresh per test suite.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use in-memory DB for tests
process.env.TENTACLAW_DB_PATH = ':memory:';

// Use a temp directory for license keypair so tests don't pollute the real data dir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tentaclaw-license-test-'));
process.env.TENTACLAW_DATA_DIR = tmpDir;

import { getDb } from '../src/db';

import {
    generateLicenseKey,
    validateLicense,
    validateLicenseOffline,
    getCurrentLicense,
    getLicenseStatus,
    activateLicense,
    getActiveNodeCount,
    isNodeLimitReached,
    getNodeLimitWarning,
    isFeatureEnabled,
    requireFeature,
    getLockedFeatures,
    getUpgradePrompt,
    getUpgradeUrl,
    getCheckoutUrl,
    getLicenseCLIData,
    handleGetLicense,
    handleActivateLicense,
    handleGetFeatures,
    getPublicKey,
    TIER_LIMITS,
    _resetSchemaFlag,
    _resetKeyPairCache,
} from '../src/experimental/licensing';

import type {
    License,
} from '../src/experimental/licensing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanLicenseTables() {
    const db = getDb();
    try {
        db.exec(`
            DELETE FROM license;
            DELETE FROM license_history;
        `);
    } catch {
        // Tables may not exist yet
    }
}

function insertFakeNode(id: string, status: string = 'online', minutesAgo: number = 0): void {
    const db = getDb();
    const lastSeen = new Date(Date.now() - minutesAgo * 60_000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);

    db.prepare(`
        INSERT OR REPLACE INTO nodes (id, farm_hash, hostname, status, last_seen_at, gpu_count)
        VALUES (?, 'test-farm', ?, ?, ?, 1)
    `).run(id, `node-${id}`, status, lastSeen);
}

function cleanNodes() {
    const db = getDb();
    try {
        db.exec('DELETE FROM nodes');
    } catch {
        // Table may not exist
    }
}

// Suppress unused import warnings
void _resetKeyPairCache;

// ---------------------------------------------------------------------------
// 1. License Key Generation
// ---------------------------------------------------------------------------

describe('License Key Generation', () => {
    beforeEach(() => {
        cleanLicenseTables();
        _resetSchemaFlag();
    });

    it('generates a community license with correct format', () => {
        const license = generateLicenseKey('community', 'test@example.com');
        expect(license.key).toMatch(/^TC-COMMUNITY-[A-F0-9]{12}-[A-F0-9]{4}$/);
        expect(license.tier).toBe('community');
        expect(license.maxNodes).toBe(5);
        expect(license.issuedTo).toBe('test@example.com');
        expect(license.expiresAt).toBeNull(); // community = perpetual
        expect(license.signature).toBeTruthy();
        expect(license.features).toEqual(TIER_LIMITS.community.features);
    });

    it('generates a pro license with 1-year expiry', () => {
        const license = generateLicenseKey('pro', 'pro@company.com');
        expect(license.key).toMatch(/^TC-PRO-[A-F0-9]{12}-[A-F0-9]{4}$/);
        expect(license.tier).toBe('pro');
        expect(license.maxNodes).toBe(100);
        expect(license.expiresAt).not.toBeNull();
        // Should expire roughly 365 days from now
        const daysUntilExpiry = (new Date(license.expiresAt!).getTime() - Date.now()) / 86_400_000;
        expect(daysUntilExpiry).toBeGreaterThan(364);
        expect(daysUntilExpiry).toBeLessThan(366);
    });

    it('generates an enterprise license', () => {
        const license = generateLicenseKey('enterprise', 'enterprise@megacorp.com');
        expect(license.key).toMatch(/^TC-ENTERPRISE-[A-F0-9]{12}-[A-F0-9]{4}$/);
        expect(license.tier).toBe('enterprise');
        expect(license.maxNodes).toBe(10000);
        expect(license.features).toContain('sso-oidc');
        expect(license.features).toContain('audit-logs');
    });

    it('generates an enterprise-plus license', () => {
        const license = generateLicenseKey('enterprise-plus', 'vip@megacorp.com');
        expect(license.key).toMatch(/^TC-ENTERPRISEPLUS-[A-F0-9]{12}-[A-F0-9]{4}$/);
        expect(license.tier).toBe('enterprise-plus');
        expect(license.maxNodes).toBe(Infinity);
        expect(license.features).toContain('white-label');
        expect(license.features).toContain('dedicated-support');
    });

    it('accepts custom options for expiry and maxNodes', () => {
        const license = generateLicenseKey('pro', 'custom@test.com', {
            expiresInDays: 30,
            maxNodes: 50,
        });
        expect(license.maxNodes).toBe(50);
        const daysUntilExpiry = (new Date(license.expiresAt!).getTime() - Date.now()) / 86_400_000;
        expect(daysUntilExpiry).toBeGreaterThan(29);
        expect(daysUntilExpiry).toBeLessThan(31);
    });

    it('accepts custom feature list', () => {
        const customFeatures = ['dashboard', 'cli', 'custom-thing'];
        const license = generateLicenseKey('pro', 'custom@test.com', {
            features: customFeatures,
        });
        expect(license.features).toEqual(customFeatures);
    });

    it('generates unique keys', () => {
        const keys = new Set<string>();
        for (let i = 0; i < 20; i++) {
            const license = generateLicenseKey('community', `user${i}@test.com`);
            keys.add(license.key);
        }
        expect(keys.size).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// 2. License Validation (RSA)
// ---------------------------------------------------------------------------

describe('License Validation', () => {
    beforeEach(() => {
        cleanLicenseTables();
        _resetSchemaFlag();
    });

    it('validates a correctly signed license', () => {
        const license = generateLicenseKey('pro', 'valid@test.com');
        const result = validateLicense(license);
        expect(result.valid).toBe(true);
        expect(result.license).not.toBeNull();
        expect(result.error).toBeUndefined();
    });

    it('rejects a license with tampered signature', () => {
        const license = generateLicenseKey('pro', 'tamper@test.com');
        license.signature = 'INVALID_SIGNATURE_DATA';
        const result = validateLicense(license);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid license signature');
    });

    it('rejects a license with tampered tier', () => {
        const license = generateLicenseKey('community', 'tamper@test.com');
        // Tamper: change tier after signing
        (license as Record<string, unknown>).tier = 'enterprise';
        const result = validateLicense(license);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid license signature');
    });

    it('rejects a license with tampered maxNodes', () => {
        const license = generateLicenseKey('community', 'tamper@test.com');
        license.maxNodes = 99999;
        const result = validateLicense(license);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid license signature');
    });

    it('rejects an expired license', () => {
        const license = generateLicenseKey('pro', 'expired@test.com', {
            expiresInDays: -1, // already expired
        });
        const result = validateLicense(license);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('License has expired');
    });

    it('accepts a community license with null expiry (perpetual)', () => {
        const license = generateLicenseKey('community', 'forever@test.com');
        expect(license.expiresAt).toBeNull();
        const result = validateLicense(license);
        expect(result.valid).toBe(true);
    });

    it('validates the default community license (empty signature)', () => {
        // The default seeded community license has an empty signature
        const defaultLicense: License = {
            key: 'TC-COMMUNITY-000000000000-0000',
            tier: 'community',
            maxNodes: 5,
            features: TIER_LIMITS.community.features,
            issuedTo: 'Community User',
            issuedAt: new Date().toISOString(),
            expiresAt: null,
            signature: '',
        };
        const result = validateLicense(defaultLicense);
        expect(result.valid).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 3. Offline Validation
// ---------------------------------------------------------------------------

describe('Offline License Validation', () => {
    const testLicensePath = path.join(tmpDir, 'test-license.key');

    beforeEach(() => {
        cleanLicenseTables();
        _resetSchemaFlag();
        if (fs.existsSync(testLicensePath)) {
            fs.unlinkSync(testLicensePath);
        }
    });

    it('validates a license file on disk', () => {
        const license = generateLicenseKey('pro', 'offline@test.com');
        fs.writeFileSync(testLicensePath, JSON.stringify(license));

        const result = validateLicenseOffline(testLicensePath);
        expect(result.valid).toBe(true);
        expect(result.license).not.toBeNull();
        expect(result.license!.tier).toBe('pro');
    });

    it('returns error for missing file', () => {
        const result = validateLicenseOffline('/nonexistent/path/license.key');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('returns error for invalid JSON', () => {
        fs.writeFileSync(testLicensePath, 'NOT VALID JSON {{{');
        const result = validateLicenseOffline(testLicensePath);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Failed to parse');
    });

    it('returns error for tampered license file', () => {
        const license = generateLicenseKey('pro', 'tamper@test.com');
        license.maxNodes = 999999;
        fs.writeFileSync(testLicensePath, JSON.stringify(license));

        const result = validateLicenseOffline(testLicensePath);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid license signature');
    });
});

// ---------------------------------------------------------------------------
// 4. Current License & Status
// ---------------------------------------------------------------------------

describe('Current License & Status', () => {
    beforeEach(() => {
        cleanLicenseTables();
        cleanNodes();
        _resetSchemaFlag();
    });

    it('defaults to community tier on first boot', () => {
        const license = getCurrentLicense();
        expect(license.tier).toBe('community');
        expect(license.maxNodes).toBe(5);
        expect(license.issuedTo).toBe('Community User');
        expect(license.expiresAt).toBeNull();
    });

    it('returns correct license status', () => {
        const status = getLicenseStatus();
        expect(status.tier).toBe('community');
        expect(status.nodesUsed).toBe(0);
        expect(status.nodesAllowed).toBe(5);
        expect(status.features).toEqual(TIER_LIMITS.community.features);
        expect(status.daysRemaining).toBeNull(); // perpetual
        expect(status.valid).toBe(true);
    });

    it('reflects activated license in status', () => {
        const proLicense = generateLicenseKey('pro', 'pro@test.com', { expiresInDays: 90 });
        activateLicense(proLicense);

        const status = getLicenseStatus();
        expect(status.tier).toBe('pro');
        expect(status.nodesAllowed).toBe(100);
        expect(status.daysRemaining).toBeGreaterThan(89);
        expect(status.daysRemaining).toBeLessThanOrEqual(90);
    });
});

// ---------------------------------------------------------------------------
// 5. License Activation
// ---------------------------------------------------------------------------

describe('License Activation', () => {
    beforeEach(() => {
        cleanLicenseTables();
        cleanNodes();
        _resetSchemaFlag();
    });

    it('activates a valid license', () => {
        const license = generateLicenseKey('pro', 'activate@test.com');
        const result = activateLicense(license);
        expect(result.valid).toBe(true);

        const current = getCurrentLicense();
        expect(current.tier).toBe('pro');
        expect(current.issuedTo).toBe('activate@test.com');
    });

    it('rejects an invalid license', () => {
        const license = generateLicenseKey('pro', 'bad@test.com');
        license.signature = 'TAMPERED';
        const result = activateLicense(license);
        expect(result.valid).toBe(false);

        // Should still be community
        const current = getCurrentLicense();
        expect(current.tier).toBe('community');
    });

    it('archives previous license on upgrade', () => {
        const db = getDb();

        // Activate pro
        const proLicense = generateLicenseKey('pro', 'pro@test.com');
        activateLicense(proLicense);

        // Upgrade to enterprise
        const entLicense = generateLicenseKey('enterprise', 'ent@test.com');
        activateLicense(entLicense);

        const current = getCurrentLicense();
        expect(current.tier).toBe('enterprise');

        // Check history
        const history = db.prepare('SELECT * FROM license_history ORDER BY id').all() as Array<{
            key: string;
            tier: string;
        }>;
        // First entry: the community that was replaced by pro
        // Second entry: the pro that was replaced by enterprise
        expect(history.length).toBe(2);
        expect(history[0].tier).toBe('community');
        expect(history[1].tier).toBe('pro');
    });

    it('rejects expired license activation', () => {
        const license = generateLicenseKey('pro', 'expired@test.com', {
            expiresInDays: -1,
        });
        const result = activateLicense(license);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('License has expired');
    });
});

// ---------------------------------------------------------------------------
// 6. Node Counting
// ---------------------------------------------------------------------------

describe('Node Counting', () => {
    beforeEach(() => {
        cleanLicenseTables();
        cleanNodes();
        _resetSchemaFlag();
    });

    it('counts zero nodes when none exist', () => {
        expect(getActiveNodeCount()).toBe(0);
    });

    it('counts online nodes seen recently', () => {
        insertFakeNode('node-1', 'online', 1); // 1 minute ago
        insertFakeNode('node-2', 'online', 2); // 2 minutes ago
        insertFakeNode('node-3', 'online', 3); // 3 minutes ago
        expect(getActiveNodeCount()).toBe(3);
    });

    it('excludes offline nodes', () => {
        insertFakeNode('node-1', 'online', 1);
        insertFakeNode('node-2', 'offline', 1);
        expect(getActiveNodeCount()).toBe(1);
    });

    it('excludes nodes not seen in 5+ minutes', () => {
        insertFakeNode('node-1', 'online', 1);  // recent
        insertFakeNode('node-2', 'online', 10); // stale (10 min ago)
        expect(getActiveNodeCount()).toBe(1);
    });

    it('isNodeLimitReached returns false when under limit', () => {
        insertFakeNode('node-1', 'online', 1);
        expect(isNodeLimitReached()).toBe(false); // community = 5, using 1
    });

    it('isNodeLimitReached returns true at limit', () => {
        for (let i = 0; i < 5; i++) {
            insertFakeNode(`node-${i}`, 'online', 1);
        }
        expect(isNodeLimitReached()).toBe(true); // community = 5, using 5
    });
});

// ---------------------------------------------------------------------------
// 7. Node Limit Warnings
// ---------------------------------------------------------------------------

describe('Node Limit Warnings', () => {
    beforeEach(() => {
        cleanLicenseTables();
        cleanNodes();
        _resetSchemaFlag();
    });

    it('shows usage when under limit', () => {
        insertFakeNode('node-1', 'online', 1);
        insertFakeNode('node-2', 'online', 1);
        const warning = getNodeLimitWarning();
        expect(warning.message).toBe('2/5 nodes used');
        expect(warning.nodesUsed).toBe(2);
        expect(warning.nodesAllowed).toBe(5);
        expect(warning.atLimit).toBe(false);
    });

    it('shows upgrade prompt at limit', () => {
        for (let i = 0; i < 5; i++) {
            insertFakeNode(`node-${i}`, 'online', 1);
        }
        const warning = getNodeLimitWarning();
        expect(warning.atLimit).toBe(true);
        expect(warning.message).toContain('Upgrade to pro');
        expect(warning.message).toContain('100');
    });

    it('shows highest-tier message for enterprise-plus', () => {
        const license = generateLicenseKey('enterprise-plus', 'vip@test.com');
        activateLicense(license);

        // Even though enterprise-plus has Infinity maxNodes, at 0/Infinity not at limit
        const warning = getNodeLimitWarning();
        expect(warning.atLimit).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 8. Feature Gating
// ---------------------------------------------------------------------------

describe('Feature Gating', () => {
    beforeEach(() => {
        cleanLicenseTables();
        cleanNodes();
        _resetSchemaFlag();
    });

    it('community has dashboard enabled', () => {
        expect(isFeatureEnabled('dashboard')).toBe(true);
    });

    it('community has cli enabled', () => {
        expect(isFeatureEnabled('cli')).toBe(true);
    });

    it('community does not have team-rbac', () => {
        expect(isFeatureEnabled('team-rbac')).toBe(false);
    });

    it('community does not have sso-oidc', () => {
        expect(isFeatureEnabled('sso-oidc')).toBe(false);
    });

    it('pro has team-rbac after activation', () => {
        const license = generateLicenseKey('pro', 'pro@test.com');
        activateLicense(license);
        expect(isFeatureEnabled('team-rbac')).toBe(true);
    });

    it('requireFeature returns null for enabled features', () => {
        expect(requireFeature('dashboard')).toBeNull();
    });

    it('requireFeature returns 403 object for locked features', () => {
        const result = requireFeature('sso-oidc');
        expect(result).not.toBeNull();
        expect(result!.status).toBe(403);
        expect(result!.error).toContain('sso-oidc');
        expect(result!.error).toContain('enterprise');
        expect(result!.upgradeUrl).toContain('tentaclaw.io/pricing');
    });

    it('getLockedFeatures lists features from higher tiers', () => {
        const locked = getLockedFeatures();
        expect(locked.length).toBeGreaterThan(0);

        // team-rbac should be locked (it is a pro feature)
        const teamRbac = locked.find(f => f.feature === 'team-rbac');
        expect(teamRbac).toBeDefined();
        expect(teamRbac!.availableIn).toBe('pro');

        // sso-oidc should be locked (it is an enterprise feature)
        const sso = locked.find(f => f.feature === 'sso-oidc');
        expect(sso).toBeDefined();
        expect(sso!.availableIn).toBe('enterprise');
    });

    it('pro has fewer locked features than community', () => {
        const communityLocked = getLockedFeatures();

        const license = generateLicenseKey('pro', 'pro@test.com');
        activateLicense(license);
        const proLocked = getLockedFeatures();

        expect(proLocked.length).toBeLessThan(communityLocked.length);
    });

    it('enterprise-plus has no locked features', () => {
        const license = generateLicenseKey('enterprise-plus', 'vip@test.com');
        activateLicense(license);
        const locked = getLockedFeatures();
        expect(locked.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 9. Upgrade Prompts
// ---------------------------------------------------------------------------

describe('Upgrade Prompts', () => {
    beforeEach(() => {
        cleanLicenseTables();
        cleanNodes();
        _resetSchemaFlag();
    });

    it('shows upgrade prompt for community with locked features', () => {
        const prompt = getUpgradePrompt();
        expect(prompt).not.toBeNull();
        expect(prompt!.currentTier).toBe('community');
        expect(prompt!.suggestedTier).toBe('pro');
        expect(prompt!.url).toContain('tentaclaw.io/pricing');
    });

    it('shows capacity warning at node limit', () => {
        for (let i = 0; i < 5; i++) {
            insertFakeNode(`node-${i}`, 'online', 1);
        }
        const prompt = getUpgradePrompt();
        expect(prompt).not.toBeNull();
        expect(prompt!.message).toContain('5/5 nodes');
    });

    it('returns null for enterprise-plus (highest tier)', () => {
        const license = generateLicenseKey('enterprise-plus', 'vip@test.com');
        activateLicense(license);
        const prompt = getUpgradePrompt();
        expect(prompt).toBeNull();
    });

    it('getUpgradeUrl includes current tier', () => {
        const url = getUpgradeUrl();
        expect(url).toContain('current=community');
    });

    it('getCheckoutUrl includes target tier', () => {
        const url = getCheckoutUrl('pro');
        expect(url).toContain('tier=pro');
    });
});

// ---------------------------------------------------------------------------
// 10. API Route Handlers
// ---------------------------------------------------------------------------

describe('License API Route Handlers', () => {
    beforeEach(() => {
        cleanLicenseTables();
        cleanNodes();
        _resetSchemaFlag();
    });

    it('handleGetLicense returns current status', () => {
        const response = handleGetLicense();
        expect(response.status).toBe(200);
        expect(response.body.tier).toBe('community');
        expect(response.body.valid).toBe(true);
        expect(response.body.key).toBeDefined();
        expect(response.body.issuedTo).toBe('Community User');
    });

    it('handleGetLicense masks the key', () => {
        const response = handleGetLicense();
        // The community default key is TC-COMMUNITY-000000000000-0000
        // After masking the 12-char middle: 0000...0000
        expect(response.body.key).toContain('...');
    });

    it('handleActivateLicense activates valid license', () => {
        const license = generateLicenseKey('pro', 'api@test.com');
        const response = handleActivateLicense(license);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.license).toBeDefined();
        expect(response.body.license!.tier).toBe('pro');
    });

    it('handleActivateLicense rejects invalid license', () => {
        const license = generateLicenseKey('pro', 'bad@test.com');
        license.signature = 'TAMPERED';
        const response = handleActivateLicense(license);
        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBeDefined();
    });

    it('handleGetFeatures returns enabled and locked lists', () => {
        const response = handleGetFeatures();
        expect(response.status).toBe(200);
        expect(response.body.enabled).toEqual(TIER_LIMITS.community.features);
        expect(response.body.locked.length).toBeGreaterThan(0);
        expect(response.body.upgrade).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 11. CLI Data Export
// ---------------------------------------------------------------------------

describe('License CLI Data Export', () => {
    beforeEach(() => {
        cleanLicenseTables();
        cleanNodes();
        _resetSchemaFlag();
    });

    it('exports full CLI data for community tier', () => {
        const data = getLicenseCLIData();
        expect(data.tier).toBe('community');
        expect(data.issuedTo).toBe('Community User');
        expect(data.nodesUsed).toBe(0);
        expect(data.nodesAllowed).toBe(5);
        expect(data.features).toEqual(TIER_LIMITS.community.features);
        expect(data.lockedFeatures.length).toBeGreaterThan(0);
        expect(data.daysRemaining).toBeNull();
        expect(data.valid).toBe(true);
        expect(data.upgradeUrl).toContain('tentaclaw.io/pricing');
    });

    it('exports full CLI data for pro tier', () => {
        const license = generateLicenseKey('pro', 'cli@test.com', { expiresInDays: 60 });
        activateLicense(license);

        const data = getLicenseCLIData();
        expect(data.tier).toBe('pro');
        expect(data.issuedTo).toBe('cli@test.com');
        expect(data.nodesAllowed).toBe(100);
        expect(data.daysRemaining).toBeGreaterThan(59);
        expect(data.daysRemaining).toBeLessThanOrEqual(60);
    });
});

// ---------------------------------------------------------------------------
// 12. RSA Key Management
// ---------------------------------------------------------------------------

describe('RSA Key Management', () => {
    it('getPublicKey returns a PEM-formatted key', () => {
        const pubKey = getPublicKey();
        expect(pubKey).toContain('-----BEGIN PUBLIC KEY-----');
        expect(pubKey).toContain('-----END PUBLIC KEY-----');
    });

    it('generates consistent keys across calls', () => {
        const key1 = getPublicKey();
        const key2 = getPublicKey();
        expect(key1).toBe(key2);
    });
});

// ---------------------------------------------------------------------------
// 13. Tier Limits Integrity
// ---------------------------------------------------------------------------

describe('Tier Limits', () => {
    it('community has 5 max nodes', () => {
        expect(TIER_LIMITS.community.maxNodes).toBe(5);
    });

    it('pro has 100 max nodes', () => {
        expect(TIER_LIMITS.pro.maxNodes).toBe(100);
    });

    it('enterprise has 10000 max nodes', () => {
        expect(TIER_LIMITS.enterprise.maxNodes).toBe(10000);
    });

    it('enterprise-plus has unlimited nodes', () => {
        expect(TIER_LIMITS['enterprise-plus'].maxNodes).toBe(Infinity);
    });

    it('higher tiers are supersets of lower tiers', () => {
        const communityFeatures = new Set(TIER_LIMITS.community.features);
        const proFeatures = new Set(TIER_LIMITS.pro.features);
        const enterpriseFeatures = new Set(TIER_LIMITS.enterprise.features);
        const entPlusFeatures = new Set(TIER_LIMITS['enterprise-plus'].features);

        // Every community feature should be in pro
        for (const f of communityFeatures) {
            expect(proFeatures.has(f)).toBe(true);
        }
        // Every pro feature should be in enterprise
        for (const f of proFeatures) {
            expect(enterpriseFeatures.has(f)).toBe(true);
        }
        // Every enterprise feature should be in enterprise-plus
        for (const f of enterpriseFeatures) {
            expect(entPlusFeatures.has(f)).toBe(true);
        }
    });

    it('each tier has unique features not in lower tiers', () => {
        const communitySet = new Set(TIER_LIMITS.community.features);
        const proSet = new Set(TIER_LIMITS.pro.features);
        const enterpriseSet = new Set(TIER_LIMITS.enterprise.features);

        // Pro should have features not in community
        const proOnly = TIER_LIMITS.pro.features.filter(f => !communitySet.has(f));
        expect(proOnly.length).toBeGreaterThan(0);
        expect(proOnly).toContain('team-rbac');

        // Enterprise should have features not in pro
        const entOnly = TIER_LIMITS.enterprise.features.filter(f => !proSet.has(f));
        expect(entOnly.length).toBeGreaterThan(0);
        expect(entOnly).toContain('sso-oidc');

        // Enterprise-plus should have features not in enterprise
        const epOnly = TIER_LIMITS['enterprise-plus'].features.filter(f => !enterpriseSet.has(f));
        expect(epOnly.length).toBeGreaterThan(0);
        expect(epOnly).toContain('white-label');
    });
});
