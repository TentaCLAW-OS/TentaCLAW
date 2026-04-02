/**
 * TentaCLAW Gateway — Voice Agent Framework (Wave 145)
 *
 * Voice agent pipeline: STT -> LLM -> TTS with sub-300ms target:
 *   - Configurable STT backend (Whisper V3 Turbo, faster-whisper)
 *   - Configurable LLM (any deployed model)
 *   - Configurable TTS backend (Voxtral, XTTS-v2, Kokoro)
 *   - Interruption handling
 *   - Conversation memory
 *   - Voice activity detection
 *
 * TentaCLAW says: "I speak with all eight arms. Sub-300ms. Per arm."
 */

// =============================================================================
// Types
// =============================================================================

export interface VoiceAgentConfig {
    /** Unique agent ID */
    id: string;
    /** Display name */
    name: string;
    /** STT configuration */
    stt: {
        backend: 'whisper-v3-turbo' | 'faster-whisper' | 'deepgram' | 'assemblyai';
        model?: string;
        language?: string;
        streaming: boolean;
    };
    /** LLM configuration */
    llm: {
        model: string;
        system_prompt: string;
        temperature: number;
        max_tokens: number;
    };
    /** TTS configuration */
    tts: {
        backend: 'voxtral' | 'xtts-v2' | 'kokoro' | 'orpheus' | 'bark';
        voice_id?: string;
        language?: string;
        emotion?: 'neutral' | 'happy' | 'sad' | 'angry' | 'excited';
        streaming: boolean;
    };
    /** Pipeline settings */
    pipeline: {
        target_latency_ms: number; // default: 300
        enable_interruption: boolean;
        enable_vad: boolean; // voice activity detection
        conversation_memory_turns: number; // default: 10
        silence_timeout_ms: number; // auto-end turn after silence
    };
}

export interface VoiceAgentState {
    id: string;
    status: 'idle' | 'listening' | 'processing' | 'speaking';
    active_sessions: number;
    total_conversations: number;
    avg_latency_ms: number;
    config: VoiceAgentConfig;
}

export interface VoiceTurn {
    role: 'user' | 'assistant';
    text: string;
    audio_duration_ms: number;
    latency_ms: number;
    timestamp: string;
}

export interface VoiceSession {
    session_id: string;
    agent_id: string;
    turns: VoiceTurn[];
    started_at: string;
    status: 'active' | 'ended';
}

// =============================================================================
// Agent Registry
// =============================================================================

const agents = new Map<string, VoiceAgentConfig>();
const sessions = new Map<string, VoiceSession>();
const agentMetrics = new Map<string, { totalConversations: number; totalLatencyMs: number; turns: number }>();
let agentCounter = 0;

/** Create a voice agent */
export function createVoiceAgent(config: Omit<VoiceAgentConfig, 'id'>): VoiceAgentConfig {
    const id = `va-${++agentCounter}-${Date.now().toString(36)}`;
    const agent: VoiceAgentConfig = { ...config, id };
    agents.set(id, agent);
    agentMetrics.set(id, { totalConversations: 0, totalLatencyMs: 0, turns: 0 });
    return agent;
}

/** Get a voice agent */
export function getVoiceAgent(id: string): VoiceAgentConfig | null {
    return agents.get(id) || null;
}

/** List all voice agents */
export function listVoiceAgents(): VoiceAgentState[] {
    return Array.from(agents.values()).map(a => {
        const metrics = agentMetrics.get(a.id)!;
        const activeSessions = Array.from(sessions.values()).filter(s => s.agent_id === a.id && s.status === 'active').length;
        return {
            id: a.id,
            status: activeSessions > 0 ? 'listening' : 'idle' as const,
            active_sessions: activeSessions,
            total_conversations: metrics.totalConversations,
            avg_latency_ms: metrics.turns > 0 ? Math.round(metrics.totalLatencyMs / metrics.turns) : 0,
            config: a,
        };
    });
}

/** Delete a voice agent */
export function deleteVoiceAgent(id: string): boolean {
    agents.delete(id);
    agentMetrics.delete(id);
    return true;
}

// =============================================================================
// Session Management
// =============================================================================

/** Start a voice conversation session */
export function startSession(agentId: string): VoiceSession | null {
    const agent = agents.get(agentId);
    if (!agent) return null;

    const session: VoiceSession = {
        session_id: `vs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        agent_id: agentId,
        turns: [],
        started_at: new Date().toISOString(),
        status: 'active',
    };
    sessions.set(session.session_id, session);

    const metrics = agentMetrics.get(agentId)!;
    metrics.totalConversations++;

    return session;
}

/** Record a voice turn */
export function recordTurn(sessionId: string, turn: VoiceTurn): void {
    const session = sessions.get(sessionId);
    if (!session) return;

    session.turns.push(turn);

    // Update metrics
    const metrics = agentMetrics.get(session.agent_id);
    if (metrics) {
        metrics.totalLatencyMs += turn.latency_ms;
        metrics.turns++;
    }
}

/** End a session */
export function endSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session) session.status = 'ended';
}

/** Get session */
export function getSession(sessionId: string): VoiceSession | null {
    return sessions.get(sessionId) || null;
}

// =============================================================================
// Pipeline Estimation
// =============================================================================

/** Estimate end-to-end latency for a voice agent config */
export function estimatePipelineLatency(config: VoiceAgentConfig): {
    estimated_total_ms: number;
    stt_ms: number;
    llm_ms: number;
    tts_ms: number;
    meets_target: boolean;
    bottleneck: string;
} {
    // Latency estimates per backend
    const sttLatency: Record<string, number> = {
        'whisper-v3-turbo': 150, 'faster-whisper': 100, 'deepgram': 80, 'assemblyai': 120,
    };
    const ttsLatency: Record<string, number> = {
        'voxtral': 70, 'kokoro': 50, 'xtts-v2': 150, 'orpheus': 100, 'bark': 500,
    };

    const sttMs = sttLatency[config.stt.backend] || 150;
    const llmMs = 80; // Estimated LLM TTFT + first chunk
    const ttsMs = ttsLatency[config.tts.backend] || 100;
    const total = sttMs + llmMs + ttsMs;

    let bottleneck = 'stt';
    if (llmMs > sttMs && llmMs > ttsMs) bottleneck = 'llm';
    if (ttsMs > sttMs && ttsMs > llmMs) bottleneck = 'tts';

    return {
        estimated_total_ms: total,
        stt_ms: sttMs,
        llm_ms: llmMs,
        tts_ms: ttsMs,
        meets_target: total <= config.pipeline.target_latency_ms,
        bottleneck,
    };
}

// =============================================================================
// Templates
// =============================================================================

/** Pre-built voice agent templates */
export function getVoiceAgentTemplates(): Array<{ name: string; description: string; config: Omit<VoiceAgentConfig, 'id'> }> {
    return [
        {
            name: 'Customer Support',
            description: 'Friendly support agent with FAQ knowledge',
            config: {
                name: 'Support Agent',
                stt: { backend: 'faster-whisper', streaming: true },
                llm: { model: 'llama-3.1-8b', system_prompt: 'You are a helpful customer support agent. Be concise and friendly.', temperature: 0.7, max_tokens: 256 },
                tts: { backend: 'voxtral', emotion: 'happy', streaming: true },
                pipeline: { target_latency_ms: 300, enable_interruption: true, enable_vad: true, conversation_memory_turns: 10, silence_timeout_ms: 3000 },
            },
        },
        {
            name: 'Cluster Monitor',
            description: 'Voice interface for cluster health queries',
            config: {
                name: 'TentaCLAW Voice',
                stt: { backend: 'whisper-v3-turbo', streaming: true },
                llm: { model: 'phi-4-mini', system_prompt: 'You are TentaCLAW, the TentaCLAW cluster assistant. Report GPU health, model status, and cluster metrics conversationally.', temperature: 0.5, max_tokens: 200 },
                tts: { backend: 'kokoro', emotion: 'neutral', streaming: true },
                pipeline: { target_latency_ms: 250, enable_interruption: true, enable_vad: true, conversation_memory_turns: 5, silence_timeout_ms: 5000 },
            },
        },
        {
            name: 'Appointment Scheduler',
            description: 'Schedule appointments via phone',
            config: {
                name: 'Scheduler',
                stt: { backend: 'deepgram', streaming: true },
                llm: { model: 'llama-3.1-8b', system_prompt: 'You are an appointment scheduling assistant. Collect: name, preferred date/time, service type. Confirm details before booking.', temperature: 0.3, max_tokens: 150 },
                tts: { backend: 'voxtral', emotion: 'neutral', streaming: true },
                pipeline: { target_latency_ms: 300, enable_interruption: true, enable_vad: true, conversation_memory_turns: 20, silence_timeout_ms: 4000 },
            },
        },
    ];
}

/** Reset (for testing) */
export function _resetVoiceAgents(): void {
    agents.clear();
    sessions.clear();
    agentMetrics.clear();
    agentCounter = 0;
}
