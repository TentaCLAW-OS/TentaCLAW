/**
 * TentaCLAW Gateway — Security Tests
 *
 * Tests the security module: secrets manager, network policies,
 * security scanner, compliance reporting, and certificate management.
 * Uses in-memory SQLite; master key is set via env for deterministic encryption.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';

// Use in-memory DB and set a deterministic master key for tests
process.env.TENTACLAW_DB_PATH = ':memory:';
process.env.TENTACLAW_MASTER_KEY = randomBytes(32).toString('hex');

import { getDb } from '../src/db';

import {
    createSecret,
    getSecret,
    listSecrets,
    deleteSecret,
    rotateSecret,
    createNetworkPolicy,
    getNetworkPolicies,
    deleteNetworkPolicy,
    evaluateNetworkPolicy,
    runSecurityScan,
    getSecurityScore,
    getSecurityRecommendations,
    generateComplianceReport,
    getCertStatus,
} from '../src/experimental/security';

import type {
    NetworkPolicy,
    NetworkRule,
} from '../src/experimental/security';

// ---------------------------------------------------------------------------
// Helpers — clean security tables between tests
// ---------------------------------------------------------------------------

function cleanSecurityTables() {
    const db = getDb();
    // The security module lazily creates its tables via ensureSchema().
    // After first use the tables exist and we can clean them.
    try {
        db.exec(`
            DELETE FROM security_secrets;
            DELETE FROM security_network_policies;
            DELETE FROM security_scan_history;
            DELETE FROM security_certificates;
        `);
    } catch {
        // Tables may not exist yet on first call — that is fine.
    }
}

// ---------------------------------------------------------------------------
// 1. Secrets Manager
// ---------------------------------------------------------------------------

describe('Secrets Manager', () => {
    beforeEach(() => cleanSecurityTables());

    it('createSecret stores encrypted secret', () => {
        const meta = createSecret('db-password', 's3cret!', 'production', 'opaque');
        expect(meta.name).toBe('db-password');
        expect(meta.namespace).toBe('production');
        expect(meta.version).toBe(1);
        expect(meta.type).toBe('opaque');
        // The value is NOT in the metadata — that is the whole point
        expect((meta as Record<string, unknown>).value).toBeUndefined();
    });

    it('getSecret retrieves decrypted value', () => {
        createSecret('api-token', 'tok_abc123', 'default', 'api-key');
        const secret = getSecret('api-token');
        expect(secret).not.toBeNull();
        expect(secret!.value).toBe('tok_abc123');
        expect(secret!.name).toBe('api-token');
        expect(secret!.type).toBe('api-key');
    });

    it('listSecrets returns names without values', () => {
        createSecret('secret-a', 'value-a');
        createSecret('secret-b', 'value-b');
        const list = listSecrets();
        expect(list.length).toBe(2);
        for (const item of list) {
            expect(item).toHaveProperty('name');
            expect(item).toHaveProperty('namespace');
            // Metadata should never contain the value
            expect((item as Record<string, unknown>).value).toBeUndefined();
        }
        expect(list.map(s => s.name).sort()).toEqual(['secret-a', 'secret-b']);
    });

    it('deleteSecret removes secret', () => {
        createSecret('temp-secret', 'temp-value');
        expect(deleteSecret('temp-secret')).toBe(true);
        expect(getSecret('temp-secret')).toBeNull();
        // Second delete should return false (nothing to delete)
        expect(deleteSecret('temp-secret')).toBe(false);
    });

    it('rotateSecret creates new version', () => {
        createSecret('rotatable', 'v1-value', 'default', 'api-key');
        const rotated = rotateSecret('rotatable');
        expect(rotated).not.toBeNull();
        expect(rotated!.metadata.version).toBe(2);
        expect(rotated!.newValue).toBeTruthy();
        // The latest version should have the rotated value
        const fetched = getSecret('rotatable');
        expect(fetched!.version).toBe(2);
        expect(fetched!.value).toBe(rotated!.newValue);
    });

    it('secrets are namespaced', () => {
        createSecret('shared-name', 'value-in-prod', 'production');
        createSecret('shared-name', 'value-in-dev', 'development');

        const prod = getSecret('shared-name', 'production');
        const dev = getSecret('shared-name', 'development');

        expect(prod!.value).toBe('value-in-prod');
        expect(dev!.value).toBe('value-in-dev');

        const prodList = listSecrets('production');
        const devList = listSecrets('development');
        expect(prodList.length).toBe(1);
        expect(devList.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 2. Network Policies
// ---------------------------------------------------------------------------

describe('Network Policies', () => {
    beforeEach(() => cleanSecurityTables());

    it('createNetworkPolicy stores policy', () => {
        const policy: NetworkPolicy = {
            name: 'deny-external',
            namespace: 'default',
            rules: [
                { direction: 'ingress', action: 'deny', source: '0.0.0.0/0', ports: [443] },
            ],
        };
        const created = createNetworkPolicy(policy);
        expect(created.name).toBe('deny-external');
        expect(created.namespace).toBe('default');
        expect(created.rules.length).toBe(1);
    });

    it('getNetworkPolicies lists all', () => {
        createNetworkPolicy({
            name: 'policy-a',
            namespace: 'default',
            rules: [{ direction: 'ingress', action: 'allow', source: '10.0.0.0/8' }],
        });
        createNetworkPolicy({
            name: 'policy-b',
            namespace: 'production',
            rules: [{ direction: 'egress', action: 'deny', destination: '0.0.0.0/0' }],
        });
        const all = getNetworkPolicies();
        expect(all.length).toBe(2);
    });

    it('deleteNetworkPolicy removes', () => {
        createNetworkPolicy({
            name: 'temp-policy',
            namespace: 'default',
            rules: [],
        });
        expect(deleteNetworkPolicy('temp-policy')).toBe(true);
        expect(getNetworkPolicies().length).toBe(0);
        expect(deleteNetworkPolicy('temp-policy')).toBe(false);
    });

    it('evaluateNetworkPolicy allows by default (no policies)', () => {
        const result = evaluateNetworkPolicy('10.0.0.1', '10.0.0.2', 8080);
        expect(result.allowed).toBe(true);
        expect(result.reason).toContain('default allow');
    });

    it('evaluateNetworkPolicy denies when policy exists but no match', () => {
        createNetworkPolicy({
            name: 'allow-internal',
            namespace: 'default',
            rules: [
                {
                    direction: 'ingress',
                    action: 'allow',
                    source: '10.0.0.0/8',
                    destination: '10.0.0.0/8',
                    ports: [8080],
                },
            ],
        });
        // A request from an external IP should be denied (no matching allow rule)
        const result = evaluateNetworkPolicy('203.0.113.5', '10.0.0.1', 8080);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('default deny');
    });
});

// ---------------------------------------------------------------------------
// 3. Security Scanner
// ---------------------------------------------------------------------------

describe('Security Scanner', () => {
    beforeEach(() => cleanSecurityTables());

    it('runSecurityScan returns results', () => {
        const result = runSecurityScan();
        expect(result).toHaveProperty('timestamp');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('grade');
        expect(result).toHaveProperty('checks');
        expect(result).toHaveProperty('summary');
        expect(Array.isArray(result.checks)).toBe(true);
        expect(result.checks.length).toBeGreaterThan(0);
        expect(result.summary.total).toBe(result.checks.length);
    });

    it('getSecurityScore returns 0-100', () => {
        const scoreInfo = getSecurityScore();
        expect(scoreInfo).toHaveProperty('score');
        expect(scoreInfo).toHaveProperty('grade');
        expect(scoreInfo).toHaveProperty('lastScanAt');
        expect(scoreInfo).toHaveProperty('summary');
        expect(scoreInfo.score).toBeGreaterThanOrEqual(0);
        expect(scoreInfo.score).toBeLessThanOrEqual(100);
    });

    it('getSecurityRecommendations returns list', () => {
        const recommendations = getSecurityRecommendations();
        expect(Array.isArray(recommendations)).toBe(true);
        // There should be some recommendations since no TLS/auth is configured in test env
        for (const rec of recommendations) {
            expect(rec).toHaveProperty('priority');
            expect(rec).toHaveProperty('category');
            expect(rec).toHaveProperty('title');
            expect(rec).toHaveProperty('description');
            expect(rec).toHaveProperty('effort');
            expect(['critical', 'high', 'medium', 'low']).toContain(rec.priority);
        }
    });
});

// ---------------------------------------------------------------------------
// 4. Compliance
// ---------------------------------------------------------------------------

describe('Compliance', () => {
    beforeEach(() => cleanSecurityTables());

    it('generateComplianceReport works for soc2', () => {
        const report = generateComplianceReport('soc2');
        expect(report.framework).toBe('soc2');
        expect(report).toHaveProperty('generatedAt');
        expect(report).toHaveProperty('overallStatus');
        expect(report).toHaveProperty('controls');
        expect(report).toHaveProperty('summary');
        expect(report.controls.length).toBeGreaterThan(0);
        expect(['compliant', 'non-compliant', 'partial']).toContain(report.overallStatus);
    });

    it('generateComplianceReport works for hipaa', () => {
        const report = generateComplianceReport('hipaa');
        expect(report.framework).toBe('hipaa');
        expect(report.controls.length).toBeGreaterThan(0);
        expect(report.summary.total).toBe(report.controls.length);
    });

    it('report includes pass/fail per control', () => {
        const report = generateComplianceReport('soc2');
        for (const control of report.controls) {
            expect(control).toHaveProperty('id');
            expect(control).toHaveProperty('name');
            expect(control).toHaveProperty('description');
            expect(control).toHaveProperty('status');
            expect(control).toHaveProperty('evidence');
            expect(['pass', 'fail', 'na', 'partial']).toContain(control.status);
        }
        // Summary counts should add up
        const { passed, failed, notApplicable, partial, total } = report.summary;
        expect(passed + failed + notApplicable + partial).toBe(total);
    });
});

// ---------------------------------------------------------------------------
// 5. Certificate Management
// ---------------------------------------------------------------------------

describe('Certificate Management', () => {
    beforeEach(() => cleanSecurityTables());

    it('getCertStatus returns status even before init', () => {
        const status = getCertStatus();
        expect(status).toHaveProperty('ca');
        expect(status).toHaveProperty('nodes');
        expect(status).toHaveProperty('overallHealth');
        expect(status).toHaveProperty('expiringWithin30d');
        expect(status).toHaveProperty('expired');
        // Before init, CA should be null and health critical
        expect(status.ca).toBeNull();
        expect(status.overallHealth).toBe('critical');
        expect(Array.isArray(status.nodes)).toBe(true);
    });

    it('getCertStatus nodes array is empty before init', () => {
        const status = getCertStatus();
        expect(status.nodes.length).toBe(0);
        expect(status.expiringWithin30d).toBe(0);
        expect(status.expired).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 6. Secrets Manager Edge Cases
// ---------------------------------------------------------------------------

describe('Secrets Manager Edge Cases', () => {
    beforeEach(() => cleanSecurityTables());

    it('getSecret returns null for nonexistent secret', () => {
        expect(getSecret('does-not-exist')).toBeNull();
    });

    it('deleteSecret returns false for nonexistent secret', () => {
        expect(deleteSecret('nope')).toBe(false);
    });

    it('rotateSecret returns null for nonexistent secret', () => {
        expect(rotateSecret('ghost-secret')).toBeNull();
    });

    it('creating same secret name bumps version', () => {
        createSecret('versioned', 'v1');
        createSecret('versioned', 'v2');
        const secret = getSecret('versioned');
        expect(secret!.version).toBe(2);
        expect(secret!.value).toBe('v2');
    });

    it('listSecrets returns empty when no secrets exist', () => {
        const list = listSecrets();
        expect(list).toEqual([]);
    });

    it('listSecrets filtered by namespace returns empty for unused namespace', () => {
        createSecret('only-default', 'val');
        const list = listSecrets('nonexistent-ns');
        expect(list).toEqual([]);
    });

    it('secret type is preserved through create and retrieve', () => {
        createSecret('conn', 'postgres://localhost/db', 'default', 'connection-string');
        const secret = getSecret('conn');
        expect(secret!.type).toBe('connection-string');
    });

    it('rotateSecret for api-key type generates tc_ prefixed value', () => {
        createSecret('my-key', 'old-value', 'default', 'api-key');
        const result = rotateSecret('my-key');
        expect(result).not.toBeNull();
        expect(result!.newValue.startsWith('tc_')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 7. Network Policies Edge Cases
// ---------------------------------------------------------------------------

describe('Network Policies Edge Cases', () => {
    beforeEach(() => cleanSecurityTables());

    it('getNetworkPolicies returns empty initially', () => {
        const policies = getNetworkPolicies();
        expect(policies).toEqual([]);
    });

    it('getNetworkPolicies filters by namespace', () => {
        createNetworkPolicy({ name: 'a', namespace: 'ns1', rules: [] });
        createNetworkPolicy({ name: 'b', namespace: 'ns2', rules: [] });
        const ns1 = getNetworkPolicies('ns1');
        expect(ns1.length).toBe(1);
        expect(ns1[0].name).toBe('a');
    });

    it('deleteNetworkPolicy returns false for nonexistent policy', () => {
        expect(deleteNetworkPolicy('ghost-policy')).toBe(false);
    });

    it('evaluateNetworkPolicy respects deny rule with port match', () => {
        createNetworkPolicy({
            name: 'block-ssh',
            namespace: 'default',
            rules: [{ direction: 'ingress', action: 'deny', source: '*', ports: [22] }],
        });
        const result = evaluateNetworkPolicy('10.0.0.1', '10.0.0.2', 22);
        expect(result.allowed).toBe(false);
        expect(result.matchedPolicy).toBe('block-ssh');
    });

    it('evaluateNetworkPolicy allows when allow rule matches', () => {
        createNetworkPolicy({
            name: 'allow-http',
            namespace: 'default',
            rules: [{ direction: 'ingress', action: 'allow', source: '*', ports: [8080] }],
        });
        const result = evaluateNetworkPolicy('10.0.0.1', '10.0.0.2', 8080);
        expect(result.allowed).toBe(true);
        expect(result.matchedPolicy).toBe('allow-http');
    });

    it('deny rules take precedence over allow rules', () => {
        createNetworkPolicy({
            name: 'allow-all',
            namespace: 'default',
            rules: [{ direction: 'ingress', action: 'allow', source: '*' }],
        });
        createNetworkPolicy({
            name: 'deny-specific',
            namespace: 'default',
            rules: [{ direction: 'ingress', action: 'deny', source: '192.168.1.0/24' }],
        });
        const result = evaluateNetworkPolicy('192.168.1.50', '10.0.0.1', 443);
        expect(result.allowed).toBe(false);
    });

    it('createNetworkPolicy upserts on same name and namespace', () => {
        createNetworkPolicy({
            name: 'mutable',
            namespace: 'default',
            rules: [{ direction: 'ingress', action: 'allow', source: '10.0.0.0/8' }],
        });
        createNetworkPolicy({
            name: 'mutable',
            namespace: 'default',
            rules: [
                { direction: 'ingress', action: 'allow', source: '10.0.0.0/8' },
                { direction: 'egress', action: 'deny', destination: '0.0.0.0/0' },
            ],
        });
        const policies = getNetworkPolicies('default');
        const mutable = policies.find(p => p.name === 'mutable');
        expect(mutable).toBeDefined();
        expect(mutable!.rules.length).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// 8. Security Scanner Edge Cases
// ---------------------------------------------------------------------------

describe('Security Scanner Edge Cases', () => {
    beforeEach(() => cleanSecurityTables());

    it('scan checks include all required categories', () => {
        const result = runSecurityScan();
        const categories = new Set(result.checks.map(c => c.category));
        expect(categories.has('tls')).toBe(true);
        expect(categories.has('auth')).toBe(true);
        expect(categories.has('secrets')).toBe(true);
        expect(categories.has('config')).toBe(true);
    });

    it('scan summary counts match check statuses', () => {
        const result = runSecurityScan();
        const passed = result.checks.filter(c => c.status === 'pass').length;
        const failed = result.checks.filter(c => c.status === 'fail').length;
        const warnings = result.checks.filter(c => c.status === 'warn').length;
        expect(result.summary.passed).toBe(passed);
        expect(result.summary.failed).toBe(failed);
        expect(result.summary.warnings).toBe(warnings);
    });

    it('each check has required fields', () => {
        const result = runSecurityScan();
        for (const check of result.checks) {
            expect(check).toHaveProperty('id');
            expect(check).toHaveProperty('category');
            expect(check).toHaveProperty('name');
            expect(check).toHaveProperty('status');
            expect(check).toHaveProperty('severity');
            expect(check).toHaveProperty('message');
            expect(['pass', 'fail', 'warn']).toContain(check.status);
            expect(['critical', 'high', 'medium', 'low', 'info']).toContain(check.severity);
        }
    });

    it('score grade follows A-F scale', () => {
        const result = runSecurityScan();
        expect(['A+', 'A', 'B', 'C', 'D', 'F']).toContain(result.grade);
    });
});
