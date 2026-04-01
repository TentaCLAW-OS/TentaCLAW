/**
 * Namespace & multi-tenancy routes
 */
import { Hono } from 'hono';
import {
    createNamespace,
    getNamespace,
    listNamespaces,
    deleteNamespace,
    updateNamespace,
    setQuota,
    getQuotaUsage,
    checkQuota,
    getModelsInNamespace,
    getNodesInNamespace,
    assignNodeToNamespace,
    getNamespaceForApiKey,
    setApiKeyNamespace,
    recordUsage,
    getUsageReport,
    exportUsageCSV,
    getAllUsageReports,
} from '../namespaces';

const routes = new Hono();

routes.get('/api/v1/namespaces', (c) => {
    return c.json(listNamespaces());
});

routes.post('/api/v1/namespaces', async (c) => {
    const body = await c.req.json<{ name: string; display_name?: string; description?: string; labels?: Record<string, string>; quota?: any }>();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    try {
        const ns = createNamespace(body.name, {
            display_name: body.display_name,
            description: body.description,
            labels: body.labels,
            quota: body.quota,
        });
        return c.json(ns, 201);
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

routes.get('/api/v1/namespaces/:name', (c) => {
    const ns = getNamespace(c.req.param('name'));
    return ns ? c.json(ns) : c.json({ error: 'namespace not found' }, 404);
});

routes.put('/api/v1/namespaces/:name', async (c) => {
    const body = await c.req.json<{ display_name?: string; description?: string; labels?: Record<string, string>; quota?: any }>();
    try {
        const ns = updateNamespace(c.req.param('name'), body);
        return ns ? c.json(ns) : c.json({ error: 'namespace not found' }, 404);
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

routes.delete('/api/v1/namespaces/:name', (c) => {
    try {
        const deleted = deleteNamespace(c.req.param('name'));
        return deleted ? c.json({ deleted: true }) : c.json({ error: 'namespace not found' }, 404);
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

// Quota management
routes.get('/api/v1/namespaces/:name/quota', (c) => {
    const usage = getQuotaUsage(c.req.param('name'));
    return usage ? c.json(usage) : c.json({ error: 'namespace not found' }, 404);
});

routes.put('/api/v1/namespaces/:name/quota', async (c) => {
    const body = await c.req.json<{ maxGpus?: number; maxVramMb?: number; maxModels?: number; maxRequestsPerMin?: number; maxStorageMb?: number }>();
    const updated = setQuota(c.req.param('name'), {
        maxGpus: body.maxGpus ?? 0,
        maxVramMb: body.maxVramMb ?? 0,
        maxModels: body.maxModels ?? 0,
        maxRequestsPerMin: body.maxRequestsPerMin ?? 0,
        maxStorageMb: body.maxStorageMb ?? 0,
    });
    return updated ? c.json({ updated: true }) : c.json({ error: 'namespace not found' }, 404);
});

routes.post('/api/v1/namespaces/:name/quota/check', async (c) => {
    const body = await c.req.json<{ gpus?: number; vram_mb?: number; models?: number; storage_mb?: number }>();
    const result = checkQuota(c.req.param('name'), body);
    return c.json(result);
});

// Namespace isolation
routes.get('/api/v1/namespaces/:name/models', (c) => {
    return c.json(getModelsInNamespace(c.req.param('name')));
});

routes.get('/api/v1/namespaces/:name/nodes', (c) => {
    return c.json(getNodesInNamespace(c.req.param('name')));
});

routes.post('/api/v1/namespaces/:name/nodes', async (c) => {
    const body = await c.req.json<{ node_id: string }>();
    if (!body.node_id) return c.json({ error: 'node_id is required' }, 400);
    try {
        assignNodeToNamespace(body.node_id, c.req.param('name'));
        return c.json({ assigned: true, node_id: body.node_id, namespace: c.req.param('name') });
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

routes.get('/api/v1/api-keys/:keyId/namespace', (c) => {
    const ns = getNamespaceForApiKey(c.req.param('keyId'));
    return c.json({ key_id: c.req.param('keyId'), namespace: ns });
});

routes.put('/api/v1/api-keys/:keyId/namespace', async (c) => {
    const body = await c.req.json<{ namespace: string }>();
    if (!body.namespace) return c.json({ error: 'namespace is required' }, 400);
    try {
        setApiKeyNamespace(c.req.param('keyId'), body.namespace);
        return c.json({ updated: true, key_id: c.req.param('keyId'), namespace: body.namespace });
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

// Chargeback / usage
routes.post('/api/v1/namespaces/:name/usage', async (c) => {
    const body = await c.req.json<{ gpu_hours?: number; vram_hours_gb?: number; tokens_generated?: number; requests_served?: number; power_kwh?: number; estimated_cost_usd?: number }>();
    try {
        recordUsage(c.req.param('name'), body);
        return c.json({ recorded: true });
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

routes.get('/api/v1/namespaces/:name/usage', (c) => {
    const period = c.req.query('period');
    const report = getUsageReport(c.req.param('name'), period ?? undefined);
    return report ? c.json(report) : c.json({ error: 'namespace not found' }, 404);
});

routes.get('/api/v1/namespaces/:name/usage/csv', (c) => {
    const period = c.req.query('period');
    try {
        const csv = exportUsageCSV(c.req.param('name'), period ?? undefined);
        return new Response(csv, {
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="usage-${c.req.param('name')}-${period || 'all'}.csv"`,
            },
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

routes.get('/api/v1/usage/all', (c) => {
    const period = c.req.query('period');
    return c.json(getAllUsageReports(period ?? undefined));
});

export default routes;
