/**
 * TentaCLAW Gateway — API Tests
 *
 * Tests the DB layer: registration, stats, commands, flight sheets.
 * Uses in-memory SQLite for test isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { StatsPayload } from '../../shared/types';
import { app, initClusterSecret } from '../src/index';

import {
    getDb,
    registerNode,
    getNode,
    getAllNodes,
    deleteNode,
    insertStats,
    getStatsHistory,
    getPendingCommands,
    ackCommand,
    queueCommand,
    completeCommand,
    createFlightSheet,
    getAllFlightSheets,
    getFlightSheet,
    deleteFlightSheet,
    applyFlightSheet,
    getClusterSummary,
    markStaleNodes,
    checkAndAlert,
    getRecentAlerts,
    acknowledgeAlert,
    addSshKey,
    getNodeSshKeys,
    deleteSshKey,
    addNodeTag,
    removeNodeTag,
    getNodeTags,
    getNodesByTag,
    getAllTags,
    startModelPull,
    updateModelPull,
    getActiveModelPulls,
} from '../src/db';

// Use in-memory DB for tests
process.env.TENTACLAW_DB_PATH = ':memory:';
// Set a known cluster secret so agent-authenticated endpoints accept requests
process.env.TENTACLAW_CLUSTER_SECRET = 'test-secret';
initClusterSecret();

function makeStats(nodeId: string): StatsPayload {
    return {
        farm_hash: 'FARM0001',
        node_id: nodeId,
        hostname: 'test-rig',
        uptime_secs: 3600,
        gpu_count: 1,
        gpus: [{
            busId: '0000:01:00.0',
            name: 'RTX 3090',
            vramTotalMb: 24576,
            vramUsedMb: 8192,
            temperatureC: 65,
            utilizationPct: 80,
            powerDrawW: 300,
            fanSpeedPct: 60,
            clockSmMhz: 1800,
            clockMemMhz: 9500,
        }],
        cpu: { usage_pct: 45, temp_c: 55 },
        ram: { total_mb: 32768, used_mb: 16384 },
        disk: { total_gb: 500, used_gb: 250 },
        network: { bytes_in: 1000000, bytes_out: 500000 },
        inference: {
            loaded_models: ['llama3.1:8b'],
            in_flight_requests: 2,
            tokens_generated: 50000,
            avg_latency_ms: 45,
        },
        toks_per_sec: 120,
        requests_completed: 500,
    };
}

describe('Node Registration', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('registers a new node', () => {
        const node = registerNode({
            node_id: 'TENTACLAW-FARM7K3P-abc123',
            farm_hash: 'FARM7K3P',
            hostname: 'gpu-rig-01',
            ip_address: '192.168.1.100',
            mac_address: 'aa:bb:cc:dd:ee:ff',
            gpu_count: 2,
            os_version: '0.1.0',
        });

        expect(node.id).toBe('TENTACLAW-FARM7K3P-abc123');
        expect(node.farm_hash).toBe('FARM7K3P');
        expect(node.hostname).toBe('gpu-rig-01');
        expect(node.status).toBe('online');
        expect(node.gpu_count).toBe(2);
    });

    it('updates existing node on re-registration', () => {
        registerNode({
            node_id: 'TENTACLAW-FARM7K3P-abc123',
            farm_hash: 'FARM7K3P',
            hostname: 'gpu-rig-01',
            gpu_count: 2,
        });

        const updated = registerNode({
            node_id: 'TENTACLAW-FARM7K3P-abc123',
            farm_hash: 'FARM7K3P',
            hostname: 'gpu-rig-01-renamed',
            gpu_count: 4,
        });

        expect(updated.hostname).toBe('gpu-rig-01-renamed');
        expect(updated.gpu_count).toBe(4);
        expect(getAllNodes().length).toBe(1);
    });

    it('returns null for nonexistent node', () => {
        expect(getNode('nonexistent')).toBeNull();
    });

    it('deletes a node', () => {
        registerNode({ node_id: 'del-me', farm_hash: 'F', hostname: 'h', gpu_count: 0 });
        expect(deleteNode('del-me')).toBe(true);
        expect(deleteNode('del-me')).toBe(false);
        expect(getNode('del-me')).toBeNull();
    });
});

describe('Stats', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('inserts and retrieves stats', () => {
        registerNode({ node_id: 'sn', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        insertStats('sn', makeStats('sn'));

        const history = getStatsHistory('sn');
        expect(history.length).toBe(1);
        expect(history[0].toks_per_sec).toBe(120);
        expect(history[0].gpus[0].name).toBe('RTX 3090');
    });

    it('attaches latest stats to node', () => {
        registerNode({ node_id: 'sn', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        insertStats('sn', makeStats('sn'));

        const node = getNode('sn');
        expect(node!.latest_stats).not.toBeNull();
        expect(node!.latest_stats!.toks_per_sec).toBe(120);
    });

    it('sets node online on stats push', () => {
        registerNode({ node_id: 'sn', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        getDb().prepare("UPDATE nodes SET status = 'offline' WHERE id = ?").run('sn');
        insertStats('sn', makeStats('sn'));

        expect(getNode('sn')!.status).toBe('online');
    });
});

describe('Commands', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('queues and retrieves commands', () => {
        registerNode({ node_id: 'cn', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        queueCommand('cn', 'install_model', { model: 'llama3.1:8b' });
        queueCommand('cn', 'reload_model', { model: 'hermes3:8b' });

        const pending = getPendingCommands('cn');
        expect(pending.length).toBe(2);
        expect(pending[0].action).toBe('install_model');
        expect(pending[0].model).toBe('llama3.1:8b');
    });

    it('marks commands as sent after ACK', () => {
        registerNode({ node_id: 'cn', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        const cmd = queueCommand('cn', 'install_model', { model: 'test' });

        // Commands stay pending until explicitly ACKed
        expect(getPendingCommands('cn').length).toBe(1);
        expect(getPendingCommands('cn').length).toBe(1);

        // ACK the command — now it should no longer appear as pending
        ackCommand(cmd.id);
        expect(getPendingCommands('cn').length).toBe(0);
    });

    it('completes a command', () => {
        registerNode({ node_id: 'cn', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        const cmd = queueCommand('cn', 'install_model', { model: 'test' });
        completeCommand(cmd.id);

        expect(getPendingCommands('cn').length).toBe(0);
    });
});

describe('Flight Sheets', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('creates and retrieves flight sheets', () => {
        const sheet = createFlightSheet('Default LLM', 'Deploy Llama everywhere', [
            { node_id: '*', model: 'llama3.1:8b' },
        ]);

        expect(sheet.name).toBe('Default LLM');
        expect(sheet.targets.length).toBe(1);
        expect(getAllFlightSheets().length).toBe(1);
    });

    it('applies flight sheet to all nodes', () => {
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        registerNode({ node_id: 'n2', farm_hash: 'F1', hostname: 'r2', gpu_count: 2 });

        const sheet = createFlightSheet('All', 'Hermes on all', [
            { node_id: '*', model: 'hermes3:8b' },
        ]);

        const commands = applyFlightSheet(sheet.id);
        expect(commands.length).toBe(2);
        expect(commands[0].action).toBe('install_model');
    });

    it('applies flight sheet to specific node', () => {
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 1 });
        registerNode({ node_id: 'n2', farm_hash: 'F1', hostname: 'r2', gpu_count: 2 });

        const sheet = createFlightSheet('Specific', 'Only n1', [
            { node_id: 'n1', model: 'codellama:7b' },
        ]);

        expect(applyFlightSheet(sheet.id).length).toBe(1);
    });

    it('deletes a flight sheet', () => {
        const sheet = createFlightSheet('Temp', '', []);
        expect(deleteFlightSheet(sheet.id)).toBe(true);
        expect(getFlightSheet(sheet.id)).toBeNull();
    });
});

describe('Cluster Summary', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('returns correct summary', () => {
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'r1', gpu_count: 2 });
        registerNode({ node_id: 'n2', farm_hash: 'F2', hostname: 'r2', gpu_count: 1 });

        insertStats('n1', {
            ...makeStats('n1'),
            gpu_count: 2,
            gpus: [
                { busId: '0', name: 'RTX 3090', vramTotalMb: 24576, vramUsedMb: 8000, temperatureC: 60, utilizationPct: 70, powerDrawW: 300, fanSpeedPct: 50, clockSmMhz: 1800, clockMemMhz: 9500 },
                { busId: '1', name: 'RTX 3090', vramTotalMb: 24576, vramUsedMb: 12000, temperatureC: 65, utilizationPct: 90, powerDrawW: 320, fanSpeedPct: 60, clockSmMhz: 1800, clockMemMhz: 9500 },
            ],
            toks_per_sec: 100,
        });

        const summary = getClusterSummary();
        expect(summary.total_nodes).toBe(2);
        expect(summary.online_nodes).toBe(2);
        expect(summary.total_gpus).toBe(2);
        expect(summary.total_vram_mb).toBe(49152);
        expect(summary.farm_hashes.length).toBe(2);
    });
});

describe('Stale Node Detection', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('marks nodes offline when stale', () => {
        registerNode({ node_id: 'stale', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });

        const twoMinAgo = new Date(Date.now() - 120000).toISOString().replace('T', ' ').slice(0, 19);
        getDb().prepare('UPDATE nodes SET last_seen_at = ? WHERE id = ?').run(twoMinAgo, 'stale');

        const staleIds = markStaleNodes(60);
        expect(staleIds).toContain('stale');
        expect(getNode('stale')!.status).toBe('offline');
    });
});

describe('Alerts', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('triggers critical alert for GPU overheating', () => {
        registerNode({ node_id: 'hot-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });

        const hotStats = makeStats('hot-node');
        hotStats.gpus[0].temperatureC = 90;

        const alerts = checkAndAlert('hot-node', hotStats);
        expect(alerts.length).toBeGreaterThanOrEqual(1);

        const overheat = alerts.find(a => a.type === 'gpu_overheat');
        expect(overheat).toBeDefined();
        expect(overheat!.severity).toBe('critical');
        expect(overheat!.value).toBe(90);
        expect(overheat!.threshold).toBe(85);
        expect(overheat!.node_id).toBe('hot-node');

        // Should also be persisted
        const recent = getRecentAlerts(10);
        expect(recent.length).toBeGreaterThanOrEqual(1);
        expect(recent.find(a => a.type === 'gpu_overheat')).toBeDefined();
    });

    it('does not trigger alerts for normal stats', () => {
        registerNode({ node_id: 'cool-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });

        const normalStats = makeStats('cool-node');
        // Default makeStats has temp 65, cpu 45%, ram 50%, disk 50% — all safe

        const alerts = checkAndAlert('cool-node', normalStats);
        expect(alerts.length).toBe(0);

        const recent = getRecentAlerts(10);
        expect(recent.length).toBe(0);
    });

    it('acknowledges an alert', () => {
        registerNode({ node_id: 'ack-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });

        const hotStats = makeStats('ack-node');
        hotStats.gpus[0].temperatureC = 90;

        const alerts = checkAndAlert('ack-node', hotStats);
        expect(alerts.length).toBeGreaterThanOrEqual(1);

        const alertId = alerts[0].id;
        expect(alerts[0].acknowledged).toBe(0);

        const acked = acknowledgeAlert(alertId);
        expect(acked).toBe(true);

        const recent = getRecentAlerts(10);
        const found = recent.find(a => a.id === alertId);
        expect(found).toBeDefined();
        expect(found!.acknowledged).toBe(1);
    });
});

describe('SSH Keys', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('adds and retrieves SSH keys for a node', () => {
        registerNode({ node_id: 'ssh-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        const key = addSshKey('ssh-node', 'my-laptop', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtest user@host');

        expect(key.label).toBe('my-laptop');
        expect(key.public_key).toContain('ssh-ed25519');
        expect(key.fingerprint).toContain('SHA256:');
        expect(key.node_id).toBe('ssh-node');

        const keys = getNodeSshKeys('ssh-node');
        expect(keys.length).toBe(1);
        expect(keys[0].label).toBe('my-laptop');
    });

    it('deletes an SSH key', () => {
        registerNode({ node_id: 'ssh-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        const key = addSshKey('ssh-node', 'temp-key', 'ssh-rsa AAAABtest user@host');

        expect(deleteSshKey(key.id)).toBe(true);
        expect(getNodeSshKeys('ssh-node').length).toBe(0);
    });

    it('cascades on node delete', () => {
        registerNode({ node_id: 'ssh-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        addSshKey('ssh-node', 'key1', 'ssh-ed25519 AAAACtest user@host');
        addSshKey('ssh-node', 'key2', 'ssh-rsa AAAABtest user@host');

        deleteNode('ssh-node');
        expect(getNodeSshKeys('ssh-node').length).toBe(0);
    });
});

describe('Node Tags', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('adds and retrieves tags', () => {
        registerNode({ node_id: 'tag-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        addNodeTag('tag-node', 'production');
        addNodeTag('tag-node', 'inference');

        const tags = getNodeTags('tag-node');
        expect(tags).toContain('production');
        expect(tags).toContain('inference');
        expect(tags.length).toBe(2);
    });

    it('deduplicates tags', () => {
        registerNode({ node_id: 'tag-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        addNodeTag('tag-node', 'production');
        addNodeTag('tag-node', 'production');

        expect(getNodeTags('tag-node').length).toBe(1);
    });

    it('removes tags', () => {
        registerNode({ node_id: 'tag-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        addNodeTag('tag-node', 'temp');

        expect(removeNodeTag('tag-node', 'temp')).toBe(true);
        expect(removeNodeTag('tag-node', 'temp')).toBe(false);
        expect(getNodeTags('tag-node').length).toBe(0);
    });

    it('filters nodes by tag', () => {
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        registerNode({ node_id: 'n2', farm_hash: 'F1', hostname: 'h2', gpu_count: 1 });
        registerNode({ node_id: 'n3', farm_hash: 'F1', hostname: 'h3', gpu_count: 1 });

        addNodeTag('n1', 'production');
        addNodeTag('n2', 'production');
        addNodeTag('n3', 'staging');

        const prodNodes = getNodesByTag('production');
        expect(prodNodes.length).toBe(2);
        expect(prodNodes.map(n => n.id)).toContain('n1');
        expect(prodNodes.map(n => n.id)).toContain('n2');
    });

    it('lists all tags with counts', () => {
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        registerNode({ node_id: 'n2', farm_hash: 'F1', hostname: 'h2', gpu_count: 1 });

        addNodeTag('n1', 'production');
        addNodeTag('n2', 'production');
        addNodeTag('n1', 'inference');

        const tags = getAllTags();
        expect(tags.length).toBe(2);
        const prod = tags.find(t => t.tag === 'production');
        expect(prod!.count).toBe(2);
    });
});

describe('Model Pull Progress', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('tracks model pull progress', () => {
        registerNode({ node_id: 'pull-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        const pull = startModelPull('pull-node', 'llama3.1:8b');

        expect(pull.model).toBe('llama3.1:8b');
        expect(pull.status).toBe('downloading');
        expect(pull.progress_pct).toBe(0);

        updateModelPull('pull-node', 'llama3.1:8b', {
            progress_pct: 50,
            bytes_downloaded: 2048,
            bytes_total: 4096,
        });

        const active = getActiveModelPulls('pull-node');
        expect(active.length).toBe(1);
        expect(active[0].progress_pct).toBe(50);
    });

    it('completes a model pull', () => {
        registerNode({ node_id: 'pull-node', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        startModelPull('pull-node', 'llama3.1:8b');

        updateModelPull('pull-node', 'llama3.1:8b', {
            status: 'complete',
            progress_pct: 100,
        });

        // Completed pulls aren't "active"
        const active = getActiveModelPulls('pull-node');
        expect(active.length).toBe(0);
    });
});

// =============================================================================
// Registration Edge Cases (HTTP-level tests via app.request)
// =============================================================================

describe('Registration Edge Cases', () => {
    beforeEach(() => {
        const db = getDb();
        db.exec(`
            PRAGMA foreign_keys = OFF;
            DELETE FROM ssh_keys;
            DELETE FROM node_tags;
            DELETE FROM model_pulls;
            DELETE FROM stats;
            DELETE FROM commands;
            DELETE FROM flight_sheets;
            DELETE FROM alerts;
            DELETE FROM benchmarks;
            DELETE FROM node_events;
            DELETE FROM schedules;
            DELETE FROM nodes;
            DELETE FROM route_latency;
            DELETE FROM route_throughput;
            PRAGMA foreign_keys = ON;
        `);
    });

    it('rejects registration with missing node_id (empty body)', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({}),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('node_id');
    });

    it('rejects registration with empty string node_id', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: '',
                farm_hash: 'FARM0001',
                hostname: 'test-rig',
            }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('node_id');
    });

    it('rejects registration with missing farm_hash', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: 'TENTACLAW-TEST-001',
                hostname: 'test-rig',
            }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('farm_hash');
    });

    it('rejects registration with missing hostname', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: 'TENTACLAW-TEST-002',
                farm_hash: 'FARM0001',
            }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('hostname');
    });

    it('accepts registration with gpu_count = 0 (CPU-only node)', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: 'TENTACLAW-CPU-ONLY',
                farm_hash: 'FARM0001',
                hostname: 'cpu-node',
                gpu_count: 0,
            }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('registered');
        expect(json.node.gpu_count).toBe(0);
    });

    it('sanitizes negative gpu_count to 0', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: 'TENTACLAW-NEG-GPU',
                farm_hash: 'FARM0001',
                hostname: 'neg-gpu-node',
                gpu_count: -5,
            }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('registered');
        expect(json.node.gpu_count).toBe(0);
    });

    it('caps gpu_count at 128', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: 'TENTACLAW-MAX-GPU',
                farm_hash: 'FARM0001',
                hostname: 'mega-node',
                gpu_count: 500,
            }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('registered');
        // gpu_count > 128 should be sanitized to 0 (fails isFinite && >= 0 && <= 128 check)
        expect(json.node.gpu_count).toBe(0);
    });

    it('handles duplicate node_id registration (should update, not error)', async () => {
        // First registration
        const res1 = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: 'TENTACLAW-DUPE-001',
                farm_hash: 'FARM0001',
                hostname: 'original-host',
                gpu_count: 2,
            }),
        });

        expect(res1.status).toBe(200);
        const json1 = await res1.json();
        expect(json1.node.hostname).toBe('original-host');

        // Re-register same node_id with updated info
        const res2 = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: 'TENTACLAW-DUPE-001',
                farm_hash: 'FARM0001',
                hostname: 'updated-host',
                gpu_count: 4,
            }),
        });

        expect(res2.status).toBe(200);
        const json2 = await res2.json();
        expect(json2.node.hostname).toBe('updated-host');
        expect(json2.node.gpu_count).toBe(4);

        // Should still be only one node in the DB
        expect(getAllNodes().length).toBe(1);
    });

    it('sanitizes very long node_id (256+ chars) by truncating', async () => {
        const longId = 'TENTACLAW-' + 'A'.repeat(300);

        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: longId,
                farm_hash: 'FARM0001',
                hostname: 'long-id-node',
                gpu_count: 1,
            }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('registered');
        // node_id should be truncated to 256 chars
        expect(json.node.id.length).toBeLessThanOrEqual(256);
        expect(json.node.id.length).toBe(256);
    });

    it('handles special characters in hostname', async () => {
        const res = await app.request('/api/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': 'test-secret' },
            body: JSON.stringify({
                node_id: 'TENTACLAW-SPECIAL-HOST',
                farm_hash: 'FARM0001',
                hostname: 'gpu-rig_01.local (rack-3) <test> & "quoted"',
                gpu_count: 1,
            }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('registered');
        // Hostname should be stored as-is (after trim/slice), special chars preserved
        expect(json.node.hostname).toBe('gpu-rig_01.local (rack-3) <test> & "quoted"');
    });
});
