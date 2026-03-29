/**
 * TentaCLAW Gateway — API Tests
 *
 * Tests the DB layer: registration, stats, commands, flight sheets.
 * Uses in-memory SQLite for test isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { StatsPayload } from '../../shared/types';

import {
    getDb,
    registerNode,
    getNode,
    getAllNodes,
    deleteNode,
    insertStats,
    getStatsHistory,
    getPendingCommands,
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
} from '../src/db';

// Use in-memory DB for tests
process.env.TENTACLAW_DB_PATH = ':memory:';

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
        db.prepare('DELETE FROM stats').run();
        db.prepare('DELETE FROM commands').run();
        db.prepare('DELETE FROM flight_sheets').run();
        db.prepare('DELETE FROM nodes').run();
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
        db.prepare('DELETE FROM stats').run();
        db.prepare('DELETE FROM commands').run();
        db.prepare('DELETE FROM flight_sheets').run();
        db.prepare('DELETE FROM nodes').run();
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
        db.prepare('DELETE FROM stats').run();
        db.prepare('DELETE FROM commands').run();
        db.prepare('DELETE FROM flight_sheets').run();
        db.prepare('DELETE FROM nodes').run();
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

    it('marks commands as sent after retrieval', () => {
        registerNode({ node_id: 'cn', farm_hash: 'F1', hostname: 'h1', gpu_count: 1 });
        queueCommand('cn', 'install_model', { model: 'test' });

        expect(getPendingCommands('cn').length).toBe(1);
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
        db.prepare('DELETE FROM stats').run();
        db.prepare('DELETE FROM commands').run();
        db.prepare('DELETE FROM flight_sheets').run();
        db.prepare('DELETE FROM nodes').run();
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
        db.prepare('DELETE FROM stats').run();
        db.prepare('DELETE FROM commands').run();
        db.prepare('DELETE FROM flight_sheets').run();
        db.prepare('DELETE FROM nodes').run();
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
        db.prepare('DELETE FROM stats').run();
        db.prepare('DELETE FROM commands').run();
        db.prepare('DELETE FROM flight_sheets').run();
        db.prepare('DELETE FROM nodes').run();
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
        db.prepare('DELETE FROM alerts').run();
        db.prepare('DELETE FROM stats').run();
        db.prepare('DELETE FROM commands').run();
        db.prepare('DELETE FROM flight_sheets').run();
        db.prepare('DELETE FROM nodes').run();
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
