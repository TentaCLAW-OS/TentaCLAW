/**
 * MCP Server Tests (Wave 93)
 */

import { describe, it, expect } from 'vitest';

process.env.TENTACLAW_DB_PATH = ':memory:';
process.env.TENTACLAW_CLUSTER_SECRET = 'test-secret';

import { getMcpTools, executeMcpTool } from '../src/mcp-server';
import { app } from '../src/index';

describe('MCP Tool Definitions', () => {
    it('exposes 12 tools', () => {
        const tools = getMcpTools();
        expect(tools.length).toBe(12);
    });

    it('all tools have name, description, and inputSchema', () => {
        for (const tool of getMcpTools()) {
            expect(tool.name).toBeTruthy();
            expect(tool.description).toBeTruthy();
            expect(tool.inputSchema.type).toBe('object');
        }
    });

    it('tool names are prefixed with tentaclaw_', () => {
        for (const tool of getMcpTools()) {
            expect(tool.name).toMatch(/^tentaclaw_/);
        }
    });

    it('deploy tool requires model parameter', () => {
        const deploy = getMcpTools().find(t => t.name === 'tentaclaw_deploy_model');
        expect(deploy?.inputSchema.required).toContain('model');
    });

    it('inference tool requires model and prompt', () => {
        const inference = getMcpTools().find(t => t.name === 'tentaclaw_run_inference');
        expect(inference?.inputSchema.required).toContain('model');
        expect(inference?.inputSchema.required).toContain('prompt');
    });
});

describe('MCP Tool Execution', () => {
    it('list_nodes returns array', async () => {
        const result = await executeMcpTool('tentaclaw_list_nodes', {});
        expect(result.isError).toBeFalsy();
        expect(result.content[0].type).toBe('text');
        const data = JSON.parse(result.content[0].text);
        expect(Array.isArray(data)).toBe(true);
    });

    it('list_models returns array', async () => {
        const result = await executeMcpTool('tentaclaw_list_models', {});
        expect(result.isError).toBeFalsy();
    });

    it('get_health returns health data', async () => {
        const result = await executeMcpTool('tentaclaw_get_health', {});
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('{');
    });

    it('get_metrics returns analytics', async () => {
        const result = await executeMcpTool('tentaclaw_get_metrics', { period_hours: '1' });
        expect(result.isError).toBeFalsy();
    });

    it('get_cost returns power data', async () => {
        const result = await executeMcpTool('tentaclaw_get_cost', {});
        expect(result.isError).toBeFalsy();
    });

    it('manage_keys list returns keys', async () => {
        const result = await executeMcpTool('tentaclaw_manage_keys', { action: 'list' });
        expect(result.isError).toBeFalsy();
    });

    it('manage_keys create returns new key', async () => {
        const result = await executeMcpTool('tentaclaw_manage_keys', { action: 'create', name: 'mcp-test' });
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('tc_');
    });

    it('compliance_report generates report', async () => {
        const result = await executeMcpTool('tentaclaw_compliance_report', { period_days: '7' });
        expect(result.isError).toBeFalsy();
        const report = JSON.parse(result.content[0].text);
        expect(report.framework).toBe('eu-ai-act');
    });

    it('chaos_test list-actions returns actions', async () => {
        const result = await executeMcpTool('tentaclaw_chaos_test', { action: 'list-actions' });
        expect(result.isError).toBeFalsy();
        const actions = JSON.parse(result.content[0].text);
        expect(actions.length).toBe(8);
    });

    it('deploy without model returns error', async () => {
        const result = await executeMcpTool('tentaclaw_deploy_model', {});
        expect(result.isError).toBe(true);
    });

    it('unknown tool returns error', async () => {
        const result = await executeMcpTool('nonexistent_tool', {});
        expect(result.isError).toBe(true);
    });
});

describe('MCP HTTP Endpoints', () => {
    it('GET /api/v1/mcp/tools returns tool list', async () => {
        const res = await app.request('/api/v1/mcp/tools');
        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(data.tools).toHaveLength(12);
    });

    it('GET /api/v1/mcp/info returns server info', async () => {
        const res = await app.request('/api/v1/mcp/info');
        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(data.name).toBe('tentaclaw-mcp');
        expect(data.tools_count).toBe(12);
    });

    it('POST /api/v1/mcp/tools/:name executes tool', async () => {
        const res = await app.request('/api/v1/mcp/tools/tentaclaw_get_health', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(200);
    });
});
