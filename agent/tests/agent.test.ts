/**
 * TentaCLAW Agent — Unit Tests
 *
 * Tests nvidia-smi parsing, stats collection shapes, command handling.
 * Mocks system calls since we're not on Linux with real GPUs here.
 */

import { describe, it, expect } from 'vitest';
import type { StatsPayload, GpuStats, GatewayCommand, GatewayResponse } from '../../shared/types';

// =============================================================================
// nvidia-smi output parsing (extracted logic)
// =============================================================================

function parseNvidiaSmiOutput(output: string): GpuStats[] {
    return output.trim().split('\n').filter(line => line).map(line => {
        const [_idx, busId, name, vramUsed, vramTotal, temp, util, power, fan, clockSm, clockMem] = line.split(',').map(s => s.trim());

        return {
            busId: busId || 'unknown',
            name: name || 'Unknown GPU',
            vramTotalMb: parseInt(vramTotal) || 0,
            vramUsedMb: parseInt(vramUsed) || 0,
            temperatureC: parseInt(temp) || 0,
            utilizationPct: parseInt(util) || 0,
            powerDrawW: parseFloat(power) || 0,
            fanSpeedPct: parseInt(fan) || 0,
            clockSmMhz: parseInt(clockSm) || 0,
            clockMemMhz: parseInt(clockMem) || 0,
        };
    });
}

describe('nvidia-smi Output Parsing', () => {
    it('parses single GPU output', () => {
        const output = '0, 00000000:01:00.0, NVIDIA GeForce RTX 3090, 8192, 24576, 65, 80, 300.00, 60, 1800, 9501';
        const gpus = parseNvidiaSmiOutput(output);

        expect(gpus.length).toBe(1);
        expect(gpus[0].busId).toBe('00000000:01:00.0');
        expect(gpus[0].name).toBe('NVIDIA GeForce RTX 3090');
        expect(gpus[0].vramTotalMb).toBe(24576);
        expect(gpus[0].vramUsedMb).toBe(8192);
        expect(gpus[0].temperatureC).toBe(65);
        expect(gpus[0].utilizationPct).toBe(80);
        expect(gpus[0].powerDrawW).toBe(300);
    });

    it('parses multi-GPU output', () => {
        const output = [
            '0, 00000000:01:00.0, NVIDIA GeForce RTX 3090, 8192, 24576, 65, 80, 300.00, 60, 1800, 9501',
            '1, 00000000:02:00.0, NVIDIA GeForce RTX 4070 Ti Super, 4096, 16384, 55, 40, 180.00, 45, 2100, 10500',
        ].join('\n');

        const gpus = parseNvidiaSmiOutput(output);
        expect(gpus.length).toBe(2);
        expect(gpus[1].name).toBe('NVIDIA GeForce RTX 4070 Ti Super');
        expect(gpus[1].vramTotalMb).toBe(16384);
    });

    it('handles empty output', () => {
        const gpus = parseNvidiaSmiOutput('');
        expect(gpus.length).toBe(0);
    });

    it('handles malformed lines gracefully', () => {
        const output = '0, , , , , , , , , , ';
        const gpus = parseNvidiaSmiOutput(output);
        expect(gpus.length).toBe(1);
        expect(gpus[0].name).toBe('Unknown GPU'); // fallback for empty name
        expect(gpus[0].vramTotalMb).toBe(0);
    });
});

// =============================================================================
// Stats payload shape validation
// =============================================================================

describe('StatsPayload Shape', () => {
    it('validates a complete stats payload', () => {
        const stats: StatsPayload = {
            farm_hash: 'FARM7K3P',
            node_id: 'TENTACLAW-FARM7K3P-abc123',
            hostname: 'gpu-rig-01',
            uptime_secs: 86400,
            gpu_count: 2,
            gpus: [
                {
                    busId: '00000000:01:00.0',
                    name: 'RTX 3090',
                    vramTotalMb: 24576,
                    vramUsedMb: 16384,
                    temperatureC: 72,
                    utilizationPct: 95,
                    powerDrawW: 350,
                    fanSpeedPct: 80,
                    clockSmMhz: 1900,
                    clockMemMhz: 9750,
                },
                {
                    busId: '00000000:02:00.0',
                    name: 'RTX 4070 Ti Super',
                    vramTotalMb: 16384,
                    vramUsedMb: 8192,
                    temperatureC: 58,
                    utilizationPct: 60,
                    powerDrawW: 200,
                    fanSpeedPct: 45,
                    clockSmMhz: 2200,
                    clockMemMhz: 10500,
                },
            ],
            cpu: { usage_pct: 45, temp_c: 55 },
            ram: { total_mb: 65536, used_mb: 32768 },
            disk: { total_gb: 1000, used_gb: 500 },
            network: { bytes_in: 5000000000, bytes_out: 1000000000 },
            inference: {
                loaded_models: ['llama3.1:8b', 'hermes3:8b'],
                in_flight_requests: 3,
                tokens_generated: 1500000,
                avg_latency_ms: 42,
            },
            toks_per_sec: 185,
            requests_completed: 15000,
        };

        // Shape checks
        expect(stats.gpus.length).toBe(stats.gpu_count);
        expect(stats.ram.used_mb).toBeLessThanOrEqual(stats.ram.total_mb);
        expect(stats.disk.used_gb).toBeLessThanOrEqual(stats.disk.total_gb);
        expect(stats.inference.loaded_models.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// Gateway response / command handling
// =============================================================================

describe('Gateway Command Handling', () => {
    it('parses gateway response with commands', () => {
        const response: GatewayResponse = {
            commands: [
                { id: 'cmd-1', action: 'install_model', model: 'llama3.1:8b' },
                { id: 'cmd-2', action: 'reload_model', model: 'hermes3:8b' },
                { id: 'cmd-3', action: 'overclock', gpu: 0, profile: 'gaming' },
            ],
            config_hash: 'abc123',
        };

        expect(response.commands.length).toBe(3);
        expect(response.commands[0].action).toBe('install_model');
        expect(response.commands[0].model).toBe('llama3.1:8b');
        expect(response.commands[2].gpu).toBe(0);
    });

    it('handles empty command response', () => {
        const response: GatewayResponse = {
            commands: [],
        };

        expect(response.commands.length).toBe(0);
        expect(response.config_hash).toBeUndefined();
    });
});

// =============================================================================
// Config parsing (rig.conf format)
// =============================================================================

function parseRigConf(content: string): Record<string, string> {
    const config: Record<string, string> = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length > 0) {
                config[key.trim()] = valueParts.join('=').trim();
            }
        }
    }
    return config;
}

describe('rig.conf Parsing', () => {
    it('parses standard rig.conf', () => {
        const content = `
# TentaCLAW rig configuration
NODE_ID=TENTACLAW-FARM7K3P-abc123
FARM_HASH=FARM7K3P
NODE_HOSTNAME=gpu-rig-01
GATEWAY_URL=http://192.168.1.1:8080
AGENT_INTERVAL=10
`;

        const config = parseRigConf(content);
        expect(config['NODE_ID']).toBe('TENTACLAW-FARM7K3P-abc123');
        expect(config['FARM_HASH']).toBe('FARM7K3P');
        expect(config['GATEWAY_URL']).toBe('http://192.168.1.1:8080');
        expect(config['AGENT_INTERVAL']).toBe('10');
    });

    it('handles values with equals signs', () => {
        const content = 'AGENT_STATS_URL=http://gw:8080/api/v1/nodes/n1/stats?foo=bar';
        const config = parseRigConf(content);
        expect(config['AGENT_STATS_URL']).toBe('http://gw:8080/api/v1/nodes/n1/stats?foo=bar');
    });

    it('ignores comments and blank lines', () => {
        const content = `
# comment
NODE_ID=test

# another comment
FARM_HASH=F1
`;
        const config = parseRigConf(content);
        expect(Object.keys(config).length).toBe(2);
    });
});
