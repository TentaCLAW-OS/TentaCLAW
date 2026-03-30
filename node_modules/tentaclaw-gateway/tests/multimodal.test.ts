/**
 * TentaCLAW Gateway — Multi-Modal Inference Tests
 *
 * Tests for image generation, audio transcription/TTS/translation,
 * vision content blocks, and multi-modal discovery endpoints.
 * Uses in-memory SQLite for test isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getDb,
    registerNode,
    insertStats,
    getClusterModels,
} from '../src/db';
import { app } from '../src/index';
import type { StatsPayload } from '../../shared/types';

process.env.TENTACLAW_DB_PATH = ':memory:';

function clearDb() {
    const db = getDb();
    db.pragma('foreign_keys = OFF');
    for (const table of [
        'ssh_keys', 'node_tags', 'model_pulls', 'nodes', 'stats',
        'commands', 'flight_sheets', 'alerts', 'benchmarks',
        'node_events', 'schedules', 'prompt_cache', 'model_aliases',
        'api_keys', 'inference_log', 'watchdog_events',
        'notification_channels', 'uptime_events', 'overclock_profiles',
        'route_latency', 'route_throughput',
    ]) {
        db.prepare('DELETE FROM ' + table).run();
    }
    db.pragma('foreign_keys = ON');
}

function mockStats(nodeId: string, overrides?: Partial<StatsPayload>): StatsPayload {
    return {
        farm_hash: 'FARM7K3P',
        node_id: nodeId,
        hostname: 'test-rig',
        uptime_secs: 7200,
        gpu_count: 1,
        gpus: [{
            busId: '0:1',
            name: 'RTX 4070 Ti Super',
            vramTotalMb: 16384,
            vramUsedMb: 8000,
            temperatureC: 62,
            utilizationPct: 30,
            powerDrawW: 220,
            fanSpeedPct: 50,
            clockSmMhz: 2300,
            clockMemMhz: 10500,
        }],
        cpu: { usage_pct: 55, temp_c: 48 },
        ram: { total_mb: 65536, used_mb: 40960 },
        disk: { total_gb: 1000, used_gb: 450 },
        network: { bytes_in: 8000000000, bytes_out: 2000000000 },
        inference: {
            loaded_models: ['llama3.1:8b'],
            in_flight_requests: 0,
            tokens_generated: 500000,
            avg_latency_ms: 35,
        },
        toks_per_sec: 210,
        requests_completed: 8000,
        ...overrides,
    };
}

// =============================================================================
// Image Generation
// =============================================================================

describe('Image Generation', () => {
    beforeEach(clearDb);

    it('POST /v1/images/generations returns 400 without prompt', async () => {
        const res = await app.request('/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'stable-diffusion' }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.message).toContain('prompt is required');
        expect(body.error.type).toBe('invalid_request_error');
    });

    it('POST /v1/images/generations returns 503 when no image model available', async () => {
        // Register a node with only a text model
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'rig-1', ip_address: '10.0.0.1', gpu_count: 1 });
        insertStats('n1', mockStats('n1', {
            inference: { loaded_models: ['llama3.1:8b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));

        const res = await app.request('/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'A beautiful sunset over mountains' }),
        });

        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error.message).toContain('image generation model');
        expect(body.error.type).toBe('model_not_found');
    });

    it('POST /v1/images/generations response has correct OpenAI format on 503', async () => {
        const res = await app.request('/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'A cat in space' }),
        });

        expect(res.status).toBe(503);
        const body = await res.json();
        // Error response should have OpenAI-style error object
        expect(body.error).toBeDefined();
        expect(body.error.message).toBeDefined();
        expect(body.error.type).toBeDefined();
        expect(body.error.available_models).toBeDefined();
        expect(Array.isArray(body.error.available_models)).toBe(true);
    });
});

// =============================================================================
// Audio Transcription
// =============================================================================

describe('Audio Transcription', () => {
    beforeEach(clearDb);

    it('POST /v1/audio/transcriptions returns 503 when no Whisper model', async () => {
        // Register a node with only a text model (no whisper)
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'rig-1', ip_address: '10.0.0.1', gpu_count: 1 });
        insertStats('n1', mockStats('n1', {
            inference: { loaded_models: ['llama3.1:8b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));

        const res = await app.request('/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data' },
            body: new ArrayBuffer(100),
        });

        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error.message).toContain('Whisper');
        expect(body.error.type).toBe('model_not_found');
    });

    it('POST /v1/audio/speech returns 503 when no TTS model', async () => {
        // Register a node with only a text model (no TTS)
        registerNode({ node_id: 'n1', farm_hash: 'F1', hostname: 'rig-1', ip_address: '10.0.0.1', gpu_count: 1 });
        insertStats('n1', mockStats('n1', {
            inference: { loaded_models: ['llama3.1:8b'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));

        const res = await app.request('/v1/audio/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'tts-1', input: 'Hello world', voice: 'alloy' }),
        });

        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error.message).toContain('TTS');
        expect(body.error.type).toBe('model_not_found');
    });
});

// =============================================================================
// Vision
// =============================================================================

describe('Vision', () => {
    beforeEach(clearDb);

    it('POST /v1/chat/completions accepts image content blocks', async () => {
        // With no matching model node, we should get 503 — but NOT a 400
        // This validates the endpoint accepts multimodal message format
        const res = await app.request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llava:7b',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: 'What is in this image?' },
                        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
                    ],
                }],
            }),
        });

        // Should be 503 (no node has the model), NOT 400 (bad request)
        // This confirms multimodal content blocks are accepted
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error.type).toBe('model_not_found');
    });

    it('POST /v1/messages accepts Anthropic image content blocks', async () => {
        // With no matching model node, we should get 404 — but NOT a 400
        // This validates the endpoint accepts Anthropic multimodal message format
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Describe this image.' },
                        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
                    ],
                }],
            }),
        });

        // Should be 404 (no model found in cluster), NOT 400 (bad format)
        // This confirms Anthropic multimodal content blocks are accepted
        expect([404, 503]).toContain(res.status);
        const body = await res.json();
        expect(body.error).toBeDefined();
        expect(body.error.type).toMatch(/not_found|model_not_found/);
    });
});

// =============================================================================
// Multi-Modal Discovery
// =============================================================================

describe('Multi-Modal Discovery', () => {
    beforeEach(clearDb);

    it('GET /v1/models includes audio and image models', async () => {
        // Register nodes with various model types
        registerNode({ node_id: 'n-audio', farm_hash: 'F1', hostname: 'audio-rig', ip_address: '10.0.0.2', gpu_count: 1 });
        insertStats('n-audio', mockStats('n-audio', {
            inference: { loaded_models: ['whisper:large', 'bark'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));

        registerNode({ node_id: 'n-image', farm_hash: 'F1', hostname: 'image-rig', ip_address: '10.0.0.3', gpu_count: 1 });
        insertStats('n-image', mockStats('n-image', {
            inference: { loaded_models: ['stable-diffusion'], in_flight_requests: 0, tokens_generated: 0, avg_latency_ms: 0 },
        }));

        const res = await app.request('/v1/models', { method: 'GET' });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.object).toBe('list');
        expect(Array.isArray(body.data)).toBe(true);

        const modelIds = body.data.map((m: { id: string }) => m.id);
        expect(modelIds).toContain('whisper:large');
        expect(modelIds).toContain('bark');
        expect(modelIds).toContain('stable-diffusion');

        // Verify type classification in _tentaclaw metadata
        const whisperModel = body.data.find((m: { id: string }) => m.id === 'whisper:large');
        expect(whisperModel._tentaclaw.type).toBe('audio-transcription');

        const barkModel = body.data.find((m: { id: string }) => m.id === 'bark');
        expect(barkModel._tentaclaw.type).toBe('audio-tts');

        const sdModel = body.data.find((m: { id: string }) => m.id === 'stable-diffusion');
        expect(sdModel._tentaclaw.type).toBe('image-generation');
    });

    it('GET /api/v1/capabilities lists multi-modal support', async () => {
        const res = await app.request('/api/v1/capabilities', { method: 'GET' });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.features).toBeDefined();

        // Check multi-modal features
        expect(body.features.multi_modal).toBe(true);
        expect(body.features.audio_transcription).toBe(true);
        expect(body.features.audio_tts).toBe(true);
        expect(body.features.image_generation).toBe(true);
        expect(body.features.vision).toBe(true);

        // Check API compatibility includes multi-modal endpoints
        expect(body.api_compatibility.openai).toContain('/v1/audio/transcriptions');
        expect(body.api_compatibility.openai).toContain('/v1/audio/speech');
        expect(body.api_compatibility.openai).toContain('/v1/images/generations');
    });

    it('GET /api/v1/version includes multi-modal in features', async () => {
        const res = await app.request('/api/v1/version', { method: 'GET' });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.features).toBeDefined();
        expect(Array.isArray(body.features)).toBe(true);

        // Check multi-modal features are listed
        expect(body.features).toContain('multi-modal');
        expect(body.features).toContain('audio-transcription');
        expect(body.features).toContain('audio-tts');
        expect(body.features).toContain('image-generation');
        expect(body.features).toContain('vision');

        // Check OpenAI-compatible endpoints include multi-modal
        expect(body.openai_compatible).toContain('/v1/audio/transcriptions');
        expect(body.openai_compatible).toContain('/v1/audio/speech');
        expect(body.openai_compatible).toContain('/v1/images/generations');
    });
});
