// F:\tentaclaw-os\gateway\src\sso.ts
// Enterprise SSO & RBAC
// CLAWtopus says: "The family has rules. You follow the rules, you're in."

import { getDb } from './db';
import { createHash, randomBytes } from 'crypto';

// =============================================================================
// OIDC Provider Configuration
// =============================================================================

export interface OIDCConfig {
    enabled: boolean;
    issuerUrl: string;              // https://accounts.google.com
    clientId: string;
    clientSecret: string;
    redirectUri: string;            // http://gateway:8080/auth/callback
    scopes: string[];               // ['openid', 'profile', 'email']
    groupsClaim?: string;           // OIDC claim that contains group memberships
    groupToRoleMapping?: Record<string, string>; // { "ml-team": "operator", "admins": "admin" }
    autoCreateUser?: boolean;       // Create user on first login (default true)
    allowedDomains?: string[];      // Only allow @company.com emails
}

export interface OIDCDiscoveryDocument {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
    jwks_uri: string;
    end_session_endpoint?: string;
    scopes_supported?: string[];
    response_types_supported?: string[];
}

export interface OIDCTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    id_token?: string;
    scope?: string;
}

export interface OIDCUserInfo {
    sub: string;
    name?: string;
    email?: string;
    email_verified?: boolean;
    groups?: string[];
    preferred_username?: string;
    picture?: string;
    [key: string]: unknown;
}

// =============================================================================
// SSO Session Types
// =============================================================================

export interface SSOSession {
    id: string;
    userId: string;
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    expiresAt: string;
    createdAt: string;
}

export interface SSOUser {
    id: string;
    username: string;
    email: string | null;
    displayName: string | null;
    oidcSubject: string | null;
    oidcIssuer: string | null;
    roles: string[];
    namespaceRoles: Record<string, string[]>;
    lastLoginAt: string | null;
    createdAt: string;
}

export interface SSOCallbackResult {
    user: SSOUser;
    session: SSOSession;
    created: boolean; // true if user was newly created
}

// =============================================================================
// Fine-Grained RBAC — 50+ Permissions
// =============================================================================

export const PERMISSIONS = {
    // Models
    'models.list': 'List loaded models',
    'models.deploy': 'Deploy models to nodes',
    'models.delete': 'Remove models from nodes',
    'models.search': 'Search model catalog',
    // Nodes
    'nodes.list': 'List cluster nodes',
    'nodes.drain': 'Drain/cordon nodes',
    'nodes.delete': 'Remove nodes',
    'nodes.overclock': 'Change GPU settings',
    // Namespaces
    'namespaces.create': 'Create namespaces',
    'namespaces.delete': 'Delete namespaces',
    'namespaces.manage': 'Manage namespace settings',
    // Fine-tuning
    'finetune.create': 'Create fine-tune jobs',
    'finetune.cancel': 'Cancel fine-tune jobs',
    'finetune.list': 'List fine-tune jobs',
    // Benchmarks
    'benchmarks.run': 'Run benchmarks',
    'benchmarks.list': 'View benchmark results',
    // API Keys
    'apikeys.create': 'Create API keys',
    'apikeys.revoke': 'Revoke API keys',
    'apikeys.list': 'List API keys',
    // Users
    'users.list': 'List users',
    'users.create': 'Create users',
    'users.delete': 'Delete users',
    'users.roles': 'Change user roles',
    // System
    'system.config': 'Change system configuration',
    'system.backup': 'Export/import cluster config',
    'system.audit': 'View audit logs',
    'system.sso': 'Configure SSO',
    // Inference
    'inference.chat': 'Use chat completions API',
    'inference.embed': 'Use embeddings API',
    'inference.images': 'Use image generation API',
    'inference.audio': 'Use audio API',
    // CLAWHub
    'clawhub.install': 'Install CLAWHub packages',
    'clawhub.publish': 'Publish CLAWHub packages',
    // Webhooks
    'webhooks.manage': 'Create/delete webhooks',
    // Alerts
    'alerts.manage': 'Manage alert rules',
    'alerts.acknowledge': 'Acknowledge alerts',
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * All known permission keys as a typed array.
 */
const ALL_PERMISSIONS: Permission[] = Object.keys(PERMISSIONS) as Permission[];

// =============================================================================
// Pre-built Role Templates
// =============================================================================

/**
 * Expand wildcard patterns like 'models.*' into their matching concrete permissions.
 */
function expandWildcards(patterns: string[]): Permission[] {
    const result = new Set<Permission>();
    for (const pattern of patterns) {
        if (pattern.endsWith('.*')) {
            const prefix = pattern.slice(0, -1); // 'models.'
            for (const perm of ALL_PERMISSIONS) {
                if (perm.startsWith(prefix)) {
                    result.add(perm);
                }
            }
        } else if (ALL_PERMISSIONS.includes(pattern as Permission)) {
            result.add(pattern as Permission);
        }
    }
    return Array.from(result);
}

export const ROLE_TEMPLATES: Record<string, Permission[]> = {
    admin: [...ALL_PERMISSIONS],
    operator: expandWildcards([
        'models.*', 'nodes.*', 'namespaces.manage',
        'finetune.*', 'benchmarks.*', 'apikeys.*',
        'inference.*', 'clawhub.*', 'webhooks.*', 'alerts.*',
    ]),
    developer: expandWildcards([
        'models.list', 'models.search', 'nodes.list',
        'finetune.create', 'finetune.list', 'benchmarks.*',
        'inference.*', 'clawhub.install',
    ]),
    viewer: expandWildcards([
        'models.list', 'nodes.list', 'benchmarks.list',
        'inference.chat', 'inference.embed',
    ]),
    'service-account': expandWildcards(['inference.*']),
};

// =============================================================================
// Custom Role Type
// =============================================================================

export interface CustomRole {
    name: string;
    permissions: Permission[];
    description: string;
    createdAt: string;
}

// =============================================================================
// Service Account Types
// =============================================================================

export interface ServiceAccount {
    id: string;
    name: string;
    namespace: string | null;
    tokenHash: string;
    tokenPrefix: string;
    permissions: Permission[];
    lastUsedAt: string | null;
    createdAt: string;
}

export interface ServiceAccountWithToken extends ServiceAccount {
    /** Plaintext token — only returned once at creation or rotation. */
    token: string;
}

// =============================================================================
// Module State
// =============================================================================

/** Cached OIDC discovery document per issuer URL. */
const discoveryCache = new Map<string, { doc: OIDCDiscoveryDocument; fetchedAt: number }>();

/** How long to cache OIDC discovery documents (1 hour). */
const DISCOVERY_CACHE_TTL_MS = 3600_000;

// =============================================================================
// Database Schema Init (for SSO tables)
// =============================================================================

/**
 * Ensure SSO/RBAC tables exist. Called lazily on first use.
 * This is idempotent — safe to call repeatedly.
 */
let ssoTablesInitialized = false;

export function initSSOTables(): void {
    if (ssoTablesInitialized) return;
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS oidc_config (
            id TEXT PRIMARY KEY DEFAULT 'default',
            enabled INTEGER DEFAULT 0,
            issuer_url TEXT NOT NULL DEFAULT '',
            client_id TEXT NOT NULL DEFAULT '',
            client_secret TEXT NOT NULL DEFAULT '',
            redirect_uri TEXT NOT NULL DEFAULT '',
            scopes TEXT NOT NULL DEFAULT '["openid","profile","email"]',
            groups_claim TEXT,
            group_to_role_mapping TEXT DEFAULT '{}',
            auto_create_user INTEGER DEFAULT 1,
            allowed_domains TEXT DEFAULT '[]',
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS roles (
            name TEXT PRIMARY KEY,
            permissions TEXT NOT NULL,
            description TEXT DEFAULT '',
            is_builtin INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_roles (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            role_name TEXT NOT NULL,
            namespace TEXT,
            granted_by TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, role_name, namespace)
        );

        CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_name);
        CREATE INDEX IF NOT EXISTS idx_user_roles_ns ON user_roles(namespace);

        CREATE TABLE IF NOT EXISTS service_accounts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            namespace TEXT,
            token_hash TEXT NOT NULL UNIQUE,
            token_prefix TEXT NOT NULL,
            permissions TEXT NOT NULL DEFAULT '[]',
            last_used_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sa_namespace ON service_accounts(namespace);
        CREATE INDEX IF NOT EXISTS idx_sa_token_hash ON service_accounts(token_hash);

        CREATE TABLE IF NOT EXISTS sso_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            id_token TEXT,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sso_sessions_user ON sso_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sso_sessions_expires ON sso_sessions(expires_at);

        CREATE TABLE IF NOT EXISTS sso_users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT,
            display_name TEXT,
            oidc_subject TEXT,
            oidc_issuer TEXT,
            last_login_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sso_users_oidc ON sso_users(oidc_issuer, oidc_subject);
        CREATE INDEX IF NOT EXISTS idx_sso_users_email ON sso_users(email);
    `);

    // Seed built-in role templates
    seedBuiltinRoles();

    ssoTablesInitialized = true;
}

/**
 * Seed built-in roles from ROLE_TEMPLATES if they don't already exist.
 */
function seedBuiltinRoles(): void {
    const db = getDb();
    const insert = db.prepare(
        `INSERT OR IGNORE INTO roles (name, permissions, description, is_builtin) VALUES (?, ?, ?, 1)`,
    );

    const descriptions: Record<string, string> = {
        admin: 'Full access to all cluster operations',
        operator: 'Day-to-day cluster management without user/system admin',
        developer: 'Read-only cluster access with inference and fine-tune capabilities',
        viewer: 'Read-only access to models, nodes, benchmarks, and basic inference',
        'service-account': 'Machine-to-machine inference access only',
    };

    db.transaction(() => {
        for (const [name, perms] of Object.entries(ROLE_TEMPLATES)) {
            insert.run(name, JSON.stringify(perms), descriptions[name] || '');
        }
    })();
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
    return Date.now().toString(36) + randomBytes(6).toString('hex');
}

function generateToken(): string {
    return 'tc_' + randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function now(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// =============================================================================
// OIDC Discovery
// =============================================================================

/**
 * Fetch the OIDC discovery document from the well-known endpoint.
 * Caches the result for DISCOVERY_CACHE_TTL_MS.
 */
export async function fetchDiscoveryDocument(issuerUrl: string): Promise<OIDCDiscoveryDocument> {
    const cached = discoveryCache.get(issuerUrl);
    if (cached && Date.now() - cached.fetchedAt < DISCOVERY_CACHE_TTL_MS) {
        return cached.doc;
    }

    const wellKnownUrl = issuerUrl.replace(/\/+$/, '') + '/.well-known/openid-configuration';
    const response = await fetch(wellKnownUrl);
    if (!response.ok) {
        throw new Error(`OIDC discovery failed for ${issuerUrl}: ${response.status} ${response.statusText}`);
    }

    const doc = (await response.json()) as OIDCDiscoveryDocument;
    discoveryCache.set(issuerUrl, { doc, fetchedAt: Date.now() });
    return doc;
}

// =============================================================================
// OIDC Configuration Management
// =============================================================================

/**
 * Get the current OIDC configuration, or a disabled default if none is stored.
 */
export function getOIDCConfig(): OIDCConfig {
    initSSOTables();
    const db = getDb();
    const row = db.prepare('SELECT * FROM oidc_config WHERE id = ?').get('default') as Record<string, unknown> | undefined;

    if (!row) {
        return {
            enabled: false,
            issuerUrl: '',
            clientId: '',
            clientSecret: '',
            redirectUri: '',
            scopes: ['openid', 'profile', 'email'],
            groupsClaim: undefined,
            groupToRoleMapping: {},
            autoCreateUser: true,
            allowedDomains: [],
        };
    }

    return {
        enabled: row.enabled === 1,
        issuerUrl: row.issuer_url as string,
        clientId: row.client_id as string,
        clientSecret: row.client_secret as string,
        redirectUri: row.redirect_uri as string,
        scopes: JSON.parse((row.scopes as string) || '["openid","profile","email"]'),
        groupsClaim: (row.groups_claim as string) || undefined,
        groupToRoleMapping: JSON.parse((row.group_to_role_mapping as string) || '{}'),
        autoCreateUser: row.auto_create_user !== 0,
        allowedDomains: JSON.parse((row.allowed_domains as string) || '[]'),
    };
}

/**
 * Update OIDC settings. Performs an upsert on the singleton config row.
 */
export function updateOIDCConfig(config: Partial<OIDCConfig>): OIDCConfig {
    initSSOTables();
    const db = getDb();
    const current = getOIDCConfig();
    const merged: OIDCConfig = { ...current, ...config };

    db.prepare(`
        INSERT INTO oidc_config (id, enabled, issuer_url, client_id, client_secret, redirect_uri,
            scopes, groups_claim, group_to_role_mapping, auto_create_user, allowed_domains, updated_at)
        VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            issuer_url = excluded.issuer_url,
            client_id = excluded.client_id,
            client_secret = excluded.client_secret,
            redirect_uri = excluded.redirect_uri,
            scopes = excluded.scopes,
            groups_claim = excluded.groups_claim,
            group_to_role_mapping = excluded.group_to_role_mapping,
            auto_create_user = excluded.auto_create_user,
            allowed_domains = excluded.allowed_domains,
            updated_at = excluded.updated_at
    `).run(
        merged.enabled ? 1 : 0,
        merged.issuerUrl,
        merged.clientId,
        merged.clientSecret,
        merged.redirectUri,
        JSON.stringify(merged.scopes),
        merged.groupsClaim || null,
        JSON.stringify(merged.groupToRoleMapping || {}),
        merged.autoCreateUser !== false ? 1 : 0,
        JSON.stringify(merged.allowedDomains || []),
    );

    // Invalidate discovery cache if issuer changed
    if (config.issuerUrl && config.issuerUrl !== current.issuerUrl) {
        discoveryCache.delete(current.issuerUrl);
    }

    return merged;
}

// =============================================================================
// SSO Flow
// =============================================================================

/**
 * Generate an OIDC authorization URL for the redirect-based login flow.
 * @param state - Optional opaque state parameter for CSRF protection.
 */
export async function getAuthorizationUrl(state?: string): Promise<string> {
    const config = getOIDCConfig();
    if (!config.enabled) {
        throw new Error('SSO is not enabled');
    }
    if (!config.issuerUrl || !config.clientId) {
        throw new Error('OIDC issuer URL and client ID are required');
    }

    const discovery = await fetchDiscoveryDocument(config.issuerUrl);
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: config.scopes.join(' '),
        state: state || randomBytes(16).toString('hex'),
    });

    return `${discovery.authorization_endpoint}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens, create/update the user, and create a session.
 * @param code - The authorization code from the OIDC callback.
 * @param _state - The state parameter from the callback (for CSRF validation by the caller).
 */
export async function handleCallback(code: string, _state?: string): Promise<SSOCallbackResult> {
    const config = getOIDCConfig();
    if (!config.enabled) {
        throw new Error('SSO is not enabled');
    }

    const discovery = await fetchDiscoveryDocument(config.issuerUrl);

    // Exchange code for tokens
    const tokenResponse = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.redirectUri,
            client_id: config.clientId,
            client_secret: config.clientSecret,
        }),
    });

    if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text();
        throw new Error(`OIDC token exchange failed: ${tokenResponse.status} — ${errBody}`);
    }

    const tokens = (await tokenResponse.json()) as OIDCTokenResponse;

    // Fetch user info
    const userInfoResponse = await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
        throw new Error(`OIDC userinfo request failed: ${userInfoResponse.status}`);
    }

    const userInfo = (await userInfoResponse.json()) as OIDCUserInfo;

    // Validate email domain if restricted
    if (config.allowedDomains && config.allowedDomains.length > 0 && userInfo.email) {
        const domain = userInfo.email.split('@')[1]?.toLowerCase();
        if (!domain || !config.allowedDomains.some(d => d.toLowerCase() === domain)) {
            throw new Error(`Email domain "${domain}" is not in the allowed domains list`);
        }
    }

    // Extract groups from the configured claim
    let groups: string[] = [];
    if (config.groupsClaim && userInfo[config.groupsClaim]) {
        const raw = userInfo[config.groupsClaim];
        groups = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    }

    // Find or create user
    initSSOTables();
    const db = getDb();
    let existingUser = db.prepare(
        'SELECT * FROM sso_users WHERE oidc_issuer = ? AND oidc_subject = ?',
    ).get(config.issuerUrl, userInfo.sub) as Record<string, unknown> | undefined;

    let created = false;

    if (!existingUser) {
        if (config.autoCreateUser === false) {
            throw new Error('Auto-creation of users is disabled and this user does not exist');
        }

        const userId = generateId();
        const username = userInfo.preferred_username || userInfo.email || userInfo.sub;

        db.prepare(`
            INSERT INTO sso_users (id, username, email, display_name, oidc_subject, oidc_issuer, last_login_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(userId, username, userInfo.email || null, userInfo.name || null, userInfo.sub, config.issuerUrl);

        // Assign default role (viewer) unless group mapping overrides
        assignRole(userId, 'viewer');

        existingUser = db.prepare('SELECT * FROM sso_users WHERE id = ?').get(userId) as Record<string, unknown>;
        created = true;
    } else {
        // Update last login
        db.prepare(
            "UPDATE sso_users SET last_login_at = datetime('now'), display_name = ? WHERE id = ?",
        ).run(userInfo.name || null, existingUser.id as string);
    }

    const userId = existingUser.id as string;

    // Apply group-to-role mapping
    if (config.groupToRoleMapping && Object.keys(config.groupToRoleMapping).length > 0) {
        for (const group of groups) {
            const roleName = config.groupToRoleMapping[group];
            if (roleName) {
                assignRole(userId, roleName);
            }
        }
    }

    // Create session
    const sessionId = generateId();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
        INSERT INTO sso_sessions (id, user_id, access_token, refresh_token, id_token, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, userId, tokens.access_token, tokens.refresh_token || null, tokens.id_token || null, expiresAt);

    const user = loadSSOUser(userId);
    const session: SSOSession = {
        id: sessionId,
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        idToken: tokens.id_token || null,
        expiresAt,
        createdAt: now(),
    };

    return { user, session, created };
}

/**
 * Refresh an SSO session using the stored refresh token.
 * Returns a new session with updated tokens, or throws if refresh fails.
 */
export async function refreshSession(refreshToken: string): Promise<SSOSession> {
    const config = getOIDCConfig();
    if (!config.enabled) {
        throw new Error('SSO is not enabled');
    }

    const discovery = await fetchDiscoveryDocument(config.issuerUrl);

    const tokenResponse = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: config.clientId,
            client_secret: config.clientSecret,
        }),
    });

    if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text();
        throw new Error(`OIDC token refresh failed: ${tokenResponse.status} — ${errBody}`);
    }

    const tokens = (await tokenResponse.json()) as OIDCTokenResponse;

    // Find the session that owns this refresh token
    initSSOTables();
    const db = getDb();
    const existingSession = db.prepare(
        'SELECT * FROM sso_sessions WHERE refresh_token = ?',
    ).get(refreshToken) as Record<string, unknown> | undefined;

    if (!existingSession) {
        throw new Error('No session found for the given refresh token');
    }

    // Delete old session and create new one
    db.prepare('DELETE FROM sso_sessions WHERE id = ?').run(existingSession.id as string);

    const sessionId = generateId();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
        INSERT INTO sso_sessions (id, user_id, access_token, refresh_token, id_token, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        sessionId,
        existingSession.user_id as string,
        tokens.access_token,
        tokens.refresh_token || refreshToken, // Reuse old refresh token if new one not issued
        tokens.id_token || null,
        expiresAt,
    );

    return {
        id: sessionId,
        userId: existingSession.user_id as string,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        idToken: tokens.id_token || null,
        expiresAt,
        createdAt: now(),
    };
}

// =============================================================================
// User Loading
// =============================================================================

/**
 * Load a fully populated SSOUser including roles and namespace-scoped roles.
 */
function loadSSOUser(userId: string): SSOUser {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sso_users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
    if (!row) {
        throw new Error(`SSO user not found: ${userId}`);
    }

    // Load global roles (namespace IS NULL)
    const globalRoles = db.prepare(
        'SELECT role_name FROM user_roles WHERE user_id = ? AND namespace IS NULL',
    ).all(userId) as { role_name: string }[];

    // Load namespace-scoped roles
    const nsRoles = db.prepare(
        'SELECT role_name, namespace FROM user_roles WHERE user_id = ? AND namespace IS NOT NULL',
    ).all(userId) as { role_name: string; namespace: string }[];

    const namespaceRoles: Record<string, string[]> = {};
    for (const nr of nsRoles) {
        if (!namespaceRoles[nr.namespace]) {
            namespaceRoles[nr.namespace] = [];
        }
        namespaceRoles[nr.namespace].push(nr.role_name);
    }

    return {
        id: row.id as string,
        username: row.username as string,
        email: (row.email as string) || null,
        displayName: (row.display_name as string) || null,
        oidcSubject: (row.oidc_subject as string) || null,
        oidcIssuer: (row.oidc_issuer as string) || null,
        roles: globalRoles.map(r => r.role_name),
        namespaceRoles,
        lastLoginAt: (row.last_login_at as string) || null,
        createdAt: row.created_at as string,
    };
}

/**
 * Get an SSO user by ID.
 */
export function getSSOUser(userId: string): SSOUser | null {
    initSSOTables();
    try {
        return loadSSOUser(userId);
    } catch {
        return null;
    }
}

/**
 * Get an SSO user by OIDC subject + issuer.
 */
export function getSSOUserByOIDC(issuer: string, subject: string): SSOUser | null {
    initSSOTables();
    const db = getDb();
    const row = db.prepare(
        'SELECT id FROM sso_users WHERE oidc_issuer = ? AND oidc_subject = ?',
    ).get(issuer, subject) as { id: string } | undefined;

    if (!row) return null;
    return loadSSOUser(row.id);
}

/**
 * List all SSO users.
 */
export function listSSOUsers(): SSOUser[] {
    initSSOTables();
    const db = getDb();
    const rows = db.prepare('SELECT id FROM sso_users ORDER BY created_at DESC').all() as { id: string }[];
    return rows.map(r => loadSSOUser(r.id));
}

// =============================================================================
// Permission Checking
// =============================================================================

/**
 * Resolve the effective permissions for a role name by looking up either
 * a built-in template or a custom role stored in the DB.
 */
function resolveRolePermissions(roleName: string): Permission[] {
    // Check built-in templates first
    if (ROLE_TEMPLATES[roleName]) {
        return ROLE_TEMPLATES[roleName];
    }

    // Check custom roles in DB
    const db = getDb();
    const row = db.prepare('SELECT permissions FROM roles WHERE name = ?').get(roleName) as { permissions: string } | undefined;
    if (row) {
        return JSON.parse(row.permissions) as Permission[];
    }

    return [];
}

/**
 * Check if a user has a specific permission, optionally scoped to a namespace.
 * Returns true if any of the user's roles (global or namespace-scoped) grant the permission.
 */
export function checkPermission(userId: string, permission: Permission, namespace?: string): boolean {
    initSSOTables();
    const effectivePerms = getUserPermissions(userId, namespace);
    return effectivePerms.includes(permission);
}

/**
 * List all effective permissions for a user, optionally scoped to a namespace.
 * Merges global roles with namespace-specific roles.
 */
export function getUserPermissions(userId: string, namespace?: string): Permission[] {
    initSSOTables();
    const db = getDb();
    const permSet = new Set<Permission>();

    // Global roles always apply
    const globalRoles = db.prepare(
        'SELECT role_name FROM user_roles WHERE user_id = ? AND namespace IS NULL',
    ).all(userId) as { role_name: string }[];

    for (const { role_name } of globalRoles) {
        for (const perm of resolveRolePermissions(role_name)) {
            permSet.add(perm);
        }
    }

    // If a namespace is specified, also include namespace-scoped roles
    if (namespace) {
        const nsRoles = db.prepare(
            'SELECT role_name FROM user_roles WHERE user_id = ? AND namespace = ?',
        ).all(userId, namespace) as { role_name: string }[];

        for (const { role_name } of nsRoles) {
            for (const perm of resolveRolePermissions(role_name)) {
                permSet.add(perm);
            }
        }
    }

    return Array.from(permSet);
}

/**
 * Assign a role to a user. Can be global (namespace=undefined) or namespace-scoped.
 * Idempotent — assigning the same role twice is a no-op.
 *
 * Note: SQLite treats NULLs as distinct in UNIQUE constraints, so we check
 * for an existing global assignment explicitly when namespace is null.
 */
export function assignRole(userId: string, role: string, namespace?: string): void {
    initSSOTables();
    const db = getDb();

    // Check if the assignment already exists (handling NULL namespace explicitly)
    let existing;
    if (namespace) {
        existing = db.prepare(
            'SELECT id FROM user_roles WHERE user_id = ? AND role_name = ? AND namespace = ?',
        ).get(userId, role, namespace);
    } else {
        existing = db.prepare(
            'SELECT id FROM user_roles WHERE user_id = ? AND role_name = ? AND namespace IS NULL',
        ).get(userId, role);
    }

    if (existing) return; // Already assigned — no-op

    const id = generateId();
    db.prepare(`
        INSERT INTO user_roles (id, user_id, role_name, namespace)
        VALUES (?, ?, ?, ?)
    `).run(id, userId, role, namespace || null);
}

/**
 * Remove a role from a user. Can target global or namespace-scoped assignments.
 */
export function removeRole(userId: string, role: string, namespace?: string): boolean {
    initSSOTables();
    const db = getDb();
    let result;
    if (namespace) {
        result = db.prepare(
            'DELETE FROM user_roles WHERE user_id = ? AND role_name = ? AND namespace = ?',
        ).run(userId, role, namespace);
    } else {
        result = db.prepare(
            'DELETE FROM user_roles WHERE user_id = ? AND role_name = ? AND namespace IS NULL',
        ).run(userId, role);
    }
    return result.changes > 0;
}

/**
 * Get all roles assigned to a user (global + namespace-scoped).
 */
export function getUserRoles(userId: string): { role_name: string; namespace: string | null }[] {
    initSSOTables();
    const db = getDb();
    return db.prepare(
        'SELECT role_name, namespace FROM user_roles WHERE user_id = ? ORDER BY namespace, role_name',
    ).all(userId) as { role_name: string; namespace: string | null }[];
}

// =============================================================================
// Custom Role Management
// =============================================================================

/**
 * Create a custom role with a given set of permissions.
 * Throws if the role name conflicts with a built-in template.
 */
export function createCustomRole(name: string, permissions: Permission[], description?: string): CustomRole {
    initSSOTables();

    if (ROLE_TEMPLATES[name]) {
        throw new Error(`Cannot create custom role "${name}" — it conflicts with a built-in role`);
    }

    // Validate all permissions
    for (const perm of permissions) {
        if (!ALL_PERMISSIONS.includes(perm)) {
            throw new Error(`Unknown permission: ${perm}`);
        }
    }

    const db = getDb();
    db.prepare(`
        INSERT INTO roles (name, permissions, description, is_builtin)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(name) DO UPDATE SET
            permissions = excluded.permissions,
            description = excluded.description
    `).run(name, JSON.stringify(permissions), description || '');

    return {
        name,
        permissions,
        description: description || '',
        createdAt: now(),
    };
}

/**
 * Delete a custom role. Cannot delete built-in roles.
 */
export function deleteCustomRole(name: string): boolean {
    initSSOTables();

    if (ROLE_TEMPLATES[name]) {
        throw new Error(`Cannot delete built-in role "${name}"`);
    }

    const db = getDb();
    const result = db.prepare('DELETE FROM roles WHERE name = ? AND is_builtin = 0').run(name);

    // Also remove all user_roles assignments for this role
    if (result.changes > 0) {
        db.prepare('DELETE FROM user_roles WHERE role_name = ?').run(name);
    }

    return result.changes > 0;
}

/**
 * List all roles (built-in + custom).
 */
export function listRoles(): CustomRole[] {
    initSSOTables();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM roles ORDER BY is_builtin DESC, name').all() as {
        name: string;
        permissions: string;
        description: string;
        created_at: string;
    }[];

    return rows.map(r => ({
        name: r.name,
        permissions: JSON.parse(r.permissions) as Permission[],
        description: r.description,
        createdAt: r.created_at,
    }));
}

/**
 * Get a single role by name.
 */
export function getRole(name: string): CustomRole | null {
    initSSOTables();
    const db = getDb();
    const row = db.prepare('SELECT * FROM roles WHERE name = ?').get(name) as {
        name: string;
        permissions: string;
        description: string;
        created_at: string;
    } | undefined;

    if (!row) return null;

    return {
        name: row.name,
        permissions: JSON.parse(row.permissions) as Permission[],
        description: row.description,
        createdAt: row.created_at,
    };
}

// =============================================================================
// Service Accounts
// =============================================================================

/**
 * Create a non-human service account for API access.
 * Returns the plaintext token exactly once — it is hashed for storage.
 */
export function createServiceAccount(
    name: string,
    namespace: string | null,
    permissions: Permission[],
): ServiceAccountWithToken {
    initSSOTables();

    // Validate permissions
    for (const perm of permissions) {
        if (!ALL_PERMISSIONS.includes(perm)) {
            throw new Error(`Unknown permission: ${perm}`);
        }
    }

    const id = generateId();
    const token = generateToken();
    const tokenHash = hashToken(token);
    const tokenPrefix = token.slice(0, 7); // "tc_xxxx"

    const db = getDb();
    db.prepare(`
        INSERT INTO service_accounts (id, name, namespace, token_hash, token_prefix, permissions)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, namespace, tokenHash, tokenPrefix, JSON.stringify(permissions));

    return {
        id,
        name,
        namespace,
        tokenHash,
        tokenPrefix,
        permissions,
        lastUsedAt: null,
        createdAt: now(),
        token,
    };
}

/**
 * Rotate a service account's token. Invalidates the old token and returns a new one.
 */
export function rotateServiceAccountToken(id: string): ServiceAccountWithToken {
    initSSOTables();
    const db = getDb();
    const existing = db.prepare('SELECT * FROM service_accounts WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    if (!existing) {
        throw new Error(`Service account not found: ${id}`);
    }

    const newToken = generateToken();
    const newTokenHash = hashToken(newToken);
    const newTokenPrefix = newToken.slice(0, 7);

    db.prepare(
        'UPDATE service_accounts SET token_hash = ?, token_prefix = ? WHERE id = ?',
    ).run(newTokenHash, newTokenPrefix, id);

    return {
        id,
        name: existing.name as string,
        namespace: (existing.namespace as string) || null,
        tokenHash: newTokenHash,
        tokenPrefix: newTokenPrefix,
        permissions: JSON.parse(existing.permissions as string) as Permission[],
        lastUsedAt: (existing.last_used_at as string) || null,
        createdAt: existing.created_at as string,
        token: newToken,
    };
}

/**
 * Validate a service account token. Returns the service account if valid, null otherwise.
 * Also updates last_used_at on success.
 */
export function validateServiceAccountToken(token: string): ServiceAccount | null {
    initSSOTables();
    const db = getDb();
    const tokenHash = hashToken(token);
    const row = db.prepare('SELECT * FROM service_accounts WHERE token_hash = ?').get(tokenHash) as Record<string, unknown> | undefined;

    if (!row) return null;

    // Update last_used_at
    db.prepare("UPDATE service_accounts SET last_used_at = datetime('now') WHERE id = ?").run(row.id as string);

    return {
        id: row.id as string,
        name: row.name as string,
        namespace: (row.namespace as string) || null,
        tokenHash: row.token_hash as string,
        tokenPrefix: row.token_prefix as string,
        permissions: JSON.parse(row.permissions as string) as Permission[],
        lastUsedAt: now(),
        createdAt: row.created_at as string,
    };
}

/**
 * List service accounts, optionally filtered by namespace.
 */
export function listServiceAccounts(namespace?: string): ServiceAccount[] {
    initSSOTables();
    const db = getDb();

    let rows: Record<string, unknown>[];
    if (namespace) {
        rows = db.prepare(
            'SELECT * FROM service_accounts WHERE namespace = ? ORDER BY created_at DESC',
        ).all(namespace) as Record<string, unknown>[];
    } else {
        rows = db.prepare(
            'SELECT * FROM service_accounts ORDER BY created_at DESC',
        ).all() as Record<string, unknown>[];
    }

    return rows.map(row => ({
        id: row.id as string,
        name: row.name as string,
        namespace: (row.namespace as string) || null,
        tokenHash: row.token_hash as string,
        tokenPrefix: row.token_prefix as string,
        permissions: JSON.parse(row.permissions as string) as Permission[],
        lastUsedAt: (row.last_used_at as string) || null,
        createdAt: row.created_at as string,
    }));
}

/**
 * Delete a service account by ID.
 */
export function deleteServiceAccount(id: string): boolean {
    initSSOTables();
    const db = getDb();
    const result = db.prepare('DELETE FROM service_accounts WHERE id = ?').run(id);
    return result.changes > 0;
}

/**
 * Check if a service account has a specific permission, optionally scoped to a namespace.
 * Service account permissions are flat (not role-based), but namespace scoping is respected.
 */
export function checkServiceAccountPermission(
    token: string,
    permission: Permission,
    namespace?: string,
): boolean {
    const sa = validateServiceAccountToken(token);
    if (!sa) return false;

    // If service account is namespace-scoped, only allow access within that namespace
    if (sa.namespace && namespace && sa.namespace !== namespace) {
        return false;
    }

    return sa.permissions.includes(permission);
}

// =============================================================================
// Session Management
// =============================================================================

/**
 * Get an SSO session by ID.
 */
export function getSSOSession(sessionId: string): SSOSession | null {
    initSSOTables();
    const db = getDb();
    const row = db.prepare('SELECT * FROM sso_sessions WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
        id: row.id as string,
        userId: row.user_id as string,
        accessToken: row.access_token as string,
        refreshToken: (row.refresh_token as string) || null,
        idToken: (row.id_token as string) || null,
        expiresAt: row.expires_at as string,
        createdAt: row.created_at as string,
    };
}

/**
 * Delete an SSO session (logout).
 */
export function deleteSSOSession(sessionId: string): boolean {
    initSSOTables();
    const db = getDb();
    const result = db.prepare('DELETE FROM sso_sessions WHERE id = ?').run(sessionId);
    return result.changes > 0;
}

/**
 * Delete all sessions for a user (force logout everywhere).
 */
export function deleteAllUserSessions(userId: string): number {
    initSSOTables();
    const db = getDb();
    const result = db.prepare('DELETE FROM sso_sessions WHERE user_id = ?').run(userId);
    return result.changes;
}

/**
 * Clean up expired sessions.
 */
export function cleanExpiredSessions(): number {
    initSSOTables();
    const db = getDb();
    const result = db.prepare("DELETE FROM sso_sessions WHERE expires_at < datetime('now')").run();
    return result.changes;
}

// =============================================================================
// Reset (for testing)
// =============================================================================

/**
 * Reset module state. Used by tests to clear discovery cache.
 */
export function _resetSSOState(): void {
    discoveryCache.clear();
    ssoTablesInitialized = false;
}
