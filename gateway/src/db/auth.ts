/**
 * TentaCLAW Gateway — Auth Operations (API Keys, Sessions, Users, Audit Log)
 */

import { createHash, randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto';
import path from 'path';
import fs from 'fs';
import { getDb, generateId, dbPath } from './init';
import { safeJsonParse } from './safe-json';

/**
 * Parse a SQLite datetime string into a JS Date.
 * SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (no T, no Z).
 * JS Date constructor needs the ISO 8601 'T' separator to parse correctly.
 */
function parseSqliteDate(s: string): Date {
    if (s.includes('T')) return new Date(s);
    return new Date(s.replace(' ', 'T') + 'Z');
}

// =============================================================================
// API Key Management
// =============================================================================

export function createApiKey(
    name: string,
    scope: string = 'inference',
    rateLimitRpm: number = 1000,
    permissions?: string[],
    expiresAt?: string,
): { id: string; key: string; name: string; prefix: string; permissions: string[] } {
    const d = getDb();
    const id = generateId();
    const rawKey = 'tc_' + randomBytes(24).toString('hex'); // tc_<48 hex chars>
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 10);
    const perms = permissions ?? ['read', 'write', 'admin'];

    d.prepare(
        `INSERT INTO api_keys (id, name, key_hash, key_prefix, scope, rate_limit_rpm, permissions, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, keyHash, prefix, scope, rateLimitRpm, JSON.stringify(perms), expiresAt ?? null);

    return { id, key: rawKey, name, prefix, permissions: perms };
}

export interface ApiKeyValidationResult {
    valid: boolean;
    error?: 'not_found' | 'expired' | 'insufficient_permissions';
    keyId?: string;
    name?: string;
    scope?: string;
    permissions?: string[];
    rateLimitRpm?: number;
}

export function validateApiKey(rawKey: string, requiredPermission?: string): ApiKeyValidationResult {
    const d = getDb();
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const row = d.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1').get(keyHash) as any;

    if (!row) return { valid: false, error: 'not_found' };

    // Check expiration
    if (row.expires_at && parseSqliteDate(row.expires_at) < new Date()) {
        return { valid: false, error: 'expired' };
    }

    // Parse permissions -- backward compat: missing column -> full access
    const permissions: string[] = row.permissions
        ? safeJsonParse(row.permissions, ['read', 'write', 'admin'])
        : ['read', 'write', 'admin'];

    // Check required permission
    if (requiredPermission && !permissions.includes(requiredPermission) && !permissions.includes('admin')) {
        return { valid: false, error: 'insufficient_permissions' };
    }

    // Update last used
    d.prepare("UPDATE api_keys SET last_used_at = datetime('now'), requests_count = requests_count + 1 WHERE id = ?").run(row.id);

    return {
        valid: true,
        keyId: row.id,
        name: row.name,
        scope: row.scope,
        permissions,
        rateLimitRpm: row.rate_limit_rpm,
    };
}

export function trackApiKeyTokens(keyId: string, tokens: number): void {
    const d = getDb();
    d.prepare('UPDATE api_keys SET tokens_used = tokens_used + ? WHERE id = ?').run(tokens, keyId);
}

export function getAllApiKeys(): any[] {
    const d = getDb();
    const rows = d.prepare('SELECT id, name, key_prefix, scope, permissions, rate_limit_rpm, monthly_token_limit, tokens_used, requests_count, last_used_at, expires_at, enabled, created_at FROM api_keys ORDER BY created_at DESC').all() as any[];
    return rows.map(row => ({
        ...row,
        permissions: row.permissions ? safeJsonParse(row.permissions, ['read', 'write', 'admin']) : ['read', 'write', 'admin'],
    }));
}

export function revokeApiKey(id: string): boolean {
    const d = getDb();
    return d.prepare('UPDATE api_keys SET enabled = 0 WHERE id = ?').run(id).changes > 0;
}

export function deleteApiKey(id: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM api_keys WHERE id = ?').run(id).changes > 0;
}

// =============================================================================
// Multi-Tenant Authentication
// =============================================================================

export interface User {
    id: string;
    username: string;
    email: string | null;
    role: string;
    created_at: string;
    last_login_at: string | null;
}

export interface Session {
    id: string;
    user_id: string;
    token: string;
    expires_at: string;
    created_at: string;
}

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 64; // 512 bits
const PBKDF2_DIGEST = 'sha512';

function hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString('hex');
    return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
    if (stored.startsWith('pbkdf2$')) {
        const parts = stored.split('$');
        if (parts.length !== 4) return false;
        const [, iterStr, salt, hash] = parts;
        const iterations = parseInt(iterStr, 10);
        if (!iterations || !salt || !hash) return false;
        const computed = pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString('hex');
        const computedBuf = Buffer.from(computed, 'hex');
        const storedBuf = Buffer.from(hash, 'hex');
        if (computedBuf.length !== storedBuf.length) return false;
        return timingSafeEqual(computedBuf, storedBuf);
    }
    // Legacy SHA-256 format: salt$hash (timing-safe comparison)
    const [salt, hash] = stored.split('$');
    if (!salt || !hash) return false;
    const computed = createHash('sha256').update(salt + password).digest('hex');
    const computedBuf = Buffer.from(computed, 'hex');
    const storedBuf = Buffer.from(hash, 'hex');
    if (computedBuf.length !== storedBuf.length) return false;
    return timingSafeEqual(computedBuf, storedBuf);
}

export function createUser(
    username: string,
    password: string,
    role: string = 'user',
    email?: string,
): User {
    const d = getDb();
    const id = generateId();
    const passwordHash = hashPassword(password);

    d.prepare(
        `INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, username, email ?? null, passwordHash, role);

    return {
        id,
        username,
        email: email ?? null,
        role,
        created_at: new Date().toISOString(),
        last_login_at: null,
    };
}

export function authenticateUser(username: string, password: string): User | null {
    const d = getDb();
    const row = d.prepare(
        'SELECT * FROM users WHERE username = ?',
    ).get(username) as any;

    if (!row) return null;
    if (!row.password_hash || !verifyPassword(password, row.password_hash)) return null;

    d.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);

    return {
        id: row.id,
        username: row.username,
        email: row.email,
        role: row.role,
        created_at: row.created_at,
        last_login_at: new Date().toISOString(),
    };
}

export function createSession(userId: string): { token: string; expires_at: string } {
    const d = getDb();
    const id = generateId();
    const token = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    d.prepare(
        `INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`,
    ).run(id, userId, token, expiresAt);

    return { token, expires_at: expiresAt };
}

export function validateSession(token: string): User | null {
    const d = getDb();
    const session = d.prepare(
        'SELECT * FROM sessions WHERE token = ?',
    ).get(token) as any;

    if (!session) return null;

    if (parseSqliteDate(session.expires_at) < new Date()) {
        d.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
        return null;
    }

    const user = d.prepare(
        'SELECT id, username, email, role, created_at, last_login_at FROM users WHERE id = ?',
    ).get(session.user_id) as User | undefined;

    return user ?? null;
}

export function invalidateSession(token: string): boolean {
    const d = getDb();
    return d.prepare('DELETE FROM sessions WHERE token = ?').run(token).changes > 0;
}

export function getUsers(): User[] {
    const d = getDb();
    return d.prepare(
        'SELECT id, username, email, role, created_at, last_login_at FROM users ORDER BY created_at DESC',
    ).all() as User[];
}

export function deleteUser(id: string): boolean {
    const d = getDb();
    d.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return d.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
}

export function updateUserRole(id: string, role: string): boolean {
    const d = getDb();
    return d.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id).changes > 0;
}

export function createDefaultAdmin(): User | null {
    const d = getDb();

    const count = (d.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    if (count > 0) return null;

    const password = randomBytes(16).toString('hex');
    console.log(`[auth] SECURITY: First boot detected. Admin password written to: data/.admin-initial-password`);
    console.log('[auth] CHANGE THIS PASSWORD IMMEDIATELY after first login.');
    try {
        const pwPath = path.join(path.dirname(dbPath), '.admin-initial-password');
        fs.writeFileSync(pwPath, `admin:${password}\n`, { mode: 0o600 });
    } catch { /* best effort */ }

    setClusterConfig('admin_password_changed', 'false');

    return createUser('admin', password, 'admin', undefined);
}

export function updateUserPassword(userId: string, currentPassword: string, newPassword: string): boolean {
    const d = getDb();
    const row = d.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;

    if (!row) throw new Error('User not found');
    if (!verifyPassword(currentPassword, row.password_hash)) throw new Error('Current password is incorrect');
    if (newPassword.length < 8) throw new Error('New password must be at least 8 characters');

    const newHash = hashPassword(newPassword);
    d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);

    if (row.username === 'admin') {
        setClusterConfig('admin_password_changed', 'true');
    }

    return true;
}

export function isInitialAdminPassword(): boolean {
    const changed = getClusterConfig('admin_password_changed');
    return changed !== 'true';
}

// =============================================================================
// Cluster Secret Management
// =============================================================================

export function getClusterConfig(key: string): string | null {
    const d = getDb();
    const row = d.prepare('SELECT value FROM cluster_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
}

export function setClusterConfig(key: string, value: string): void {
    const d = getDb();
    d.prepare(
        `INSERT INTO cluster_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, value);
}

export function getOrCreateClusterSecret(): string {
    const existing = getClusterConfig('cluster_secret');
    if (existing) return existing;

    const secret = randomBytes(32).toString('hex');
    setClusterConfig('cluster_secret', secret);

    try {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const tentaclawDir = path.join(homeDir, '.tentaclaw');
        const keyPath = path.join(tentaclawDir, 'cluster.key');
        if (!fs.existsSync(tentaclawDir)) {
            fs.mkdirSync(tentaclawDir, { recursive: true, mode: 0o700 });
        }
        fs.writeFileSync(keyPath, secret, { mode: 0o600 });
        console.log(`[auth] Cluster secret saved to ${keyPath} (mode 0600)`);
    } catch (err) {
        console.warn('[auth] Could not write cluster.key file:', (err as Error).message);
    }

    console.log('[auth] Generated new 256-bit cluster secret. Distribute to agents via TENTACLAW_CLUSTER_SECRET env var.');
    return secret;
}

// =============================================================================
// Join Tokens -- Node Attestation
// =============================================================================

export function createJoinToken(label: string = '', maxUses: number = 1, hoursValid: number = 24, createdBy?: string): { id: string; token: string; prefix: string; expiresAt: string } {
    const d = getDb();
    const id = generateId();
    const rawToken = 'jt_' + randomBytes(24).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const prefix = rawToken.slice(0, 10);
    const expiresAt = new Date(Date.now() + hoursValid * 3600_000).toISOString();

    d.prepare(
        `INSERT INTO join_tokens (id, token_hash, token_prefix, label, max_uses, uses, expires_at, created_by) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(id, tokenHash, prefix, label, maxUses, expiresAt, createdBy ?? null);

    return { id, token: rawToken, prefix, expiresAt };
}

export function validateJoinToken(rawToken: string): { valid: boolean; error?: string } {
    const d = getDb();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const row = d.prepare('SELECT * FROM join_tokens WHERE token_hash = ?').get(tokenHash) as any;

    if (!row) return { valid: false, error: 'invalid_token' };
    if (parseSqliteDate(row.expires_at) < new Date()) return { valid: false, error: 'expired' };
    if (row.max_uses > 0 && row.uses >= row.max_uses) return { valid: false, error: 'max_uses_exceeded' };

    d.prepare('UPDATE join_tokens SET uses = uses + 1 WHERE id = ?').run(row.id);
    return { valid: true };
}

export function listJoinTokens(): any[] {
    const d = getDb();
    return d.prepare('SELECT id, token_prefix, label, max_uses, uses, expires_at, created_by, created_at FROM join_tokens ORDER BY created_at DESC').all();
}

export function deleteJoinToken(id: string): void {
    const d = getDb();
    d.prepare('DELETE FROM join_tokens WHERE id = ?').run(id);
}

// =============================================================================
// Audit Logging
// =============================================================================

export interface AuditEntry {
    id: number;
    event_type: string;
    actor: string | null;
    ip_address: string | null;
    detail: string | null;
    created_at: string;
}

export function recordAuditEvent(
    eventType: string,
    actor?: string,
    ipAddress?: string,
    detail?: string,
): void {
    const d = getDb();
    d.prepare(
        'INSERT INTO audit_log (event_type, actor, ip_address, detail) VALUES (?, ?, ?, ?)',
    ).run(eventType, actor ?? null, ipAddress ?? null, detail ?? null);
}

export function getAuditLog(limit: number = 100, eventType?: string): AuditEntry[] {
    const d = getDb();
    if (eventType) {
        return d.prepare(
            'SELECT * FROM audit_log WHERE event_type = ? ORDER BY created_at DESC LIMIT ?',
        ).all(eventType, limit) as AuditEntry[];
    }
    return d.prepare(
        'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?',
    ).all(limit) as AuditEntry[];
}

// =============================================================================
// Auth Failure Tracking (IP-based brute force protection)
// =============================================================================

export function recordAuthFailure(ipAddress: string): boolean {
    const d = getDb();
    const windowStart = new Date(Date.now() - 60_000).toISOString(); // 1-minute window

    const row = d.prepare(
        'SELECT * FROM auth_failures WHERE ip_address = ?',
    ).get(ipAddress) as { ip_address: string; failure_count: number; window_start: string; blocked_until: string | null } | undefined;

    if (row) {
        if (row.blocked_until && parseSqliteDate(row.blocked_until) > new Date()) {
            return true;
        }

        if (parseSqliteDate(row.window_start) < parseSqliteDate(windowStart)) {
            d.prepare(
                "UPDATE auth_failures SET failure_count = 1, window_start = datetime('now'), blocked_until = NULL WHERE ip_address = ?",
            ).run(ipAddress);
            return false;
        }

        const newCount = row.failure_count + 1;
        if (newCount >= 5) {
            const authBlockMs = parseInt(process.env.AUTH_BLOCK_DURATION_MS || '900000', 10) || 900_000;
            const blockedUntil = new Date(Date.now() + authBlockMs).toISOString();
            d.prepare(
                'UPDATE auth_failures SET failure_count = ?, blocked_until = ? WHERE ip_address = ?',
            ).run(newCount, blockedUntil, ipAddress);
            return true;
        }

        d.prepare(
            'UPDATE auth_failures SET failure_count = ? WHERE ip_address = ?',
        ).run(newCount, ipAddress);
        return false;
    }

    d.prepare(
        "INSERT INTO auth_failures (ip_address, failure_count, window_start) VALUES (?, 1, datetime('now'))",
    ).run(ipAddress);
    return false;
}

export function isIpBlocked(ipAddress: string): boolean {
    const d = getDb();
    const row = d.prepare(
        'SELECT blocked_until FROM auth_failures WHERE ip_address = ?',
    ).get(ipAddress) as { blocked_until: string | null } | undefined;

    if (!row || !row.blocked_until) return false;
    return parseSqliteDate(row.blocked_until) > new Date();
}

export function clearAuthFailures(ipAddress: string): void {
    const d = getDb();
    d.prepare('DELETE FROM auth_failures WHERE ip_address = ?').run(ipAddress);
}
