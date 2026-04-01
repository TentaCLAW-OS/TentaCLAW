/**
 * Admin routes — export/import, config, secrets, profiler, users, API keys,
 * sessions, auth, audit, notifications, etc.
 */
import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import {
    getDb,
    createFlightSheet,
    createSchedule,
    exportClusterConfig,
    importClusterConfig,
    createApiKey,
    getAllApiKeys,
    revokeApiKey,
    createUser,
    authenticateUser,
    createSession,
    invalidateSession,
    getUsers,
    deleteUser,
    updateUserRole,
    setClusterConfig,
    recordAuditEvent,
    getAuditLog,
    recordAuthFailure,
    isIpBlocked,
    clearAuthFailures,
    updateUserPassword,
    isInitialAdminPassword,
    createNotificationChannel,
    getAllNotificationChannels,
    deleteNotificationChannel,
    sendNotification,
    getCacheStats,
    pruneCache,
} from '../db';
import {
    getProfiles,
    getPerformanceSummary,
    getEndpointPerformance,
    generateLoadTestConfig,
    clearProfiles,
} from '../profiler';
import {
    broadcastSSE,
    sseClients,
    checkLoginRateLimit,
    LOGIN_RATE_LIMIT,
    getSessionUser,
    requireRole,
    CLUSTER_SECRET,
    agentAuthEnabled,
    setClusterSecretValue,
} from '../shared';

const routes = new Hono();

const PORT = parseInt(process.env.TENTACLAW_PORT || '8080');
const RATE_LIMIT = parseInt(process.env.TENTACLAW_RATE_LIMIT || '0');
const API_KEY = process.env.TENTACLAW_API_KEY || '';

// =============================================================================
// Export / Import
// =============================================================================

routes.get('/api/v1/export', (c) => {
    const d = getDb();
    const nodes = d.prepare('SELECT * FROM nodes').all();
    const flightSheets = d.prepare('SELECT * FROM flight_sheets').all();
    const schedules = d.prepare('SELECT * FROM schedules').all();

    return c.json({
        version: '0.1.0',
        exported_at: new Date().toISOString(),
        nodes,
        flight_sheets: (flightSheets as any[]).map(fs => ({ ...fs, targets: JSON.parse(fs.targets) })),
        schedules: (schedules as any[]).map(s => ({ ...s, config: JSON.parse(s.config) })),
    });
});

routes.post('/api/v1/import', async (c) => {
    const body = await c.req.json();
    let imported = { nodes: 0, flight_sheets: 0, schedules: 0 };

    if (body.flight_sheets) {
        for (const fs of body.flight_sheets) {
            createFlightSheet(fs.name, fs.description || '', fs.targets || []);
            imported.flight_sheets++;
        }
    }

    if (body.schedules) {
        for (const s of body.schedules) {
            createSchedule(s.name, s.type, s.cron, s.config || {});
            imported.schedules++;
        }
    }

    console.log('[tentaclaw] Import: ' + imported.flight_sheets + ' flight sheets, ' + imported.schedules + ' schedules');
    return c.json({ status: 'imported', imported });
});

// Config export/import (Wave 15)
routes.get('/api/v1/config/export', (c) => {
    return c.json(exportClusterConfig());
});

routes.post('/api/v1/config/import', async (c) => {
    const body = await c.req.json();
    const result = importClusterConfig(body);
    return c.json(result);
});

// =============================================================================
// Gateway Config
// =============================================================================

routes.get('/api/v1/config', (c) => {
    return c.json({
        version: '0.1.0',
        service: 'tentaclaw-gateway',
        features: {
            auth_enabled: !!API_KEY,
            rate_limiting: RATE_LIMIT > 0,
            rate_limit_per_min: RATE_LIMIT || null,
            openai_compat: true,
            prometheus_metrics: true,
            sse_streaming: true,
        },
        connections: {
            sse_clients: sseClients.length,
        },
        environment: {
            port: PORT,
            host: process.env.TENTACLAW_HOST || '0.0.0.0',
        },
    });
});

routes.get('/api/v1/config/cors', (c) => {
    return c.json({ allowed_origins: ['*'], methods: ['GET', 'POST', 'PUT', 'DELETE'], headers: ['Content-Type', 'Authorization'] });
});

routes.get('/api/v1/config/db-stats', (c) => {
    const d = getDb();
    const tables = ['nodes', 'stats', 'commands', 'flight_sheets', 'alerts', 'benchmarks', 'node_events', 'schedules',
        'ssh_keys', 'node_tags', 'model_pulls', 'uptime_events', 'overclock_profiles', 'watchdog_events',
        'notification_channels', 'inference_log', 'api_keys', 'prompt_cache', 'model_aliases'];

    const ALLOWED_TABLES = new Set(tables);
    const stats = tables.map(t => {
        try {
            if (!ALLOWED_TABLES.has(t) || !/^[a-z_]+$/.test(t)) return { table: t, rows: -1 };
            const row = d.prepare(`SELECT COUNT(*) as cnt FROM "${t}"`).get() as { cnt: number };
            return { table: t, rows: row.cnt };
        } catch { return { table: t, rows: -1 }; }
    });

    const dbSizeResult = d.pragma('page_count') as { page_count: number }[];
    const pageSizeResult = d.pragma('page_size') as { page_size: number }[];
    const totalBytes = (dbSizeResult[0]?.page_count || 0) * (pageSizeResult[0]?.page_size || 4096);

    return c.json({ tables: stats, total_tables: tables.length, db_size_mb: Math.round(totalBytes / 1048576 * 10) / 10 });
});

// =============================================================================
// API Key Management
// =============================================================================

routes.get('/api/v1/apikeys', (c) => {
    return c.json(getAllApiKeys());
});

routes.post('/api/v1/apikeys', async (c) => {
    const body = await c.req.json<{
        name: string;
        scope?: string;
        rate_limit_rpm?: number;
        permissions?: string[];
        expires_at?: string;
    }>();
    if (!body.name) return c.json({ error: 'name required' }, 400);

    const validPerms = ['read', 'write', 'admin'];
    if (body.permissions) {
        const invalid = body.permissions.filter(p => !validPerms.includes(p));
        if (invalid.length > 0) {
            return c.json({ error: `Invalid permissions: ${invalid.join(', ')}. Valid: ${validPerms.join(', ')}` }, 400);
        }
    }

    const result = createApiKey(
        body.name,
        body.scope || 'inference',
        body.rate_limit_rpm || 1000,
        body.permissions,
        body.expires_at,
    );

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('apikey_created', body.name, ip, `API key created: ${result.id} (prefix: ${result.key.slice(0, 10)})`);

    return c.json({
        id: result.id,
        key: result.key,
        prefix: result.key.slice(0, 10),
        name: result.name,
        permissions: result.permissions,
        message: 'Save this key — it will not be shown again.',
    }, 201);
});

routes.delete('/api/v1/apikeys/:id', (c) => {
    const keyId = c.req.param('id');
    if (!revokeApiKey(keyId)) return c.json({ error: 'Key not found' }, 404);

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('apikey_revoked', undefined, ip, `API key revoked: ${keyId}`);

    return c.json({ status: 'revoked' });
});

// =============================================================================
// Auth: Login, Logout, Me, Change Password
// =============================================================================

routes.post('/api/v1/auth/login', async (c) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

    const rateCheck = checkLoginRateLimit(ip);
    c.header('X-RateLimit-Limit', String(LOGIN_RATE_LIMIT));
    c.header('X-RateLimit-Remaining', String(rateCheck.remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(rateCheck.resetAt / 1000)));
    if (!rateCheck.allowed) {
        const retryAfter = Math.ceil((rateCheck.resetAt - Date.now()) / 1000);
        c.header('Retry-After', String(Math.max(1, retryAfter)));
        return c.json({ error: 'Too many login attempts. Try again later.' }, 429);
    }

    if (isIpBlocked(ip)) {
        recordAuditEvent('auth_blocked_ip', undefined, ip, 'Login attempt from blocked IP');
        return c.json({ error: 'Too many failed attempts. Try again later.' }, 429);
    }

    const body = await c.req.json<{ username: string; password: string }>();

    if (!body.username || !body.password) {
        return c.json({ error: 'username and password are required' }, 400);
    }

    const user = authenticateUser(body.username, body.password);
    if (!user) {
        const blocked = recordAuthFailure(ip);
        recordAuditEvent('auth_login_failed', body.username, ip, blocked ? 'IP now blocked for 15 minutes' : 'Invalid credentials');
        return c.json({ error: 'Invalid username or password' }, 401);
    }

    clearAuthFailures(ip);
    recordAuditEvent('auth_login', user.username, ip, `User ${user.username} logged in`);

    const session = createSession(user.id);

    const passwordChangeRequired = user.username === 'admin' && isInitialAdminPassword();

    return c.json({
        token: session.token,
        expires_at: session.expires_at,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
        },
        ...(passwordChangeRequired ? { password_change_required: true } : {}),
    });
});

routes.post('/api/v1/auth/change-password', async (c) => {
    const sessionUser = getSessionUser(c);
    if (!sessionUser) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const body = await c.req.json<{ current_password: string; new_password: string }>();

    if (!body.current_password || !body.new_password) {
        return c.json({ error: 'current_password and new_password are required' }, 400);
    }

    if (body.new_password.length < 8) {
        return c.json({ error: 'New password must be at least 8 characters' }, 400);
    }

    try {
        updateUserPassword(sessionUser.id, body.current_password, body.new_password);
        const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
        recordAuditEvent('auth_password_changed', sessionUser.username, ip, `User ${sessionUser.username} changed their password`);
        return c.json({ status: 'password_changed' });
    } catch (err: any) {
        return c.json({ error: err.message || 'Password change failed' }, 400);
    }
});

routes.post('/api/v1/auth/logout', (c) => {
    const auth = c.req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token) {
        return c.json({ error: 'No session token provided' }, 400);
    }

    const user = getSessionUser(c);
    const success = invalidateSession(token);
    if (!success) {
        return c.json({ error: 'Session not found or already expired' }, 404);
    }

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('auth_logout', user?.username, ip, `User ${user?.username || 'unknown'} logged out`);

    return c.json({ status: 'logged_out' });
});

routes.get('/api/v1/auth/me', (c) => {
    const user = getSessionUser(c);
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    return c.json({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
    });
});

// =============================================================================
// Audit Log
// =============================================================================

routes.get('/api/v1/audit', (c) => {
    const user = requireRole(c, 'admin');
    if (!user) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    const limit = parseInt(c.req.query('limit') || '100');
    const eventType = c.req.query('event_type') || undefined;
    return c.json({ audit_log: getAuditLog(limit, eventType) });
});

// =============================================================================
// Cluster Secret Management
// =============================================================================

routes.get('/api/v1/cluster/secret', (c) => {
    const user = requireRole(c, 'admin');
    if (!user) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    return c.json({
        agent_auth_enabled: agentAuthEnabled,
        secret_configured: !!CLUSTER_SECRET,
        secret_preview: CLUSTER_SECRET ? CLUSTER_SECRET.slice(0, 8) + '...' : null,
    });
});

routes.post('/api/v1/cluster/secret/rotate', async (c) => {
    const user = requireRole(c, 'admin');
    if (!user) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    if (process.env.TENTACLAW_CLUSTER_SECRET) {
        return c.json({ error: 'Cannot rotate cluster secret when set via TENTACLAW_CLUSTER_SECRET env var. Update the env var instead.' }, 400);
    }

    const newSecret = randomBytes(32).toString('hex');
    setClusterConfig('cluster_secret', newSecret);
    setClusterSecretValue(newSecret);

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    recordAuditEvent('cluster_secret_rotated', user.username, ip, 'Cluster secret rotated by admin');

    return c.json({
        status: 'rotated',
        secret: newSecret,
        message: 'New cluster secret generated. Distribute to all agents immediately. Old secret is now invalid.',
    });
});

// =============================================================================
// Users CRUD
// =============================================================================

routes.get('/api/v1/users', (c) => {
    const user = requireRole(c, 'admin');
    if (!user) {
        return c.json({ error: 'Admin access required' }, 403);
    }
    return c.json(getUsers());
});

routes.post('/api/v1/users', async (c) => {
    const admin = requireRole(c, 'admin');
    if (!admin) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    const body = await c.req.json<{
        username: string;
        password: string;
        role?: string;
        email?: string;
    }>();

    if (!body.username || !body.password) {
        return c.json({ error: 'username and password are required' }, 400);
    }

    const validRoles = ['admin', 'operator', 'viewer', 'user'];
    if (body.role && !validRoles.includes(body.role)) {
        return c.json({ error: `Invalid role. Valid: ${validRoles.join(', ')}` }, 400);
    }

    try {
        const newUser = createUser(body.username, body.password, body.role, body.email);
        return c.json(newUser, 201);
    } catch (err: any) {
        if (err.message?.includes('UNIQUE constraint')) {
            return c.json({ error: 'Username already exists' }, 409);
        }
        return c.json({ error: 'Failed to create user' }, 500);
    }
});

routes.delete('/api/v1/users/:id', (c) => {
    const admin = requireRole(c, 'admin');
    if (!admin) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    const targetId = c.req.param('id');
    if (targetId === admin.id) {
        return c.json({ error: 'Cannot delete your own account' }, 400);
    }

    if (!deleteUser(targetId)) {
        return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ status: 'deleted' });
});

routes.put('/api/v1/users/:id/role', async (c) => {
    const admin = requireRole(c, 'admin');
    if (!admin) {
        return c.json({ error: 'Admin access required' }, 403);
    }

    const body = await c.req.json<{ role: string }>();
    const validRoles = ['admin', 'operator', 'viewer', 'user'];

    if (!body.role || !validRoles.includes(body.role)) {
        return c.json({ error: `Invalid role. Valid: ${validRoles.join(', ')}` }, 400);
    }

    const targetId = c.req.param('id');
    if (!updateUserRole(targetId, body.role)) {
        return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ status: 'updated', id: targetId, role: body.role });
});

// =============================================================================
// Notification Channels
// =============================================================================

routes.get('/api/v1/notifications/channels', (c) => {
    return c.json(getAllNotificationChannels());
});

routes.post('/api/v1/notifications/channels', async (c) => {
    const body = await c.req.json<{ type: string; name: string; config: Record<string, unknown> }>();
    if (!body.type || !body.name || !body.config) {
        return c.json({ error: 'type, name, and config required' }, 400);
    }
    if (!['telegram', 'discord', 'webhook'].includes(body.type)) {
        return c.json({ error: 'type must be telegram, discord, or webhook' }, 400);
    }
    const channel = createNotificationChannel(body.type, body.name, body.config);
    return c.json(channel, 201);
});

routes.delete('/api/v1/notifications/channels/:id', (c) => {
    if (!deleteNotificationChannel(c.req.param('id'))) return c.json({ error: 'Channel not found' }, 404);
    return c.json({ status: 'deleted' });
});

routes.post('/api/v1/notifications/test', async (c) => {
    const body = await c.req.json<{ channel_id: string }>();
    const ok = await sendNotification(body.channel_id, '[TentaCLAW] Test notification — your alerts are working!');
    return c.json({ status: ok ? 'sent' : 'failed' });
});

// =============================================================================
// Cache
// =============================================================================

routes.get('/api/v1/cache/stats', (c) => {
    return c.json(getCacheStats());
});

routes.post('/api/v1/cache/purge', (c) => {
    const pruned = pruneCache();
    return c.json({ status: 'purged', expired_entries_removed: pruned });
});

// =============================================================================
// Profiler
// =============================================================================

routes.get('/api/v1/profiler/summary', (c) => {
    return c.json(getPerformanceSummary());
});

routes.get('/api/v1/profiler/endpoint/:path{.+}', (c) => {
    const endpointPath = '/' + c.req.param('path');
    return c.json(getEndpointPerformance(endpointPath));
});

routes.get('/api/v1/profiler/recent', (c) => {
    const limitParam = c.req.query('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    return c.json(getProfiles(limit));
});

routes.post('/api/v1/profiler/load-test', async (c) => {
    const body = await c.req.json<{ endpoint: string; concurrency?: number; duration_secs?: number; rps?: number }>();
    if (!body.endpoint) {
        return c.json({ error: 'endpoint is required' }, 400);
    }
    return c.json(generateLoadTestConfig(body.endpoint, {
        concurrency: body.concurrency,
        duration_secs: body.duration_secs,
        rps: body.rps,
    }));
});

routes.delete('/api/v1/profiler', (c) => {
    clearProfiles();
    return c.json({ cleared: true, message: 'All profiles cleared' });
});

// =============================================================================
// Gateway Uptime
// =============================================================================

routes.get('/api/v1/gateway/uptime', (c) => {
    const uptimeSecs = process.uptime();
    const days = Math.floor(uptimeSecs / 86400);
    const hours = Math.floor((uptimeSecs % 86400) / 3600);
    const mins = Math.floor((uptimeSecs % 3600) / 60);
    return c.json({
        uptime_seconds: Math.round(uptimeSecs),
        uptime_human: (days > 0 ? days + 'd ' : '') + hours + 'h ' + mins + 'm',
        started_at: new Date(Date.now() - uptimeSecs * 1000).toISOString(),
        memory_mb: Math.round(process.memoryUsage().rss / 1048576),
        node_version: process.version,
    });
});

// =============================================================================
// Cluster reboot (emergency)
// =============================================================================

routes.post('/api/v1/cluster/reboot', async (c) => {
    const { getAllNodes, queueCommand } = await import('../db');
    const body = await c.req.json<{ confirm: boolean }>();
    if (!body.confirm) return c.json({ error: 'Set confirm: true to reboot entire cluster' }, 400);

    const nodes = getAllNodes().filter(n => n.status === 'online');
    for (const node of nodes) {
        queueCommand(node.id, 'reboot');
    }
    broadcastSSE('cluster_reboot', { nodes: nodes.length });
    return c.json({ status: 'rebooting', nodes: nodes.length, warning: 'All nodes will reboot!' });
});

export default routes;
