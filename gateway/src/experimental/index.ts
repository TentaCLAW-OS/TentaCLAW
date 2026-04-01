/**
 * TentaCLAW Gateway — Experimental Module Routes
 *
 * Hono sub-app that wires up MCP, A2A, and Webhook HTTP endpoints.
 * Tests (and the main gateway) import { app } from here.
 */

import { Hono } from 'hono';
import { getAgentCard, submitTask, getTask, listTasks } from './a2a';
import { getMcpTools, executeMcpTool } from './mcp-server';
import { registerWebhook, listWebhooks, deleteWebhook, ALL_WEBHOOK_EVENTS } from './webhooks';

export const app = new Hono();

// =============================================================================
// A2A — Agent-to-Agent Protocol
// =============================================================================

app.get('/.well-known/agent.json', (c) => {
    const baseUrl = new URL(c.req.url).origin;
    return c.json(getAgentCard(baseUrl));
});

app.post('/api/v1/a2a/tasks', async (c) => {
    const body = await c.req.json() as any;
    const task = await submitTask(body.capability, body.input || {});
    return c.json(task);
});

app.get('/api/v1/a2a/tasks/:id', (c) => {
    const task = getTask(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task);
});

app.get('/api/v1/a2a/tasks', (c) => {
    return c.json(listTasks());
});

// =============================================================================
// MCP — Model Context Protocol
// =============================================================================

app.get('/api/v1/mcp/tools', (c) => {
    return c.json({ tools: getMcpTools() });
});

app.get('/api/v1/mcp/info', (c) => {
    return c.json({
        name: 'tentaclaw-mcp',
        version: '1.0.0',
        tools_count: getMcpTools().length,
    });
});

app.post('/api/v1/mcp/tools/:name', async (c) => {
    const name = c.req.param('name');
    const args = await c.req.json().catch(() => ({})) as Record<string, string>;
    const result = await executeMcpTool(name, args);
    return c.json(result, result.isError ? 400 : 200);
});

// =============================================================================
// Webhooks
// =============================================================================

app.get('/api/v1/webhooks/events', (c) => {
    return c.json({ events: ALL_WEBHOOK_EVENTS });
});

app.get('/api/v1/webhooks', (c) => {
    return c.json(listWebhooks());
});

app.post('/api/v1/webhooks', async (c) => {
    const body = await c.req.json() as any;
    if (!body.url) return c.json({ error: 'url is required' }, 400);
    const wh = registerWebhook(body.url, body.events || [], body.description || '');
    return c.json(wh, 201);
});

app.delete('/api/v1/webhooks/:id', (c) => {
    const id = c.req.param('id');
    const ok = deleteWebhook(id);
    if (!ok) return c.json({ error: 'Webhook not found' }, 404);
    return c.json({ deleted: true });
});
