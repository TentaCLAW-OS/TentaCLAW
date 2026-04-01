/**
 * Alert routes — alerts and alert rules
 */
import { Hono } from 'hono';
import {
    getRecentAlerts,
    acknowledgeAlert,
    getAlertRules,
    createAlertRule,
    updateAlertRule,
    deleteAlertRule,
    toggleAlertRule,
} from '../db';

const routes = new Hono();

routes.get('/api/v1/alerts', (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const alerts = getRecentAlerts(limit);
    return c.json({ alerts });
});

routes.post('/api/v1/alerts/:id/acknowledge', (c) => {
    const id = c.req.param('id');
    const acked = acknowledgeAlert(id);
    if (!acked) {
        return c.json({ error: 'Alert not found' }, 404);
    }
    return c.json({ status: 'acknowledged', id });
});

routes.get('/api/v1/alert-rules', (c) => {
    const rules = getAlertRules();
    return c.json({ rules });
});

routes.post('/api/v1/alert-rules', async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.metric || !body.operator || body.threshold === undefined) {
        return c.json({ error: 'Missing required fields: name, metric, operator, threshold' }, 400);
    }
    const validMetrics = ['gpu_temp', 'gpu_util', 'vram_pct', 'cpu_usage', 'ram_pct', 'disk_pct', 'inference_latency'];
    if (!validMetrics.includes(body.metric)) {
        return c.json({ error: `Invalid metric. Must be one of: ${validMetrics.join(', ')}` }, 400);
    }
    const validOperators = ['gt', 'lt', 'gte', 'lte', 'eq'];
    if (!validOperators.includes(body.operator)) {
        return c.json({ error: `Invalid operator. Must be one of: ${validOperators.join(', ')}` }, 400);
    }
    const result = createAlertRule({
        name: body.name,
        metric: body.metric,
        operator: body.operator,
        threshold: body.threshold,
        severity: body.severity,
        cooldown_secs: body.cooldown_secs,
        node_filter: body.node_filter,
    });
    return c.json({ status: 'created', id: result.id }, 201);
});

routes.put('/api/v1/alert-rules/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    if (body.metric) {
        const validMetrics = ['gpu_temp', 'gpu_util', 'vram_pct', 'cpu_usage', 'ram_pct', 'disk_pct', 'inference_latency'];
        if (!validMetrics.includes(body.metric)) {
            return c.json({ error: `Invalid metric. Must be one of: ${validMetrics.join(', ')}` }, 400);
        }
    }
    if (body.operator) {
        const validOperators = ['gt', 'lt', 'gte', 'lte', 'eq'];
        if (!validOperators.includes(body.operator)) {
            return c.json({ error: `Invalid operator. Must be one of: ${validOperators.join(', ')}` }, 400);
        }
    }
    const updated = updateAlertRule(id, body);
    if (!updated) {
        return c.json({ error: 'Alert rule not found or no changes applied' }, 404);
    }
    return c.json({ status: 'updated', id });
});

routes.delete('/api/v1/alert-rules/:id', (c) => {
    const id = c.req.param('id');
    const deleted = deleteAlertRule(id);
    if (!deleted) {
        return c.json({ error: 'Alert rule not found' }, 404);
    }
    return c.json({ status: 'deleted', id });
});

routes.post('/api/v1/alert-rules/:id/toggle', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const enabled = body.enabled !== undefined ? !!body.enabled : true;
    const toggled = toggleAlertRule(id, enabled);
    if (!toggled) {
        return c.json({ error: 'Alert rule not found' }, 404);
    }
    return c.json({ status: enabled ? 'enabled' : 'disabled', id });
});

export default routes;
