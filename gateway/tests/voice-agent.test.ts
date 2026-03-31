/**
 * Voice Agent Framework Tests (Wave 145)
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
    createVoiceAgent, getVoiceAgent, listVoiceAgents, deleteVoiceAgent,
    startSession, recordTurn, endSession, getSession,
    estimatePipelineLatency, getVoiceAgentTemplates,
    _resetVoiceAgents,
} from '../src/voice-agent';

beforeEach(() => _resetVoiceAgents());

describe('Voice Agent CRUD', () => {
    it('creates a voice agent', () => {
        const agent = createVoiceAgent({
            name: 'Test Agent',
            stt: { backend: 'whisper-v3-turbo', streaming: true },
            llm: { model: 'phi-4-mini', system_prompt: 'You are helpful.', temperature: 0.7, max_tokens: 256 },
            tts: { backend: 'voxtral', streaming: true },
            pipeline: { target_latency_ms: 300, enable_interruption: true, enable_vad: true, conversation_memory_turns: 10, silence_timeout_ms: 3000 },
        });
        expect(agent.id).toMatch(/^va-/);
        expect(agent.name).toBe('Test Agent');
    });

    it('retrieves agent by ID', () => {
        const created = createVoiceAgent({
            name: 'Retrieve Test',
            stt: { backend: 'faster-whisper', streaming: true },
            llm: { model: 'llama-8b', system_prompt: 'Hi', temperature: 0.5, max_tokens: 100 },
            tts: { backend: 'kokoro', streaming: true },
            pipeline: { target_latency_ms: 250, enable_interruption: false, enable_vad: true, conversation_memory_turns: 5, silence_timeout_ms: 5000 },
        });
        const found = getVoiceAgent(created.id);
        expect(found?.name).toBe('Retrieve Test');
    });

    it('lists all agents with status', () => {
        createVoiceAgent({ name: 'A', stt: { backend: 'faster-whisper', streaming: true }, llm: { model: 'm', system_prompt: '', temperature: 0, max_tokens: 0 }, tts: { backend: 'kokoro', streaming: true }, pipeline: { target_latency_ms: 300, enable_interruption: true, enable_vad: true, conversation_memory_turns: 5, silence_timeout_ms: 3000 } });
        createVoiceAgent({ name: 'B', stt: { backend: 'faster-whisper', streaming: true }, llm: { model: 'm', system_prompt: '', temperature: 0, max_tokens: 0 }, tts: { backend: 'kokoro', streaming: true }, pipeline: { target_latency_ms: 300, enable_interruption: true, enable_vad: true, conversation_memory_turns: 5, silence_timeout_ms: 3000 } });
        expect(listVoiceAgents()).toHaveLength(2);
    });

    it('returns null for nonexistent agent', () => {
        expect(getVoiceAgent('nonexistent')).toBeNull();
    });
});

describe('Voice Sessions', () => {
    it('starts a session', () => {
        const agent = createVoiceAgent({ name: 'S', stt: { backend: 'faster-whisper', streaming: true }, llm: { model: 'm', system_prompt: '', temperature: 0, max_tokens: 0 }, tts: { backend: 'kokoro', streaming: true }, pipeline: { target_latency_ms: 300, enable_interruption: true, enable_vad: true, conversation_memory_turns: 5, silence_timeout_ms: 3000 } });
        const session = startSession(agent.id);
        expect(session).toBeTruthy();
        expect(session!.session_id).toMatch(/^vs-/);
        expect(session!.status).toBe('active');
    });

    it('records turns with latency', () => {
        const agent = createVoiceAgent({ name: 'T', stt: { backend: 'faster-whisper', streaming: true }, llm: { model: 'm', system_prompt: '', temperature: 0, max_tokens: 0 }, tts: { backend: 'kokoro', streaming: true }, pipeline: { target_latency_ms: 300, enable_interruption: true, enable_vad: true, conversation_memory_turns: 5, silence_timeout_ms: 3000 } });
        const session = startSession(agent.id)!;
        recordTurn(session.session_id, { role: 'user', text: 'Hello', audio_duration_ms: 500, latency_ms: 150, timestamp: new Date().toISOString() });
        recordTurn(session.session_id, { role: 'assistant', text: 'Hi there!', audio_duration_ms: 700, latency_ms: 280, timestamp: new Date().toISOString() });
        const s = getSession(session.session_id);
        expect(s!.turns).toHaveLength(2);
    });

    it('tracks avg latency in metrics', () => {
        const agent = createVoiceAgent({ name: 'M', stt: { backend: 'faster-whisper', streaming: true }, llm: { model: 'm', system_prompt: '', temperature: 0, max_tokens: 0 }, tts: { backend: 'kokoro', streaming: true }, pipeline: { target_latency_ms: 300, enable_interruption: true, enable_vad: true, conversation_memory_turns: 5, silence_timeout_ms: 3000 } });
        const session = startSession(agent.id)!;
        recordTurn(session.session_id, { role: 'user', text: 'Hi', audio_duration_ms: 300, latency_ms: 200, timestamp: new Date().toISOString() });
        recordTurn(session.session_id, { role: 'assistant', text: 'Hello', audio_duration_ms: 400, latency_ms: 300, timestamp: new Date().toISOString() });
        const agents = listVoiceAgents();
        expect(agents[0].avg_latency_ms).toBe(250); // (200+300)/2
    });

    it('ends a session', () => {
        const agent = createVoiceAgent({ name: 'E', stt: { backend: 'faster-whisper', streaming: true }, llm: { model: 'm', system_prompt: '', temperature: 0, max_tokens: 0 }, tts: { backend: 'kokoro', streaming: true }, pipeline: { target_latency_ms: 300, enable_interruption: true, enable_vad: true, conversation_memory_turns: 5, silence_timeout_ms: 3000 } });
        const session = startSession(agent.id)!;
        endSession(session.session_id);
        expect(getSession(session.session_id)!.status).toBe('ended');
    });
});

describe('Pipeline Latency Estimation', () => {
    it('estimates latency for fastest pipeline', () => {
        const config = getVoiceAgentTemplates()[1].config; // Cluster Monitor uses kokoro (50ms) + faster pipeline
        const est = estimatePipelineLatency({ ...config, id: 'test' });
        expect(est.estimated_total_ms).toBeLessThan(400);
        expect(est.stt_ms).toBeGreaterThan(0);
        expect(est.llm_ms).toBeGreaterThan(0);
        expect(est.tts_ms).toBeGreaterThan(0);
    });

    it('identifies bottleneck', () => {
        const config = getVoiceAgentTemplates()[0].config; // Support Agent
        const est = estimatePipelineLatency({ ...config, id: 'test' });
        expect(['stt', 'llm', 'tts']).toContain(est.bottleneck);
    });

    it('bark TTS is slow', () => {
        const config = { ...getVoiceAgentTemplates()[0].config, id: 'test', tts: { ...getVoiceAgentTemplates()[0].config.tts, backend: 'bark' as const } };
        const est = estimatePipelineLatency(config);
        expect(est.tts_ms).toBeGreaterThan(400);
        expect(est.bottleneck).toBe('tts');
    });
});

describe('Voice Agent Templates', () => {
    it('provides 3 templates', () => {
        expect(getVoiceAgentTemplates()).toHaveLength(3);
    });

    it('templates have complete configs', () => {
        for (const tmpl of getVoiceAgentTemplates()) {
            expect(tmpl.config.stt.backend).toBeTruthy();
            expect(tmpl.config.llm.model).toBeTruthy();
            expect(tmpl.config.tts.backend).toBeTruthy();
            expect(tmpl.config.pipeline.target_latency_ms).toBeGreaterThan(0);
        }
    });

    it('CLAWtopus Voice template exists', () => {
        const clawTemplate = getVoiceAgentTemplates().find(t => t.name === 'Cluster Monitor');
        expect(clawTemplate).toBeTruthy();
        expect(clawTemplate!.config.llm.system_prompt).toContain('CLAWtopus');
    });
});
