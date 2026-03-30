// F:\tentaclaw-os\agent\src\edge.ts
// Edge Inference Platform — Every Device is a Node
// CLAWtopus says: "From datacenter to Pi. I run everywhere."

/**
 * Edge Inference Module — Lightweight Inference on Edge Hardware
 *
 * Detects and manages edge devices (Jetson, Raspberry Pi, Orange Pi, etc.)
 * as TentaCLAW cluster nodes. Handles:
 *   - Hardware detection via /proc/device-tree, /proc/cpuinfo, tegra-fuse, etc.
 *   - Model recommendations based on device capabilities
 *   - Offline mode with local model cache and deferred sync
 *   - Power management (performance/balanced/power-save)
 *   - Edge mesh networking for peer-to-peer inference
 *
 * Zero external dependencies — uses only Node.js built-in modules.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import * as dgram from 'dgram';
import { execFileSync } from 'child_process';

// =============================================================================
// Types
// =============================================================================

export interface EdgeDevice {
    type: 'jetson-thor' | 'jetson-orin' | 'jetson-nano' | 'raspberry-pi-5' | 'orange-pi' | 'generic-arm' | 'generic-x86';
    name: string;
    arch: string;              // 'arm64' | 'armv7' | 'x86_64'
    memory_mb: number;
    cpu_cores: number;
    has_gpu: boolean;
    gpu_type?: string;         // 'nvidia-tegra', 'mali', 'hailo', 'none'
    compute_tops?: number;     // AI compute in TOPS
    power_budget_watts: number;
    recommended_models: string[];
    recommended_backend: string;
}

export interface EdgeCapabilities {
    device: EdgeDevice;
    max_model_size_mb: number;
    supports_gpu_inference: boolean;
    supports_npu: boolean;
    npu_type?: string;
    supported_backends: string[];
    max_concurrent_models: number;
    estimated_idle_watts: number;
}

export interface EdgePerformanceEstimate {
    model: string;
    device_type: EdgeDevice['type'];
    estimated_tok_s: number;
    estimated_prompt_tok_s: number;
    estimated_vram_mb: number;
    fits_in_memory: boolean;
    recommended_quantization: string;
    backend: string;
}

export type EdgePowerMode = 'performance' | 'balanced' | 'power-save';

export interface EdgeBatteryStatus {
    has_battery: boolean;
    level_pct: number;
    charging: boolean;
    time_remaining_mins: number;
}

export interface EdgeThermalStatus {
    temperature_c: number;
    throttled: boolean;
    thermal_zones: Array<{ zone: string; temp_c: number }>;
    fan_speed_pct: number;
}

export interface OfflineCacheEntry {
    model: string;
    path: string;
    size_mb: number;
    cached_at: number;
}

export interface OfflineConversationEntry {
    id: string;
    model: string;
    messages: number;
    created_at: number;
}

export interface OfflineCache {
    models: OfflineCacheEntry[];
    conversations: OfflineConversationEntry[];
    total_size_mb: number;
}

export interface EdgePeer {
    id: string;
    name: string;
    address: string;
    port: number;
    device_type: EdgeDevice['type'];
    available_models: string[];
    load_pct: number;
    last_seen: number;
}

export interface EdgeMesh {
    self_id: string;
    peers: EdgePeer[];
    total_compute_tops: number;
    total_memory_mb: number;
}

export interface EdgeModelEntry {
    model: string;
    device: string;
    vram_mb: number;
    toks: number;
    desc: string;
}

// =============================================================================
// Constants
// =============================================================================

const LOG_PREFIX = '[edge]';

/** Default cache directory for offline models */
const OFFLINE_CACHE_DIR = '/var/lib/tentaclaw/edge-cache';

/** Mesh discovery port (UDP broadcast) */
const MESH_DISCOVERY_PORT = 41340;

/** Mesh discovery magic string */
const MESH_MAGIC = 'TENTACLAW-EDGE';

/** Mesh peer timeout (considered stale after 2 minutes) */
const MESH_PEER_TIMEOUT_MS = 120_000;

/** Edge model catalog — models known to run well on constrained hardware */
export const EDGE_MODELS: EdgeModelEntry[] = [
    { model: 'gemma3:4b', device: 'any', vram_mb: 3000, toks: 15, desc: 'Small but capable' },
    { model: 'phi3:mini', device: 'any', vram_mb: 2500, toks: 20, desc: 'Microsoft efficient' },
    { model: 'llama3.2:1b', device: 'pi5', vram_mb: 1500, toks: 8, desc: 'Fits on Pi 5 4GB' },
    { model: 'llama3.2:3b', device: 'jetson-nano', vram_mb: 3000, toks: 12, desc: 'Good for Jetson Nano' },
    { model: 'qwen2.5:1.5b', device: 'any', vram_mb: 1500, toks: 25, desc: 'Fast tiny model' },
    { model: 'tinyllama', device: 'pi5', vram_mb: 800, toks: 30, desc: 'Smallest practical model' },
];

/** Device-type to default power budget mapping (watts) */
const DEFAULT_POWER_BUDGETS: Record<EdgeDevice['type'], number> = {
    'jetson-thor': 100,
    'jetson-orin': 60,
    'jetson-nano': 15,
    'raspberry-pi-5': 12,
    'orange-pi': 10,
    'generic-arm': 15,
    'generic-x86': 65,
};

/** Device-type to AI compute TOPS mapping */
const DEFAULT_COMPUTE_TOPS: Partial<Record<EdgeDevice['type'], number>> = {
    'jetson-thor': 800,
    'jetson-orin': 275,
    'jetson-nano': 21,
};

// =============================================================================
// Module State
// =============================================================================

let offlineModeEnabled = false;
let currentPowerMode: EdgePowerMode = 'balanced';
const knownPeers: EdgePeer[] = [];
let meshSocket: dgram.Socket | null = null;
let meshTimer: ReturnType<typeof setInterval> | null = null;
let cachedDevice: EdgeDevice | null = null;

// =============================================================================
// Helpers
// =============================================================================

/** Safely read a file, returning null on failure. */
function readFileOrNull(path: string): string | null {
    try {
        return fs.readFileSync(path, 'utf-8').trim();
    } catch {
        return null;
    }
}

/** Safe parseInt with fallback. */
function safeInt(s: string, fallback: number = 0): number {
    const v = parseInt(s, 10);
    return isNaN(v) ? fallback : v;
}

/** Safe parseFloat with fallback. */
function safeFloat(s: string, fallback: number = 0): number {
    const v = parseFloat(s);
    return isNaN(v) ? fallback : v;
}

/**
 * Run execFileSync and return trimmed stdout, or null on failure.
 * Uses execFile (not exec) to avoid shell injection.
 */
function execFileOrNull(file: string, args: string[], timeoutMs: number = 5_000): string | null {
    try {
        return execFileSync(file, args, {
            encoding: 'utf-8',
            timeout: timeoutMs,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    } catch {
        return null;
    }
}

/** Get total system memory in MB. */
function getTotalMemoryMb(): number {
    return Math.round(os.totalmem() / (1024 * 1024));
}

/** Get CPU architecture string. */
function getArch(): string {
    const arch = os.arch();
    if (arch === 'arm64' || arch === 'aarch64') return 'arm64';
    if (arch === 'arm') return 'armv7';
    if (arch === 'x64') return 'x86_64';
    return arch;
}

/** HTTP GET helper, returns body or null on failure. */
function httpGet(url: string, timeoutMs: number): Promise<{ status: number; body: string } | null> {
    return new Promise((resolve) => {
        try {
            const req = http.get(url, { timeout: timeoutMs }, (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => resolve({ status: res.statusCode || 0, body }));
                res.on('error', () => resolve(null));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        } catch {
            resolve(null);
        }
    });
}

/** HTTP POST helper for sync operations. */
function httpPost(url: string, data: string, timeoutMs: number): Promise<{ status: number; body: string } | null> {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const options: http.RequestOptions = {
                hostname: parsed.hostname,
                port: parsed.port || 80,
                path: parsed.pathname,
                method: 'POST',
                timeout: timeoutMs,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                },
            };
            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => resolve({ status: res.statusCode || 0, body }));
                res.on('error', () => resolve(null));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.write(data);
            req.end();
        } catch {
            resolve(null);
        }
    });
}

// =============================================================================
// Edge Device Detection
// =============================================================================

/**
 * Detect if running on a Jetson device by reading Tegra device-tree info.
 * Returns the Jetson variant or null if not a Jetson.
 */
function detectJetson(): { type: EdgeDevice['type']; name: string; gpu_type: string; compute_tops: number } | null {
    // Check for NVIDIA Tegra device-tree
    const dtModel = readFileOrNull('/proc/device-tree/model');
    const dtCompatible = readFileOrNull('/proc/device-tree/compatible');

    const tegraIndicator = dtModel || dtCompatible || '';
    const lowerIndicator = tegraIndicator.toLowerCase();

    // Also check for tegrastats / jetson_clocks presence
    const hasTegraStats = fs.existsSync('/usr/bin/tegrastats');
    const hasJetsonClocks = fs.existsSync('/usr/bin/jetson_clocks');

    if (!lowerIndicator.includes('tegra') && !lowerIndicator.includes('jetson') && !hasTegraStats && !hasJetsonClocks) {
        return null;
    }

    // Determine specific Jetson model
    if (lowerIndicator.includes('thor') || lowerIndicator.includes('p3740')) {
        return { type: 'jetson-thor', name: 'NVIDIA Jetson Thor', gpu_type: 'nvidia-tegra', compute_tops: 800 };
    }

    if (lowerIndicator.includes('orin') || lowerIndicator.includes('p3767') || lowerIndicator.includes('p3768')) {
        // Distinguish Orin variants
        const memMb = getTotalMemoryMb();
        const orinVariant = memMb >= 60000 ? 'AGX Orin 64GB' : memMb >= 28000 ? 'AGX Orin 32GB' : 'Orin Nano/NX';
        return { type: 'jetson-orin', name: `NVIDIA Jetson ${orinVariant}`, gpu_type: 'nvidia-tegra', compute_tops: memMb >= 28000 ? 275 : 100 };
    }

    if (lowerIndicator.includes('nano') || lowerIndicator.includes('p3450')) {
        return { type: 'jetson-nano', name: 'NVIDIA Jetson Nano', gpu_type: 'nvidia-tegra', compute_tops: 21 };
    }

    // Generic Jetson fallback — check nvidia-smi for Tegra GPU
    const nvSmiOutput = execFileOrNull('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader,nounits']);
    if (nvSmiOutput && nvSmiOutput.toLowerCase().includes('tegra')) {
        return { type: 'jetson-orin', name: `NVIDIA Jetson (${nvSmiOutput.trim()})`, gpu_type: 'nvidia-tegra', compute_tops: 100 };
    }

    // Fallback: if tegrastats exists, it's some kind of Jetson
    if (hasTegraStats) {
        return { type: 'jetson-nano', name: 'NVIDIA Jetson (Unknown Variant)', gpu_type: 'nvidia-tegra', compute_tops: 21 };
    }

    return null;
}

/**
 * Detect if running on a Raspberry Pi by checking device-tree and cpuinfo.
 */
function detectRaspberryPi(): { type: EdgeDevice['type']; name: string } | null {
    // Check device-tree model
    const dtModel = readFileOrNull('/proc/device-tree/model');
    if (dtModel && dtModel.toLowerCase().includes('raspberry pi')) {
        // Determine version
        if (dtModel.includes('5')) {
            return { type: 'raspberry-pi-5', name: dtModel };
        }
        // Pi 4 or older — still treat as pi5 type (closest match in our enum)
        return { type: 'raspberry-pi-5', name: dtModel };
    }

    // Fallback: check cpuinfo for BCM (Broadcom SoC in Raspberry Pi)
    const cpuinfo = readFileOrNull('/proc/cpuinfo');
    if (cpuinfo) {
        const lowerCpu = cpuinfo.toLowerCase();
        if (lowerCpu.includes('raspberry pi') || lowerCpu.includes('bcm2711') || lowerCpu.includes('bcm2712') || lowerCpu.includes('bcm2835')) {
            const isPi5 = lowerCpu.includes('bcm2712');
            const name = isPi5 ? 'Raspberry Pi 5' : 'Raspberry Pi';
            return { type: 'raspberry-pi-5', name };
        }
    }

    return null;
}

/**
 * Detect if running on an Orange Pi or similar Allwinner/RK3588 SBC.
 */
function detectOrangePi(): { type: EdgeDevice['type']; name: string; gpu_type: string } | null {
    const dtModel = readFileOrNull('/proc/device-tree/model');
    if (!dtModel) return null;

    const lower = dtModel.toLowerCase();

    if (lower.includes('orange pi')) {
        // Check for Mali GPU
        const hasMali = fs.existsSync('/dev/mali0') || fs.existsSync('/dev/mali');
        return { type: 'orange-pi', name: dtModel, gpu_type: hasMali ? 'mali' : 'none' };
    }

    // Also detect other common SBCs with RK3588 (Pine64, Radxa, etc.)
    if (lower.includes('rk3588') || lower.includes('rk3566') || lower.includes('rk3568')) {
        const hasMali = fs.existsSync('/dev/mali0') || fs.existsSync('/dev/mali');
        return { type: 'orange-pi', name: dtModel, gpu_type: hasMali ? 'mali' : 'none' };
    }

    return null;
}

/**
 * Detect if a Hailo NPU is present (common add-on for Pi and edge devices).
 */
function detectHailoNpu(): { present: boolean; model?: string; tops?: number } {
    // Check for Hailo device nodes
    if (fs.existsSync('/dev/hailo0')) {
        // Try hailortcli to get info
        const hailoInfo = execFileOrNull('hailortcli', ['fw-control', 'identify']);
        if (hailoInfo) {
            if (hailoInfo.includes('Hailo-8L')) {
                return { present: true, model: 'Hailo-8L', tops: 13 };
            }
            if (hailoInfo.includes('Hailo-8')) {
                return { present: true, model: 'Hailo-8', tops: 26 };
            }
            return { present: true, model: 'Hailo (unknown)', tops: 13 };
        }
        return { present: true, model: 'Hailo', tops: 13 };
    }

    // Check for Hailo PCIe device via lspci
    const lspci = execFileOrNull('lspci', []);
    if (lspci && lspci.toLowerCase().includes('hailo')) {
        return { present: true, model: 'Hailo (PCIe)', tops: 26 };
    }

    return { present: false };
}

/**
 * Auto-detect the edge device we're running on.
 *
 * Detection order:
 *   1. Jetson (device-tree + tegrastats)
 *   2. Raspberry Pi (device-tree + cpuinfo)
 *   3. Orange Pi / RK3588 SBCs (device-tree)
 *   4. Generic ARM (if arch is arm64/armv7)
 *   5. Generic x86 (small form factor / low memory)
 *   6. null (not an edge device)
 */
export function detectEdgeDevice(): EdgeDevice | null {
    // Return cached result if available
    if (cachedDevice) return cachedDevice;

    const arch = getArch();
    const memoryMb = getTotalMemoryMb();
    const cpuCores = os.cpus().length;

    // --- Jetson Detection ---
    const jetson = detectJetson();
    if (jetson) {
        const models = getEdgeRecommendedModelsForProfile(memoryMb, true, jetson.compute_tops);
        const device: EdgeDevice = {
            type: jetson.type,
            name: jetson.name,
            arch,
            memory_mb: memoryMb,
            cpu_cores: cpuCores,
            has_gpu: true,
            gpu_type: jetson.gpu_type,
            compute_tops: jetson.compute_tops,
            power_budget_watts: DEFAULT_POWER_BUDGETS[jetson.type],
            recommended_models: models,
            recommended_backend: 'llamacpp', // TensorRT-LLM or llama.cpp with CUDA on Jetson
        };
        cachedDevice = device;
        console.log(`${LOG_PREFIX} Detected Jetson: ${jetson.name} (${memoryMb}MB RAM, ${jetson.compute_tops} TOPS)`);
        return device;
    }

    // --- Raspberry Pi Detection ---
    const rpi = detectRaspberryPi();
    if (rpi) {
        const hailo = detectHailoNpu();
        const models = getEdgeRecommendedModelsForProfile(memoryMb, false, hailo.tops || 0);
        const device: EdgeDevice = {
            type: rpi.type,
            name: rpi.name,
            arch,
            memory_mb: memoryMb,
            cpu_cores: cpuCores,
            has_gpu: false,
            gpu_type: hailo.present ? 'hailo' : 'none',
            compute_tops: hailo.tops,
            power_budget_watts: DEFAULT_POWER_BUDGETS['raspberry-pi-5'],
            recommended_models: models,
            recommended_backend: 'llamacpp',
        };
        cachedDevice = device;
        console.log(`${LOG_PREFIX} Detected Raspberry Pi: ${rpi.name} (${memoryMb}MB RAM${hailo.present ? `, ${hailo.model}` : ''})`);
        return device;
    }

    // --- Orange Pi / SBC Detection ---
    const opi = detectOrangePi();
    if (opi) {
        const models = getEdgeRecommendedModelsForProfile(memoryMb, opi.gpu_type !== 'none', 0);
        const device: EdgeDevice = {
            type: opi.type,
            name: opi.name,
            arch,
            memory_mb: memoryMb,
            cpu_cores: cpuCores,
            has_gpu: opi.gpu_type !== 'none',
            gpu_type: opi.gpu_type,
            power_budget_watts: DEFAULT_POWER_BUDGETS['orange-pi'],
            recommended_models: models,
            recommended_backend: 'llamacpp',
        };
        cachedDevice = device;
        console.log(`${LOG_PREFIX} Detected SBC: ${opi.name} (${memoryMb}MB RAM)`);
        return device;
    }

    // --- Generic ARM Detection ---
    if (arch === 'arm64' || arch === 'armv7') {
        const models = getEdgeRecommendedModelsForProfile(memoryMb, false, 0);
        const device: EdgeDevice = {
            type: 'generic-arm',
            name: `ARM Device (${os.hostname()})`,
            arch,
            memory_mb: memoryMb,
            cpu_cores: cpuCores,
            has_gpu: false,
            gpu_type: 'none',
            power_budget_watts: DEFAULT_POWER_BUDGETS['generic-arm'],
            recommended_models: models,
            recommended_backend: 'llamacpp',
        };
        cachedDevice = device;
        console.log(`${LOG_PREFIX} Detected generic ARM device: ${arch} (${memoryMb}MB RAM)`);
        return device;
    }

    // --- Generic x86 edge (low-memory systems, NUCs, thin clients) ---
    // Consider x86 systems with <= 16GB RAM as potential edge nodes
    if (arch === 'x86_64' && memoryMb <= 16384) {
        const models = getEdgeRecommendedModelsForProfile(memoryMb, false, 0);
        const device: EdgeDevice = {
            type: 'generic-x86',
            name: `x86 Edge (${os.hostname()})`,
            arch,
            memory_mb: memoryMb,
            cpu_cores: cpuCores,
            has_gpu: false,
            gpu_type: 'none',
            power_budget_watts: DEFAULT_POWER_BUDGETS['generic-x86'],
            recommended_models: models,
            recommended_backend: 'llamacpp',
        };
        cachedDevice = device;
        console.log(`${LOG_PREFIX} Detected x86 edge device: ${memoryMb}MB RAM, ${cpuCores} cores`);
        return device;
    }

    return null;
}

/**
 * Returns true if the current system is detected as an edge device.
 */
export function isEdgeDevice(): boolean {
    return detectEdgeDevice() !== null;
}

/**
 * Get the capabilities of the detected edge device.
 * Returns null if not running on an edge device.
 */
export function getEdgeCapabilities(): EdgeCapabilities | null {
    const device = detectEdgeDevice();
    if (!device) return null;

    // Estimate max model size: ~60% of total RAM for CPU inference,
    // ~80% of VRAM for GPU inference on Jetson
    const gpuInference = device.has_gpu && (device.gpu_type === 'nvidia-tegra');
    const maxModelSizeMb = gpuInference
        ? Math.round(device.memory_mb * 0.80)  // Jetson uses unified memory
        : Math.round(device.memory_mb * 0.60);  // CPU-only: leave room for OS

    const supportsNpu = device.gpu_type === 'hailo';
    const hailo = supportsNpu ? detectHailoNpu() : { present: false };

    // Determine supported backends
    const backends: string[] = ['llamacpp']; // Always available
    if (device.has_gpu && device.gpu_type === 'nvidia-tegra') {
        backends.push('tensorrt-llm');
    }
    if (device.type === 'generic-x86') {
        backends.push('ollama');
    }

    // Max concurrent models: based on memory
    const avgModelSize = 2000; // ~2GB average for edge models
    const maxConcurrent = Math.max(1, Math.floor(maxModelSizeMb / avgModelSize));

    // Idle power estimate
    const idleWatts: Record<EdgeDevice['type'], number> = {
        'jetson-thor': 30,
        'jetson-orin': 15,
        'jetson-nano': 5,
        'raspberry-pi-5': 3,
        'orange-pi': 3,
        'generic-arm': 5,
        'generic-x86': 20,
    };

    return {
        device,
        max_model_size_mb: maxModelSizeMb,
        supports_gpu_inference: gpuInference,
        supports_npu: supportsNpu,
        npu_type: hailo.present ? (hailo as { model?: string }).model : undefined,
        supported_backends: backends,
        max_concurrent_models: maxConcurrent,
        estimated_idle_watts: idleWatts[device.type],
    };
}

// =============================================================================
// Edge-Optimized Inference
// =============================================================================

/**
 * Internal helper: recommend models based on memory, GPU availability, and compute.
 */
function getEdgeRecommendedModelsForProfile(memoryMb: number, hasGpu: boolean, computeTops: number): string[] {
    const recommended: string[] = [];

    // Sort EDGE_MODELS by VRAM requirement (ascending) and pick those that fit
    const sorted = [...EDGE_MODELS].sort((a, b) => a.vram_mb - b.vram_mb);

    // Usable memory: 60% for CPU, 80% for GPU (unified memory)
    const usableMb = hasGpu ? memoryMb * 0.80 : memoryMb * 0.60;

    for (const entry of sorted) {
        if (entry.vram_mb > usableMb) continue;

        // Check device compatibility
        if (entry.device === 'any') {
            recommended.push(entry.model);
        } else if (entry.device === 'pi5' && memoryMb <= 8192 && !hasGpu) {
            recommended.push(entry.model);
        } else if (entry.device === 'jetson-nano' && hasGpu) {
            recommended.push(entry.model);
        }
    }

    // If high compute (Jetson Orin/Thor), also add larger models
    if (computeTops >= 100 && usableMb >= 6000) {
        recommended.push('llama3.1:8b');
    }
    if (computeTops >= 200 && usableMb >= 12000) {
        recommended.push('llama3.1:13b');
    }

    return recommended;
}

/**
 * Get recommended models for a specific edge device.
 */
export function getEdgeRecommendedModels(device: EdgeDevice): string[] {
    return getEdgeRecommendedModelsForProfile(
        device.memory_mb,
        device.has_gpu,
        device.compute_tops || 0,
    );
}

/**
 * Get the best inference backend for a given edge device.
 *
 * Selection logic:
 *   - Jetson: TensorRT-LLM if available, else llama.cpp with CUDA
 *   - Raspberry Pi / ARM: llama.cpp (CPU-optimized)
 *   - Generic x86: llama.cpp or Ollama
 */
export function getEdgeBackend(device: EdgeDevice): string {
    switch (device.type) {
        case 'jetson-thor':
        case 'jetson-orin': {
            // Check if TensorRT-LLM is installed
            const hasTrtLlm = fs.existsSync('/usr/lib/python3/dist-packages/tensorrt_llm');
            if (!hasTrtLlm) {
                const pythonCheck = execFileOrNull('python3', ['-c', 'import tensorrt_llm']);
                if (pythonCheck !== null) return 'tensorrt-llm';
            } else {
                return 'tensorrt-llm';
            }
            return 'llamacpp';
        }
        case 'jetson-nano':
            return 'llamacpp'; // TensorRT-LLM is too heavy for Nano
        case 'raspberry-pi-5':
        case 'orange-pi':
        case 'generic-arm':
            return 'llamacpp';
        case 'generic-x86': {
            // Check if Ollama is installed
            const hasOllama = execFileOrNull('ollama', ['--version']) !== null;
            if (hasOllama) return 'ollama';
            return 'llamacpp';
        }
        default:
            return 'llamacpp';
    }
}

/**
 * Estimate inference performance for a model on a given edge device.
 *
 * Returns token generation speed, prompt processing speed, and memory usage
 * estimates based on device capabilities and model requirements.
 */
export function estimateEdgePerformance(model: string, device: EdgeDevice): EdgePerformanceEstimate {
    // Look up model in the catalog
    const catalogEntry = EDGE_MODELS.find((e) => e.model === model);

    // Estimate VRAM usage from catalog or by model name heuristic
    let vramMb = catalogEntry?.vram_mb || estimateModelVram(model);

    // Base tok/s from catalog
    const baseTokS = catalogEntry?.toks || 5;

    // Adjust tok/s based on device capabilities
    let adjustedTokS = baseTokS;

    switch (device.type) {
        case 'jetson-thor':
            adjustedTokS = baseTokS * 4.0;  // Thor is very fast
            break;
        case 'jetson-orin':
            adjustedTokS = baseTokS * 2.5;  // Orin is solid
            break;
        case 'jetson-nano':
            adjustedTokS = baseTokS * 1.0;  // Baseline
            break;
        case 'raspberry-pi-5':
            adjustedTokS = baseTokS * 0.5;  // CPU-only, slower
            break;
        case 'orange-pi':
            adjustedTokS = baseTokS * 0.4;  // Usually slower CPUs
            break;
        case 'generic-arm':
            adjustedTokS = baseTokS * 0.3;  // Depends heavily on specific hardware
            break;
        case 'generic-x86':
            adjustedTokS = baseTokS * 0.8;  // x86 is usually decent at CPU inference
            break;
    }

    // Power mode adjustments
    if (currentPowerMode === 'power-save') {
        adjustedTokS *= 0.6;
    } else if (currentPowerMode === 'performance') {
        adjustedTokS *= 1.2;
    }

    // Usable memory
    const usableMb = device.has_gpu ? device.memory_mb * 0.80 : device.memory_mb * 0.60;
    const fitsInMemory = vramMb <= usableMb;

    // Prompt processing is typically 3-5x faster than generation
    const promptTokS = adjustedTokS * 4;

    // Recommend quantization based on device memory
    let quantization = 'Q4_K_M'; // good default
    if (device.memory_mb <= 2048) {
        quantization = 'Q2_K';
        vramMb = Math.round(vramMb * 0.5); // Q2 uses ~50% of Q4 memory
    } else if (device.memory_mb <= 4096) {
        quantization = 'Q3_K_S';
        vramMb = Math.round(vramMb * 0.7);
    } else if (device.memory_mb >= 16384) {
        quantization = 'Q5_K_M';
        vramMb = Math.round(vramMb * 1.2);
    }

    return {
        model,
        device_type: device.type,
        estimated_tok_s: Math.round(adjustedTokS * 10) / 10,
        estimated_prompt_tok_s: Math.round(promptTokS * 10) / 10,
        estimated_vram_mb: vramMb,
        fits_in_memory: fitsInMemory,
        recommended_quantization: quantization,
        backend: getEdgeBackend(device),
    };
}

/**
 * Estimate VRAM for a model by name heuristic (when not in catalog).
 * Very rough: ~0.6GB per billion parameters at Q4 quantization.
 */
function estimateModelVram(model: string): number {
    const lower = model.toLowerCase();
    // Try to extract parameter count from model name (e.g., "llama3.2:3b" -> 3)
    const paramMatch = lower.match(/(\d+(?:\.\d+)?)b/);
    if (paramMatch) {
        const params = safeFloat(paramMatch[1], 1);
        return Math.round(params * 600); // ~600MB per billion params at Q4
    }
    // Default: assume ~2GB
    return 2000;
}

// =============================================================================
// Offline Mode
// =============================================================================

/**
 * Enable offline mode — cache models locally, serve without gateway connection.
 *
 * In offline mode:
 *   - Models are loaded from local cache only
 *   - Inference results are stored locally for later sync
 *   - No gateway communication is attempted
 */
export function enableOfflineMode(): void {
    offlineModeEnabled = true;

    // Ensure cache directory exists
    try {
        if (!fs.existsSync(OFFLINE_CACHE_DIR)) {
            fs.mkdirSync(OFFLINE_CACHE_DIR, { recursive: true });
        }
        if (!fs.existsSync(OFFLINE_CACHE_DIR + '/models')) {
            fs.mkdirSync(OFFLINE_CACHE_DIR + '/models', { recursive: true });
        }
        if (!fs.existsSync(OFFLINE_CACHE_DIR + '/conversations')) {
            fs.mkdirSync(OFFLINE_CACHE_DIR + '/conversations', { recursive: true });
        }
    } catch (e) {
        console.error(`${LOG_PREFIX} Failed to create cache directories: ${e}`);
    }

    console.log(`${LOG_PREFIX} Offline mode enabled. Cache dir: ${OFFLINE_CACHE_DIR}`);
}

/**
 * Disable offline mode — resume normal gateway-connected operation.
 */
export function disableOfflineMode(): void {
    offlineModeEnabled = false;
    console.log(`${LOG_PREFIX} Offline mode disabled. Resuming gateway connection.`);
}

/**
 * Check if offline mode is currently enabled.
 */
export function isOfflineMode(): boolean {
    return offlineModeEnabled;
}

/**
 * Get the offline cache contents — cached models and conversations.
 */
export function getOfflineCache(): OfflineCache {
    const result: OfflineCache = {
        models: [],
        conversations: [],
        total_size_mb: 0,
    };

    // Scan model cache directory
    const modelDir = OFFLINE_CACHE_DIR + '/models';
    try {
        if (fs.existsSync(modelDir)) {
            const entries = fs.readdirSync(modelDir);
            for (const entry of entries) {
                const fullPath = modelDir + '/' + entry;
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isFile()) {
                        const sizeMb = Math.round(stat.size / (1024 * 1024));
                        result.models.push({
                            model: entry.replace(/\.gguf$/, '').replace(/\.bin$/, ''),
                            path: fullPath,
                            size_mb: sizeMb,
                            cached_at: stat.mtimeMs,
                        });
                        result.total_size_mb += sizeMb;
                    }
                } catch {
                    // Skip entries we can't stat
                }
            }
        }
    } catch {
        // Model dir not readable
    }

    // Scan conversation cache directory
    const convDir = OFFLINE_CACHE_DIR + '/conversations';
    try {
        if (fs.existsSync(convDir)) {
            const entries = fs.readdirSync(convDir);
            for (const entry of entries) {
                if (!entry.endsWith('.json')) continue;
                const fullPath = convDir + '/' + entry;
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const conv = JSON.parse(content) as {
                        id?: string;
                        model?: string;
                        messages?: unknown[];
                        created_at?: number;
                    };
                    result.conversations.push({
                        id: conv.id || entry.replace('.json', ''),
                        model: conv.model || 'unknown',
                        messages: Array.isArray(conv.messages) ? conv.messages.length : 0,
                        created_at: conv.created_at || 0,
                    });
                } catch {
                    // Skip malformed conversation files
                }
            }
        }
    } catch {
        // Conversation dir not readable
    }

    return result;
}

/**
 * Upload cached offline results to the gateway when back online.
 *
 * Sends all cached conversations to the gateway's sync endpoint,
 * then cleans up successfully synced entries.
 *
 * @param gatewayUrl - The gateway URL to sync to (e.g., "http://192.168.1.10:8080")
 * @returns Number of conversations synced, or -1 on total failure
 */
export async function syncOfflineResults(gatewayUrl: string): Promise<number> {
    const cache = getOfflineCache();

    if (cache.conversations.length === 0) {
        console.log(`${LOG_PREFIX} No offline conversations to sync.`);
        return 0;
    }

    console.log(`${LOG_PREFIX} Syncing ${cache.conversations.length} offline conversations to ${gatewayUrl}...`);

    let synced = 0;
    const convDir = OFFLINE_CACHE_DIR + '/conversations';

    for (const conv of cache.conversations) {
        const filePath = convDir + '/' + conv.id + '.json';
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const result = await httpPost(
                gatewayUrl + '/api/edge/sync',
                content,
                10_000,
            );

            if (result && result.status >= 200 && result.status < 300) {
                // Successfully synced — remove local file
                try {
                    fs.unlinkSync(filePath);
                } catch {
                    // Couldn't delete, leave it
                }
                synced++;
                console.log(`${LOG_PREFIX} Synced conversation ${conv.id}`);
            } else {
                console.log(`${LOG_PREFIX} Failed to sync conversation ${conv.id}: status ${result?.status || 'unknown'}`);
            }
        } catch (e) {
            console.error(`${LOG_PREFIX} Error syncing conversation ${conv.id}: ${e}`);
        }
    }

    console.log(`${LOG_PREFIX} Sync complete: ${synced}/${cache.conversations.length} conversations uploaded.`);
    return synced;
}

// =============================================================================
// Power Management
// =============================================================================

/**
 * Get the current edge power mode.
 */
export function getEdgePowerMode(): EdgePowerMode {
    return currentPowerMode;
}

/**
 * Set the edge power mode.
 *
 * On Jetson devices, this maps to nvpmodel power modes:
 *   - performance: MAXN (max power/performance)
 *   - balanced: default mode
 *   - power-save: lowest power mode
 *
 * On other devices, this adjusts CPU governor and frequency limits.
 */
export function setEdgePowerMode(mode: EdgePowerMode): boolean {
    const device = detectEdgeDevice();
    const prevMode = currentPowerMode;
    currentPowerMode = mode;

    if (!device) {
        console.log(`${LOG_PREFIX} Power mode set to '${mode}' (no edge device detected, software-only adjustment)`);
        return true;
    }

    let hardwareSet = false;

    // Jetson: use nvpmodel
    if (device.type === 'jetson-thor' || device.type === 'jetson-orin' || device.type === 'jetson-nano') {
        const nvpmodelMap: Record<EdgePowerMode, string> = {
            'performance': '0', // MAXN
            'balanced': '1',    // Default balanced
            'power-save': '2',  // Low power
        };
        const result = execFileOrNull('nvpmodel', ['-m', nvpmodelMap[mode]]);
        if (result !== null) {
            hardwareSet = true;

            // Also run jetson_clocks for performance mode
            if (mode === 'performance') {
                execFileOrNull('jetson_clocks', []);
            } else if (prevMode === 'performance') {
                execFileOrNull('jetson_clocks', ['--restore']);
            }
        }
    }

    // Linux: try to set CPU governor
    if (process.platform === 'linux') {
        const governorMap: Record<EdgePowerMode, string> = {
            'performance': 'performance',
            'balanced': 'schedutil',
            'power-save': 'powersave',
        };
        const governor = governorMap[mode];
        const cpuCount = os.cpus().length;
        for (let i = 0; i < cpuCount; i++) {
            const governorPath = `/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_governor`;
            try {
                fs.writeFileSync(governorPath, governor);
                hardwareSet = true;
            } catch {
                // Requires root; silently skip
            }
        }
    }

    console.log(`${LOG_PREFIX} Power mode: ${prevMode} -> ${mode}${hardwareSet ? ' (hardware adjusted)' : ' (software only)'}`);
    return true;
}

/**
 * Get battery status if available (laptops, UPS-backed edge nodes).
 */
export function getEdgeBatteryStatus(): EdgeBatteryStatus {
    const result: EdgeBatteryStatus = {
        has_battery: false,
        level_pct: 100,
        charging: false,
        time_remaining_mins: -1,
    };

    // Linux: check /sys/class/power_supply/
    if (process.platform === 'linux') {
        const batteryPaths = [
            '/sys/class/power_supply/BAT0',
            '/sys/class/power_supply/BAT1',
            '/sys/class/power_supply/battery',
        ];

        for (const batPath of batteryPaths) {
            if (!fs.existsSync(batPath)) continue;

            result.has_battery = true;

            const capacityStr = readFileOrNull(batPath + '/capacity');
            if (capacityStr) {
                result.level_pct = safeInt(capacityStr, 100);
            }

            const statusStr = readFileOrNull(batPath + '/status');
            if (statusStr) {
                result.charging = statusStr.toLowerCase() === 'charging';
            }

            // Estimate time remaining from energy_now / power_now
            const energyNow = readFileOrNull(batPath + '/energy_now');
            const powerNow = readFileOrNull(batPath + '/power_now');
            if (energyNow && powerNow) {
                const energy = safeFloat(energyNow);
                const power = safeFloat(powerNow);
                if (power > 0 && !result.charging) {
                    result.time_remaining_mins = Math.round((energy / power) * 60);
                }
            }

            break; // Use first battery found
        }
    }

    // macOS: use pmset (for Mac Mini / MacBook edge nodes)
    if (process.platform === 'darwin') {
        const pmset = execFileOrNull('pmset', ['-g', 'batt']);
        if (pmset) {
            const pctMatch = pmset.match(/(\d+)%/);
            if (pctMatch) {
                result.has_battery = true;
                result.level_pct = safeInt(pctMatch[1], 100);
                result.charging = pmset.includes('charging') || pmset.includes('AC Power');
            }
            const timeMatch = pmset.match(/(\d+):(\d+)\s+remaining/);
            if (timeMatch) {
                result.time_remaining_mins = safeInt(timeMatch[1]) * 60 + safeInt(timeMatch[2]);
            }
        }
    }

    return result;
}

/**
 * Get thermal status — temperature and throttling information.
 */
export function getEdgeThermalStatus(): EdgeThermalStatus {
    const result: EdgeThermalStatus = {
        temperature_c: -1,
        throttled: false,
        thermal_zones: [],
        fan_speed_pct: -1,
    };

    // Linux: read thermal zones from sysfs
    if (process.platform === 'linux') {
        for (let i = 0; i < 20; i++) {
            const tempPath = `/sys/class/thermal/thermal_zone${i}/temp`;
            const typePath = `/sys/class/thermal/thermal_zone${i}/type`;
            const tempStr = readFileOrNull(tempPath);
            if (!tempStr) break;

            const tempC = safeInt(tempStr) / 1000; // sysfs reports in millidegrees
            const zoneType = readFileOrNull(typePath) || `zone${i}`;

            result.thermal_zones.push({ zone: zoneType, temp_c: tempC });

            // Track highest temperature
            if (tempC > result.temperature_c) {
                result.temperature_c = tempC;
            }
        }

        // Check for throttling on Raspberry Pi
        const throttledStr = readFileOrNull('/sys/devices/platform/soc/soc:firmware/get_throttled');
        if (throttledStr) {
            const throttledVal = safeInt(throttledStr);
            // Bit 3 = currently throttled, Bit 1 = arm frequency capped
            result.throttled = (throttledVal & 0b1010) !== 0;
        }

        // Fan speed: check common paths
        const fanPaths = [
            '/sys/class/hwmon/hwmon0/pwm1',
            '/sys/class/hwmon/hwmon1/pwm1',
            '/sys/devices/pwm-fan/target_pwm',
        ];
        for (const fanPath of fanPaths) {
            const fanStr = readFileOrNull(fanPath);
            if (fanStr) {
                const fanVal = safeInt(fanStr);
                // PWM is typically 0-255
                result.fan_speed_pct = Math.round((fanVal / 255) * 100);
                break;
            }
        }
    }

    // macOS: check thermal level
    if (process.platform === 'darwin') {
        const tempOutput = execFileOrNull('sysctl', ['-n', 'machdep.xcpm.cpu_thermal_level']);
        if (tempOutput) {
            const level = safeInt(tempOutput);
            result.throttled = level > 0;
        }
    }

    return result;
}

// =============================================================================
// Mesh Networking
// =============================================================================

/**
 * Generate a stable node ID for this edge device.
 */
function getNodeId(): string {
    const hostname = os.hostname();
    const mac = getMacAddress();
    // Simple hash of hostname + MAC for a stable ID
    let hash = 0;
    const input = hostname + ':' + mac;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return 'edge-' + Math.abs(hash).toString(16).padStart(8, '0');
}

/** Get first non-internal MAC address. */
function getMacAddress(): string {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
                return iface.mac;
            }
        }
    }
    return '00:00:00:00:00:00';
}

/**
 * Discover other edge peers on the local network via UDP broadcast.
 *
 * Sends a broadcast packet and listens for responses from other edge nodes.
 * Updates the internal peer list and returns discovered peers.
 */
export function discoverEdgePeers(): Promise<EdgePeer[]> {
    return new Promise((resolve) => {
        const device = detectEdgeDevice();
        const selfId = getNodeId();
        const localModels = device?.recommended_models || [];

        // Send our announcement
        const announcement = JSON.stringify({
            magic: MESH_MAGIC,
            id: selfId,
            name: os.hostname(),
            device_type: device?.type || 'unknown',
            models: localModels,
            load_pct: getCpuLoadPct(),
            port: 8082, // Default edge inference port
        });

        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        let resolved = false;

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                try { sock.close(); } catch { /* ignore */ }
                resolve([...knownPeers]);
            }
        }, 3_000);

        sock.on('message', (msg, rinfo) => {
            try {
                const data = JSON.parse(msg.toString()) as {
                    magic?: string;
                    id?: string;
                    name?: string;
                    device_type?: EdgeDevice['type'];
                    models?: string[];
                    load_pct?: number;
                    port?: number;
                };
                if (data.magic !== MESH_MAGIC || data.id === selfId) return;

                const peer: EdgePeer = {
                    id: data.id || 'unknown',
                    name: data.name || rinfo.address,
                    address: rinfo.address,
                    port: data.port || 8082,
                    device_type: data.device_type || 'generic-arm',
                    available_models: data.models || [],
                    load_pct: data.load_pct || 0,
                    last_seen: Date.now(),
                };

                // Upsert peer
                const existing = knownPeers.findIndex((p) => p.id === peer.id);
                if (existing >= 0) {
                    knownPeers[existing] = peer;
                } else {
                    knownPeers.push(peer);
                }
            } catch {
                // Malformed packet, ignore
            }
        });

        sock.on('error', () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve([...knownPeers]);
            }
        });

        try {
            sock.bind(MESH_DISCOVERY_PORT, () => {
                sock.setBroadcast(true);
                const broadcastAddr = '255.255.255.255';
                sock.send(announcement, MESH_DISCOVERY_PORT, broadcastAddr, () => {
                    // Announcement sent, wait for responses
                });
            });
        } catch {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve([...knownPeers]);
            }
        }
    });
}

/** Get approximate CPU load percentage. */
function getCpuLoadPct(): number {
    const load = os.loadavg()[0]; // 1-minute load average
    const cpuCount = os.cpus().length;
    return Math.min(100, Math.round((load / cpuCount) * 100));
}

/**
 * Get the current edge mesh topology.
 *
 * Returns the list of known peers, total compute capacity, and total memory
 * across all mesh nodes (including self).
 */
export function getEdgeMesh(): EdgeMesh {
    const selfId = getNodeId();
    const device = detectEdgeDevice();

    // Prune stale peers
    const now = Date.now();
    for (let i = knownPeers.length - 1; i >= 0; i--) {
        if (now - knownPeers[i].last_seen > MESH_PEER_TIMEOUT_MS) {
            knownPeers.splice(i, 1);
        }
    }

    // Calculate totals
    let totalTops = device?.compute_tops || 0;
    let totalMemory = device?.memory_mb || getTotalMemoryMb();

    for (const peer of knownPeers) {
        totalTops += DEFAULT_COMPUTE_TOPS[peer.device_type] || 0;
        // Estimate peer memory from device type
        const peerMemEstimate: Record<string, number> = {
            'jetson-thor': 65536,
            'jetson-orin': 32768,
            'jetson-nano': 4096,
            'raspberry-pi-5': 8192,
            'orange-pi': 4096,
            'generic-arm': 4096,
            'generic-x86': 8192,
        };
        totalMemory += peerMemEstimate[peer.device_type] || 4096;
    }

    return {
        self_id: selfId,
        peers: [...knownPeers],
        total_compute_tops: totalTops,
        total_memory_mb: totalMemory,
    };
}

/**
 * Route an inference request directly to an edge peer (skip gateway).
 *
 * This enables edge-to-edge inference where two edge nodes can collaborate
 * without requiring a gateway roundtrip. Useful for:
 *   - Local network deployments without internet
 *   - Latency-sensitive edge inference
 *   - Load balancing across edge nodes
 *
 * @param model - The model to run inference on
 * @param peer - The peer to route the request to
 * @returns The peer's inference endpoint URL, or null if the peer is unreachable
 */
export async function routeToEdgePeer(model: string, peer: EdgePeer): Promise<string | null> {
    // Verify the peer has the requested model
    if (!peer.available_models.includes(model)) {
        console.log(`${LOG_PREFIX} Peer ${peer.name} does not have model ${model}`);
        return null;
    }

    // Health check the peer
    const healthUrl = `http://${peer.address}:${peer.port}/health`;
    const healthResp = await httpGet(healthUrl, 3_000);

    if (!healthResp || healthResp.status >= 500) {
        console.log(`${LOG_PREFIX} Peer ${peer.name} (${peer.address}:${peer.port}) is unreachable`);
        return null;
    }

    const endpointUrl = `http://${peer.address}:${peer.port}/v1`;
    console.log(`${LOG_PREFIX} Routing model '${model}' to peer ${peer.name} at ${endpointUrl}`);
    return endpointUrl;
}

/**
 * Start the mesh discovery background loop.
 *
 * Periodically announces this node's presence and discovers peers.
 * Call this once during agent startup.
 */
export function startMeshDiscovery(intervalMs: number = 30_000): void {
    if (meshTimer) return; // Already running

    const tick = async () => {
        try {
            await discoverEdgePeers();
        } catch (e) {
            console.error(`${LOG_PREFIX} Mesh discovery tick failed: ${e}`);
        }
    };

    // Run immediately
    tick().catch(() => {});
    meshTimer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
    console.log(`${LOG_PREFIX} Mesh discovery started (every ${intervalMs / 1000}s)`);
}

/**
 * Stop the mesh discovery background loop.
 */
export function stopMeshDiscovery(): void {
    if (meshTimer) {
        clearInterval(meshTimer);
        meshTimer = null;
    }
    if (meshSocket) {
        try { meshSocket.close(); } catch { /* ignore */ }
        meshSocket = null;
    }
    console.log(`${LOG_PREFIX} Mesh discovery stopped`);
}

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * Clear the cached device detection result.
 * Useful if hardware has changed (e.g., hot-plugged accelerator).
 */
export function clearDeviceCache(): void {
    cachedDevice = null;
}

/**
 * Get a human-readable summary of the edge device and its capabilities.
 */
export function getEdgeSummary(): string {
    const device = detectEdgeDevice();
    if (!device) return 'Not an edge device';

    const caps = getEdgeCapabilities();
    const thermal = getEdgeThermalStatus();
    const battery = getEdgeBatteryStatus();
    const mesh = getEdgeMesh();

    const lines: string[] = [
        `Device: ${device.name} (${device.type})`,
        `Arch: ${device.arch} | Cores: ${device.cpu_cores} | RAM: ${device.memory_mb}MB`,
        `GPU: ${device.has_gpu ? (device.gpu_type || 'yes') : 'none'}${device.compute_tops ? ` (${device.compute_tops} TOPS)` : ''}`,
        `Power: ${device.power_budget_watts}W budget | Mode: ${currentPowerMode}`,
        `Backend: ${device.recommended_backend}`,
        `Models: ${device.recommended_models.join(', ') || 'none recommended'}`,
    ];

    if (caps) {
        lines.push(`Max model: ${caps.max_model_size_mb}MB | Concurrent: ${caps.max_concurrent_models}`);
    }

    if (thermal.temperature_c >= 0) {
        lines.push(`Temp: ${thermal.temperature_c}C${thermal.throttled ? ' (THROTTLED)' : ''}`);
    }

    if (battery.has_battery) {
        lines.push(`Battery: ${battery.level_pct}%${battery.charging ? ' (charging)' : ''}`);
    }

    if (mesh.peers.length > 0) {
        lines.push(`Mesh: ${mesh.peers.length} peers | Total: ${mesh.total_compute_tops} TOPS, ${mesh.total_memory_mb}MB`);
    }

    lines.push(`Offline: ${offlineModeEnabled ? 'enabled' : 'disabled'}`);

    return lines.join('\n');
}
