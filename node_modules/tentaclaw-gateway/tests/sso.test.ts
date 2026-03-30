/**
 * TentaCLAW Gateway — Enterprise SSO & RBAC Tests
 *
 * Tests the OIDC configuration, RBAC permission system, role management,
 * service accounts, and session handling.
 * Mocks the DB layer so we test pure logic only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — stub out DB so sso.ts runs in isolation with in-memory SQLite
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../src/db', () => ({
    getDb: () => {
        if (!testDb) {
            testDb = new Database(':memory:');
            testDb.pragma('journal_mode = WAL');
            testDb.pragma('foreign_keys = ON');
        }
        return testDb;
    },
}));

import {
    PERMISSIONS,
    ROLE_TEMPLATES,
    initSSOTables,
    getOIDCConfig,
    updateOIDCConfig,
    assignRole,
    removeRole,
    getUserRoles,
    checkPermission,
    getUserPermissions,
    createCustomRole,
    deleteCustomRole,
    listRoles,
    getRole,
    createServiceAccount,
    rotateServiceAccountToken,
    validateServiceAccountToken,
    listServiceAccounts,
    deleteServiceAccount,
    checkServiceAccountPermission,
    getSSOUser,
    listSSOUsers,
    getSSOSession,
    deleteSSOSession,
    deleteAllUserSessions,
    cleanExpiredSessions,
    _resetSSOState,
} from '../src/sso';

import type { Permission } from '../src/sso';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    // Reset state between tests
    _resetSSOState();
    if (testDb) {
        testDb.close();
    }
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    testDb.pragma('foreign_keys = ON');
});

// ---------------------------------------------------------------------------
// Permission Constants
// ---------------------------------------------------------------------------

describe('PERMISSIONS', () => {
    it('should define 36+ permissions', () => {
        const count = Object.keys(PERMISSIONS).length;
        expect(count).toBeGreaterThanOrEqual(36);
    });

    it('should include all required permission categories', () => {
        const keys = Object.keys(PERMISSIONS);
        expect(keys.some(k => k.startsWith('models.'))).toBe(true);
        expect(keys.some(k => k.startsWith('nodes.'))).toBe(true);
        expect(keys.some(k => k.startsWith('namespaces.'))).toBe(true);
        expect(keys.some(k => k.startsWith('finetune.'))).toBe(true);
        expect(keys.some(k => k.startsWith('benchmarks.'))).toBe(true);
        expect(keys.some(k => k.startsWith('apikeys.'))).toBe(true);
        expect(keys.some(k => k.startsWith('users.'))).toBe(true);
        expect(keys.some(k => k.startsWith('system.'))).toBe(true);
        expect(keys.some(k => k.startsWith('inference.'))).toBe(true);
        expect(keys.some(k => k.startsWith('clawhub.'))).toBe(true);
        expect(keys.some(k => k.startsWith('webhooks.'))).toBe(true);
        expect(keys.some(k => k.startsWith('alerts.'))).toBe(true);
    });

    it('should have descriptions for all permissions', () => {
        for (const [key, desc] of Object.entries(PERMISSIONS)) {
            expect(desc, `${key} should have a description`).toBeTruthy();
            expect(typeof desc).toBe('string');
        }
    });
});

// ---------------------------------------------------------------------------
// Role Templates
// ---------------------------------------------------------------------------

describe('ROLE_TEMPLATES', () => {
    it('should define all 5 built-in roles', () => {
        expect(ROLE_TEMPLATES).toHaveProperty('admin');
        expect(ROLE_TEMPLATES).toHaveProperty('operator');
        expect(ROLE_TEMPLATES).toHaveProperty('developer');
        expect(ROLE_TEMPLATES).toHaveProperty('viewer');
        expect(ROLE_TEMPLATES).toHaveProperty('service-account');
    });

    it('admin should have ALL permissions', () => {
        const allPerms = Object.keys(PERMISSIONS) as Permission[];
        expect(ROLE_TEMPLATES.admin).toEqual(expect.arrayContaining(allPerms));
        expect(ROLE_TEMPLATES.admin.length).toBe(allPerms.length);
    });

    it('operator should have models, nodes, inference but not users/system', () => {
        expect(ROLE_TEMPLATES.operator).toContain('models.list');
        expect(ROLE_TEMPLATES.operator).toContain('models.deploy');
        expect(ROLE_TEMPLATES.operator).toContain('nodes.drain');
        expect(ROLE_TEMPLATES.operator).toContain('inference.chat');
        expect(ROLE_TEMPLATES.operator).not.toContain('users.create');
        expect(ROLE_TEMPLATES.operator).not.toContain('system.config');
        expect(ROLE_TEMPLATES.operator).not.toContain('system.sso');
    });

    it('developer should have read + inference + finetune but not admin ops', () => {
        expect(ROLE_TEMPLATES.developer).toContain('models.list');
        expect(ROLE_TEMPLATES.developer).toContain('inference.chat');
        expect(ROLE_TEMPLATES.developer).toContain('finetune.create');
        expect(ROLE_TEMPLATES.developer).not.toContain('models.deploy');
        expect(ROLE_TEMPLATES.developer).not.toContain('nodes.drain');
        expect(ROLE_TEMPLATES.developer).not.toContain('users.create');
    });

    it('viewer should only have read + basic inference', () => {
        expect(ROLE_TEMPLATES.viewer).toContain('models.list');
        expect(ROLE_TEMPLATES.viewer).toContain('nodes.list');
        expect(ROLE_TEMPLATES.viewer).toContain('inference.chat');
        expect(ROLE_TEMPLATES.viewer).not.toContain('models.deploy');
        expect(ROLE_TEMPLATES.viewer).not.toContain('finetune.create');
        expect(ROLE_TEMPLATES.viewer.length).toBeLessThan(ROLE_TEMPLATES.developer.length);
    });

    it('service-account should only have inference permissions', () => {
        const sa = ROLE_TEMPLATES['service-account'];
        for (const perm of sa) {
            expect(perm).toMatch(/^inference\./);
        }
        expect(sa).toContain('inference.chat');
        expect(sa).toContain('inference.embed');
        expect(sa).toContain('inference.images');
        expect(sa).toContain('inference.audio');
    });

    it('roles should be strictly hierarchical in permission count', () => {
        expect(ROLE_TEMPLATES.admin.length).toBeGreaterThan(ROLE_TEMPLATES.operator.length);
        expect(ROLE_TEMPLATES.operator.length).toBeGreaterThan(ROLE_TEMPLATES.developer.length);
        expect(ROLE_TEMPLATES.developer.length).toBeGreaterThan(ROLE_TEMPLATES.viewer.length);
        expect(ROLE_TEMPLATES.viewer.length).toBeGreaterThan(ROLE_TEMPLATES['service-account'].length);
    });
});

// ---------------------------------------------------------------------------
// OIDC Configuration
// ---------------------------------------------------------------------------

describe('OIDC Configuration', () => {
    it('should return a disabled default when no config exists', () => {
        const config = getOIDCConfig();
        expect(config.enabled).toBe(false);
        expect(config.issuerUrl).toBe('');
        expect(config.clientId).toBe('');
        expect(config.scopes).toEqual(['openid', 'profile', 'email']);
        expect(config.autoCreateUser).toBe(true);
        expect(config.allowedDomains).toEqual([]);
    });

    it('should persist OIDC config via updateOIDCConfig', () => {
        const updated = updateOIDCConfig({
            enabled: true,
            issuerUrl: 'https://accounts.google.com',
            clientId: 'my-client-id',
            clientSecret: 'my-secret',
            redirectUri: 'http://gateway:8080/auth/callback',
            scopes: ['openid', 'profile', 'email', 'groups'],
            groupsClaim: 'groups',
            groupToRoleMapping: { 'ml-team': 'operator', 'admins': 'admin' },
            allowedDomains: ['company.com'],
        });

        expect(updated.enabled).toBe(true);
        expect(updated.issuerUrl).toBe('https://accounts.google.com');
        expect(updated.clientId).toBe('my-client-id');

        // Re-read from DB
        const reloaded = getOIDCConfig();
        expect(reloaded.enabled).toBe(true);
        expect(reloaded.issuerUrl).toBe('https://accounts.google.com');
        expect(reloaded.scopes).toContain('groups');
        expect(reloaded.groupsClaim).toBe('groups');
        expect(reloaded.groupToRoleMapping).toEqual({ 'ml-team': 'operator', 'admins': 'admin' });
        expect(reloaded.allowedDomains).toEqual(['company.com']);
    });

    it('should merge partial updates without losing existing fields', () => {
        updateOIDCConfig({
            enabled: true,
            issuerUrl: 'https://auth.example.com',
            clientId: 'id-1',
            clientSecret: 'secret-1',
            redirectUri: 'http://localhost/callback',
        });

        // Partial update — only change the secret
        updateOIDCConfig({ clientSecret: 'secret-2' });

        const config = getOIDCConfig();
        expect(config.issuerUrl).toBe('https://auth.example.com');
        expect(config.clientId).toBe('id-1');
        expect(config.clientSecret).toBe('secret-2');
        expect(config.enabled).toBe(true);
    });

    it('should handle autoCreateUser=false correctly', () => {
        updateOIDCConfig({ autoCreateUser: false });
        const config = getOIDCConfig();
        expect(config.autoCreateUser).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Role Assignment & Permission Checking
// ---------------------------------------------------------------------------

describe('Role Assignment & Permission Checking', () => {
    const testUserId = 'test-user-001';

    it('should assign a global role and check permissions', () => {
        initSSOTables();
        assignRole(testUserId, 'viewer');

        expect(checkPermission(testUserId, 'models.list')).toBe(true);
        expect(checkPermission(testUserId, 'inference.chat')).toBe(true);
        expect(checkPermission(testUserId, 'models.deploy')).toBe(false);
        expect(checkPermission(testUserId, 'users.create')).toBe(false);
    });

    it('should return all effective permissions for a user', () => {
        initSSOTables();
        assignRole(testUserId, 'developer');

        const perms = getUserPermissions(testUserId);
        expect(perms).toContain('models.list');
        expect(perms).toContain('inference.chat');
        expect(perms).toContain('finetune.create');
        expect(perms).not.toContain('system.config');
    });

    it('should support namespace-scoped roles', () => {
        initSSOTables();
        assignRole(testUserId, 'viewer'); // global
        assignRole(testUserId, 'operator', 'production'); // namespace-scoped

        // Without namespace — only viewer perms
        expect(checkPermission(testUserId, 'models.deploy')).toBe(false);

        // With namespace — viewer + operator perms merged
        expect(checkPermission(testUserId, 'models.deploy', 'production')).toBe(true);
        expect(checkPermission(testUserId, 'nodes.drain', 'production')).toBe(true);

        // Different namespace — only global viewer perms
        expect(checkPermission(testUserId, 'models.deploy', 'staging')).toBe(false);
    });

    it('should merge permissions from multiple roles', () => {
        initSSOTables();
        assignRole(testUserId, 'viewer');
        assignRole(testUserId, 'developer');

        const perms = getUserPermissions(testUserId);
        // Should have union of viewer + developer permissions
        expect(perms).toContain('finetune.create'); // developer only
        expect(perms).toContain('models.list'); // both
        expect(perms).toContain('inference.chat'); // both
    });

    it('admin role should grant all permissions', () => {
        initSSOTables();
        assignRole(testUserId, 'admin');

        const allPerms = Object.keys(PERMISSIONS) as Permission[];
        for (const perm of allPerms) {
            expect(checkPermission(testUserId, perm), `admin should have ${perm}`).toBe(true);
        }
    });

    it('should be idempotent — assigning same role twice is harmless', () => {
        initSSOTables();
        assignRole(testUserId, 'viewer');
        assignRole(testUserId, 'viewer'); // no-op

        const roles = getUserRoles(testUserId);
        const viewerRoles = roles.filter(r => r.role_name === 'viewer' && r.namespace === null);
        expect(viewerRoles.length).toBe(1);
    });

    it('should remove roles correctly', () => {
        initSSOTables();
        assignRole(testUserId, 'admin');
        expect(checkPermission(testUserId, 'system.config')).toBe(true);

        const removed = removeRole(testUserId, 'admin');
        expect(removed).toBe(true);
        expect(checkPermission(testUserId, 'system.config')).toBe(false);
    });

    it('should remove namespace-scoped roles without affecting global', () => {
        initSSOTables();
        assignRole(testUserId, 'viewer');
        assignRole(testUserId, 'operator', 'prod');

        removeRole(testUserId, 'operator', 'prod');

        // Global role still intact
        expect(checkPermission(testUserId, 'models.list')).toBe(true);
        // Namespace role gone
        expect(checkPermission(testUserId, 'models.deploy', 'prod')).toBe(false);
    });

    it('removeRole should return false for non-existent role', () => {
        initSSOTables();
        const removed = removeRole(testUserId, 'nonexistent');
        expect(removed).toBe(false);
    });

    it('getUserRoles should list all assignments', () => {
        initSSOTables();
        assignRole(testUserId, 'viewer');
        assignRole(testUserId, 'operator', 'prod');
        assignRole(testUserId, 'admin', 'staging');

        const roles = getUserRoles(testUserId);
        expect(roles.length).toBe(3);
        expect(roles.some(r => r.role_name === 'viewer' && r.namespace === null)).toBe(true);
        expect(roles.some(r => r.role_name === 'operator' && r.namespace === 'prod')).toBe(true);
        expect(roles.some(r => r.role_name === 'admin' && r.namespace === 'staging')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Custom Roles
// ---------------------------------------------------------------------------

describe('Custom Role Management', () => {
    it('should create a custom role with specific permissions', () => {
        initSSOTables();
        const role = createCustomRole('ml-engineer', [
            'models.list', 'models.deploy', 'finetune.create', 'finetune.list',
            'inference.chat', 'inference.embed',
        ], 'ML team inference and fine-tuning');

        expect(role.name).toBe('ml-engineer');
        expect(role.permissions).toHaveLength(6);
        expect(role.description).toBe('ML team inference and fine-tuning');
    });

    it('should use custom roles for permission checking', () => {
        initSSOTables();
        createCustomRole('data-scientist', [
            'models.list', 'models.search', 'finetune.create', 'finetune.list',
            'benchmarks.run', 'benchmarks.list', 'inference.chat',
        ]);

        const userId = 'ds-user-001';
        assignRole(userId, 'data-scientist');

        expect(checkPermission(userId, 'finetune.create')).toBe(true);
        expect(checkPermission(userId, 'benchmarks.run')).toBe(true);
        expect(checkPermission(userId, 'models.deploy')).toBe(false);
        expect(checkPermission(userId, 'nodes.drain')).toBe(false);
    });

    it('should reject creation of role with built-in name', () => {
        initSSOTables();
        expect(() => createCustomRole('admin', ['models.list'])).toThrow(/built-in role/);
        expect(() => createCustomRole('operator', ['models.list'])).toThrow(/built-in role/);
    });

    it('should reject unknown permissions', () => {
        initSSOTables();
        expect(() => createCustomRole('bad-role', ['nonexistent.perm' as Permission])).toThrow(/Unknown permission/);
    });

    it('should update an existing custom role via upsert', () => {
        initSSOTables();
        createCustomRole('custom-a', ['models.list']);
        createCustomRole('custom-a', ['models.list', 'models.deploy'], 'Updated');

        const role = getRole('custom-a');
        expect(role).not.toBeNull();
        expect(role!.permissions).toHaveLength(2);
        expect(role!.description).toBe('Updated');
    });

    it('should delete a custom role and clean up assignments', () => {
        initSSOTables();
        createCustomRole('temp-role', ['models.list']);
        const userId = 'temp-user';
        assignRole(userId, 'temp-role');

        expect(checkPermission(userId, 'models.list')).toBe(true);

        const deleted = deleteCustomRole('temp-role');
        expect(deleted).toBe(true);

        // Permission should be gone (role deleted, assignment cleaned up)
        expect(checkPermission(userId, 'models.list')).toBe(false);
    });

    it('should refuse to delete a built-in role', () => {
        initSSOTables();
        expect(() => deleteCustomRole('admin')).toThrow(/built-in role/);
        expect(() => deleteCustomRole('viewer')).toThrow(/built-in role/);
    });

    it('should list all roles including built-in and custom', () => {
        initSSOTables();
        createCustomRole('custom-x', ['models.list'], 'A custom role');

        const roles = listRoles();
        const names = roles.map(r => r.name);

        expect(names).toContain('admin');
        expect(names).toContain('operator');
        expect(names).toContain('developer');
        expect(names).toContain('viewer');
        expect(names).toContain('service-account');
        expect(names).toContain('custom-x');
    });

    it('getRole should return null for non-existent role', () => {
        initSSOTables();
        expect(getRole('does-not-exist')).toBeNull();
    });

    it('getRole should return built-in roles', () => {
        initSSOTables();
        const admin = getRole('admin');
        expect(admin).not.toBeNull();
        expect(admin!.name).toBe('admin');
        expect(admin!.permissions.length).toBe(Object.keys(PERMISSIONS).length);
    });
});

// ---------------------------------------------------------------------------
// Service Accounts
// ---------------------------------------------------------------------------

describe('Service Accounts', () => {
    it('should create a service account with a token', () => {
        initSSOTables();
        const sa = createServiceAccount('inference-bot', 'production', [
            'inference.chat', 'inference.embed',
        ]);

        expect(sa.name).toBe('inference-bot');
        expect(sa.namespace).toBe('production');
        expect(sa.permissions).toEqual(['inference.chat', 'inference.embed']);
        expect(sa.token).toBeTruthy();
        expect(sa.token).toMatch(/^tc_/);
        expect(sa.tokenPrefix).toBe(sa.token.slice(0, 7));
        expect(sa.tokenHash).toBeTruthy();
    });

    it('should validate a service account token', () => {
        initSSOTables();
        const sa = createServiceAccount('bot-1', null, ['inference.chat']);

        const validated = validateServiceAccountToken(sa.token);
        expect(validated).not.toBeNull();
        expect(validated!.id).toBe(sa.id);
        expect(validated!.name).toBe('bot-1');
        expect(validated!.permissions).toContain('inference.chat');
    });

    it('should return null for invalid token', () => {
        initSSOTables();
        const result = validateServiceAccountToken('tc_bogus_token');
        expect(result).toBeNull();
    });

    it('should check service account permissions', () => {
        initSSOTables();
        const sa = createServiceAccount('limited-bot', null, [
            'inference.chat', 'inference.embed',
        ]);

        expect(checkServiceAccountPermission(sa.token, 'inference.chat')).toBe(true);
        expect(checkServiceAccountPermission(sa.token, 'inference.embed')).toBe(true);
        expect(checkServiceAccountPermission(sa.token, 'models.deploy')).toBe(false);
    });

    it('should enforce namespace scoping on service accounts', () => {
        initSSOTables();
        const sa = createServiceAccount('ns-bot', 'production', [
            'inference.chat',
        ]);

        // Same namespace — allowed
        expect(checkServiceAccountPermission(sa.token, 'inference.chat', 'production')).toBe(true);

        // Different namespace — denied
        expect(checkServiceAccountPermission(sa.token, 'inference.chat', 'staging')).toBe(false);
    });

    it('should rotate service account tokens', () => {
        initSSOTables();
        const original = createServiceAccount('rotatable', null, ['inference.chat']);
        const oldToken = original.token;

        const rotated = rotateServiceAccountToken(original.id);
        expect(rotated.token).not.toBe(oldToken);
        expect(rotated.id).toBe(original.id);
        expect(rotated.name).toBe('rotatable');

        // Old token should be invalid
        expect(validateServiceAccountToken(oldToken)).toBeNull();

        // New token should be valid
        const validated = validateServiceAccountToken(rotated.token);
        expect(validated).not.toBeNull();
        expect(validated!.id).toBe(original.id);
    });

    it('should throw when rotating non-existent service account', () => {
        initSSOTables();
        expect(() => rotateServiceAccountToken('nonexistent')).toThrow(/not found/);
    });

    it('should list service accounts', () => {
        initSSOTables();
        createServiceAccount('bot-a', 'ns-1', ['inference.chat']);
        createServiceAccount('bot-b', 'ns-1', ['inference.embed']);
        createServiceAccount('bot-c', 'ns-2', ['inference.chat']);

        const all = listServiceAccounts();
        expect(all.length).toBe(3);

        const ns1 = listServiceAccounts('ns-1');
        expect(ns1.length).toBe(2);

        const ns2 = listServiceAccounts('ns-2');
        expect(ns2.length).toBe(1);
    });

    it('should delete service accounts', () => {
        initSSOTables();
        const sa = createServiceAccount('deletable', null, ['inference.chat']);

        expect(deleteServiceAccount(sa.id)).toBe(true);
        expect(deleteServiceAccount(sa.id)).toBe(false); // already deleted

        expect(validateServiceAccountToken(sa.token)).toBeNull();
    });

    it('should reject unknown permissions on creation', () => {
        initSSOTables();
        expect(() =>
            createServiceAccount('bad-sa', null, ['nonexistent.perm' as Permission])
        ).toThrow(/Unknown permission/);
    });

    it('should create service account with null namespace (global)', () => {
        initSSOTables();
        const sa = createServiceAccount('global-bot', null, ['inference.chat']);
        expect(sa.namespace).toBeNull();

        // Global SA should work in any namespace
        expect(checkServiceAccountPermission(sa.token, 'inference.chat', 'any-ns')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// SSO User Management
// ---------------------------------------------------------------------------

describe('SSO User Management', () => {
    it('getSSOUser should return null for non-existent user', () => {
        initSSOTables();
        expect(getSSOUser('nonexistent')).toBeNull();
    });

    it('listSSOUsers should return empty array when no users', () => {
        initSSOTables();
        expect(listSSOUsers()).toEqual([]);
    });

    it('should create a user directly in DB and retrieve via getSSOUser', () => {
        initSSOTables();
        const db = testDb;
        const userId = 'manual-user-1';
        db.prepare(`
            INSERT INTO sso_users (id, username, email, display_name, oidc_subject, oidc_issuer)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, 'alice', 'alice@company.com', 'Alice Smith', 'sub-123', 'https://auth.example.com');

        assignRole(userId, 'developer');

        const user = getSSOUser(userId);
        expect(user).not.toBeNull();
        expect(user!.username).toBe('alice');
        expect(user!.email).toBe('alice@company.com');
        expect(user!.displayName).toBe('Alice Smith');
        expect(user!.roles).toContain('developer');
    });

    it('should track namespace roles on SSOUser', () => {
        initSSOTables();
        const db = testDb;
        const userId = 'ns-user-1';
        db.prepare(`
            INSERT INTO sso_users (id, username, email) VALUES (?, ?, ?)
        `).run(userId, 'bob', 'bob@company.com');

        assignRole(userId, 'viewer');
        assignRole(userId, 'admin', 'production');
        assignRole(userId, 'operator', 'staging');

        const user = getSSOUser(userId);
        expect(user!.roles).toEqual(['viewer']);
        expect(user!.namespaceRoles).toEqual({
            production: ['admin'],
            staging: ['operator'],
        });
    });
});

// ---------------------------------------------------------------------------
// SSO Session Management
// ---------------------------------------------------------------------------

describe('SSO Session Management', () => {
    it('getSSOSession should return null for non-existent session', () => {
        initSSOTables();
        expect(getSSOSession('nonexistent')).toBeNull();
    });

    it('should create, retrieve, and delete a session', () => {
        initSSOTables();
        const db = testDb;
        const sessionId = 'session-001';

        db.prepare(`
            INSERT INTO sso_sessions (id, user_id, access_token, refresh_token, id_token, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(sessionId, 'user-1', 'at-123', 'rt-456', 'it-789', '2099-12-31 23:59:59');

        const session = getSSOSession(sessionId);
        expect(session).not.toBeNull();
        expect(session!.userId).toBe('user-1');
        expect(session!.accessToken).toBe('at-123');
        expect(session!.refreshToken).toBe('rt-456');
        expect(session!.idToken).toBe('it-789');

        expect(deleteSSOSession(sessionId)).toBe(true);
        expect(getSSOSession(sessionId)).toBeNull();
    });

    it('should delete all sessions for a user', () => {
        initSSOTables();
        const db = testDb;
        const userId = 'user-multi-session';

        for (let i = 0; i < 3; i++) {
            db.prepare(`
                INSERT INTO sso_sessions (id, user_id, access_token, expires_at)
                VALUES (?, ?, ?, ?)
            `).run(`session-${i}`, userId, `at-${i}`, '2099-12-31 23:59:59');
        }

        const deleted = deleteAllUserSessions(userId);
        expect(deleted).toBe(3);
        expect(getSSOSession('session-0')).toBeNull();
        expect(getSSOSession('session-1')).toBeNull();
        expect(getSSOSession('session-2')).toBeNull();
    });

    it('should clean expired sessions', () => {
        initSSOTables();
        const db = testDb;

        // Expired session
        db.prepare(`
            INSERT INTO sso_sessions (id, user_id, access_token, expires_at)
            VALUES (?, ?, ?, ?)
        `).run('expired-1', 'user-1', 'at-old', '2020-01-01 00:00:00');

        // Valid session
        db.prepare(`
            INSERT INTO sso_sessions (id, user_id, access_token, expires_at)
            VALUES (?, ?, ?, ?)
        `).run('valid-1', 'user-2', 'at-new', '2099-12-31 23:59:59');

        const cleaned = cleanExpiredSessions();
        expect(cleaned).toBe(1);
        expect(getSSOSession('expired-1')).toBeNull();
        expect(getSSOSession('valid-1')).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Init & Seeding
// ---------------------------------------------------------------------------

describe('SSO Table Initialization', () => {
    it('should be idempotent — calling initSSOTables twice is safe', () => {
        initSSOTables();
        initSSOTables(); // Should not throw

        const roles = listRoles();
        expect(roles.length).toBeGreaterThanOrEqual(5);
    });

    it('should seed all built-in roles on init', () => {
        initSSOTables();
        const roles = listRoles();
        const names = roles.map(r => r.name);

        expect(names).toContain('admin');
        expect(names).toContain('operator');
        expect(names).toContain('developer');
        expect(names).toContain('viewer');
        expect(names).toContain('service-account');
    });

    it('built-in roles should have the correct permission counts', () => {
        initSSOTables();
        const admin = getRole('admin');
        expect(admin!.permissions.length).toBe(Object.keys(PERMISSIONS).length);

        const viewer = getRole('viewer');
        expect(viewer!.permissions.length).toBeLessThan(admin!.permissions.length);
    });
});

// ---------------------------------------------------------------------------
// Integration: Full RBAC Workflow
// ---------------------------------------------------------------------------

describe('Full RBAC Workflow', () => {
    it('should handle a complete user lifecycle', () => {
        initSSOTables();

        // 1. Create custom role
        createCustomRole('infra-team', [
            'nodes.list', 'nodes.drain', 'nodes.overclock',
            'models.list', 'models.deploy',
            'system.config',
        ], 'Infrastructure team with node management');

        // 2. Create user and assign roles
        const userId = 'workflow-user';
        testDb.prepare(`INSERT INTO sso_users (id, username, email) VALUES (?, ?, ?)`).run(
            userId, 'charlie', 'charlie@company.com',
        );

        assignRole(userId, 'viewer'); // global baseline
        assignRole(userId, 'infra-team', 'production'); // namespace elevated

        // 3. Verify permissions
        // Global: only viewer
        expect(checkPermission(userId, 'models.list')).toBe(true);
        expect(checkPermission(userId, 'nodes.drain')).toBe(false);
        expect(checkPermission(userId, 'system.config')).toBe(false);

        // Production namespace: viewer + infra-team
        expect(checkPermission(userId, 'models.list', 'production')).toBe(true);
        expect(checkPermission(userId, 'nodes.drain', 'production')).toBe(true);
        expect(checkPermission(userId, 'system.config', 'production')).toBe(true);
        expect(checkPermission(userId, 'users.create', 'production')).toBe(false); // not in either role

        // Staging namespace: only viewer (no namespace role)
        expect(checkPermission(userId, 'nodes.drain', 'staging')).toBe(false);

        // 4. Promote to operator globally
        assignRole(userId, 'operator');
        expect(checkPermission(userId, 'nodes.drain')).toBe(true);

        // 5. Remove the custom namespace role
        removeRole(userId, 'infra-team', 'production');
        // Still has operator globally so nodes.drain is fine everywhere
        expect(checkPermission(userId, 'nodes.drain', 'production')).toBe(true);
        // But system.config was only in infra-team, and operator doesn't have it
        expect(checkPermission(userId, 'system.config', 'production')).toBe(false);

        // 6. Verify user object
        const user = getSSOUser(userId);
        expect(user).not.toBeNull();
        expect(user!.roles).toContain('viewer');
        expect(user!.roles).toContain('operator');
    });

    it('should handle service account alongside user RBAC', () => {
        initSSOTables();

        // Create a service account for automated inference
        const sa = createServiceAccount('ci-pipeline', 'ci', [
            'inference.chat', 'inference.embed', 'models.list',
        ]);

        // SA has its own flat permissions
        expect(checkServiceAccountPermission(sa.token, 'inference.chat', 'ci')).toBe(true);
        expect(checkServiceAccountPermission(sa.token, 'models.list', 'ci')).toBe(true);
        expect(checkServiceAccountPermission(sa.token, 'models.deploy', 'ci')).toBe(false);

        // SA is namespace-scoped — can't access other namespaces
        expect(checkServiceAccountPermission(sa.token, 'inference.chat', 'production')).toBe(false);

        // Rotate token
        const rotated = rotateServiceAccountToken(sa.id);
        expect(checkServiceAccountPermission(sa.token, 'inference.chat', 'ci')).toBe(false); // old token invalid
        expect(checkServiceAccountPermission(rotated.token, 'inference.chat', 'ci')).toBe(true); // new token works
    });
});
