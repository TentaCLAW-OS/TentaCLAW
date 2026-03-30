/**
 * GPU Topology Detection — Know Your Hardware
 * CLAWtopus says: "I know every connection. Every bus. Every link."
 *
 * Detects the physical GPU interconnect topology (NVLink, PCIe, NVSwitch)
 * and reports it to the gateway for smarter scheduling decisions.
 *
 * Supports:
 *   - NVIDIA GPUs (nvidia-smi): NVLink, NVSwitch, PCIe topology
 *   - AMD GPUs (rocm-smi): xGMI / Infinity Fabric, PCIe topology
 *   - Apple Silicon: unified memory detection (no discrete interconnect)
 *
 * Zero external dependencies — uses only Node.js built-in modules.
 */

import { execFileSync } from 'child_process';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';

// =============================================================================
// Types
// =============================================================================

export interface GpuTopology {
    gpus: Array<{
        index: number;
        name: string;
        uuid: string;
        pci_bus_id: string;
        numa_node: number;
    }>;
    links: Array<{
        gpu_a: number;
        gpu_b: number;
        type: 'nvlink' | 'pcie' | 'nvswitch' | 'soc';
        bandwidth_gb_s: number;
        bidirectional: boolean;
    }>;
    pcie_topology: Array<{
        gpu_index: number;
        pcie_gen: number;
        pcie_width: number;
        pcie_switch?: string;
    }>;
    nvlink_version?: number;
    nvswitch_present: boolean;
    unified_memory: boolean;
    total_interconnect_bandwidth_gb_s: number;
}

/** A single cell from the nvidia-smi topology matrix. */
type TopoMatrixCell = 'X' | 'SYS' | 'NODE' | 'PHB' | 'PXB' | 'PIX' | string;

/** Row in the parsed topology matrix. */
interface TopoMatrixRow {
    gpu_index: number;
    cells: TopoMatrixCell[];
}

/** GPU identity from nvidia-smi CSV queries. */
interface NvidiaGpuIdentity {
    index: number;
    name: string;
    uuid: string;
    pci_bus_id: string;
    pcie_gen: number;
    pcie_width: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Bandwidth per NVLink sub-link (GB/s per direction) by NVLink version. */
const NVLINK_BW_PER_LINK: Record<number, number> = {
    1: 20,   // NVLink 1.0 (Pascal): ~20 GB/s per sub-link
    2: 25,   // NVLink 2.0 (Volta):  ~25 GB/s per sub-link
    3: 25,   // NVLink 3.0 (Ampere): ~25 GB/s per sub-link
    4: 25,   // NVLink 4.0 (Hopper): ~25 GB/s per sub-link (more sub-links)
};

/** Approximate PCIe bandwidth (GB/s per direction) by generation for x16. */
const PCIE_BW_X16: Record<number, number> = {
    3: 16,   // PCIe 3.0 x16 ~15.75 GB/s
    4: 32,   // PCIe 4.0 x16 ~31.5 GB/s
    5: 64,   // PCIe 5.0 x16 ~63 GB/s
    6: 128,  // PCIe 6.0 x16 ~126 GB/s
};

const LOG_PREFIX = '[topology]';

// =============================================================================
// Helpers
// =============================================================================

/** Run nvidia-smi with arguments, return trimmed stdout or null on failure. */
function nvidiaSmi(args: string[], timeoutMs: number = 15_000): string | null {
    try {
        return execFileSync('nvidia-smi', args, {
            encoding: 'utf-8',
            timeout: timeoutMs,
        }).trim();
    } catch {
        return null;
    }
}

/** Run rocm-smi with arguments, return trimmed stdout or null on failure. */
function rocmSmi(args: string[], timeoutMs: number = 15_000): string | null {
    try {
        return execFileSync('rocm-smi', args, {
            encoding: 'utf-8',
            timeout: timeoutMs,
        }).trim();
    } catch {
        return null;
    }
}

/** Run an arbitrary command, return trimmed stdout or null on failure. */
function runCmd(cmd: string, args: string[], timeoutMs: number = 10_000): string | null {
    try {
        return execFileSync(cmd, args, {
            encoding: 'utf-8',
            timeout: timeoutMs,
        }).trim();
    } catch {
        return null;
    }
}

/** Safe parseInt with fallback. */
function safeInt(s: string | null | undefined, fallback: number = 0): number {
    if (s == null) return fallback;
    const v = parseInt(s, 10);
    return isNaN(v) ? fallback : v;
}


/** Detect whether we are on Apple Silicon (arm64 macOS). */
function isAppleSilicon(): boolean {
    return process.platform === 'darwin' && os.arch() === 'arm64';
}

/** Detect whether nvidia-smi is available. */
function hasNvidiaSmi(): boolean {
    return nvidiaSmi(['--version']) !== null;
}

/** Detect whether rocm-smi is available. */
function hasRocmSmi(): boolean {
    return rocmSmi(['--version']) !== null;
}

// =============================================================================
// NVIDIA: GPU Identity Query
// =============================================================================

/**
 * Query basic identity info for all NVIDIA GPUs via nvidia-smi CSV output.
 */
function queryNvidiaGpuIdentities(): NvidiaGpuIdentity[] {
    const output = nvidiaSmi([
        '--query-gpu=index,name,uuid,pci.bus_id,pcie.link.gen.current,pcie.link.width.current',
        '--format=csv,noheader,nounits',
    ]);
    if (!output) return [];

    const gpus: NvidiaGpuIdentity[] = [];
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const cols = trimmed.split(',').map(s => s.trim());
        if (cols.length < 6) continue;

        gpus.push({
            index: safeInt(cols[0]),
            name: cols[1] || 'Unknown NVIDIA GPU',
            uuid: cols[2] || '',
            pci_bus_id: cols[3] || '',
            pcie_gen: safeInt(cols[4]),
            pcie_width: safeInt(cols[5]),
        });
    }
    return gpus;
}

// =============================================================================
// NVIDIA: Topology Matrix Parsing (nvidia-smi topo -m)
// =============================================================================

/**
 * Parse the output of `nvidia-smi topo -m` into a structured matrix.
 *
 * The output format is:
 * ```
 *         GPU0  GPU1  GPU2  GPU3  mlx5_0  CPU Affinity  NUMA Affinity
 * GPU0     X    NV12  NV12  NV12  SYS     0-31          0
 * GPU1    NV12   X    NV12  NV12  SYS     0-31          0
 * ...
 * ```
 *
 * Returns the column GPU indices and parsed rows.
 */
function parseNvidiaTopoMatrix(output: string): {
    columnGpuIndices: number[];
    rows: TopoMatrixRow[];
    numaMap: Map<number, number>;
} {
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    const columnGpuIndices: number[] = [];
    const rows: TopoMatrixRow[] = [];
    const numaMap = new Map<number, number>();

    for (const line of lines) {
        // Header line: detect GPU columns
        const headerMatch = line.match(/^\s+(GPU\d+.*)/);
        if (headerMatch && columnGpuIndices.length === 0) {
            const tokens = headerMatch[1].split(/\s+/);
            for (const tok of tokens) {
                const gpuMatch = tok.match(/^GPU(\d+)$/);
                if (gpuMatch) {
                    columnGpuIndices.push(safeInt(gpuMatch[1]));
                }
            }
            continue;
        }

        // Data row: GPUn  cell cell cell ... CPU_Affinity  NUMA_Affinity
        const rowMatch = line.match(/^GPU(\d+)\s+(.*)/);
        if (rowMatch && columnGpuIndices.length > 0) {
            const gpuIndex = safeInt(rowMatch[1]);
            const rest = rowMatch[2].split(/\s+/);
            const cells: TopoMatrixCell[] = [];

            for (let i = 0; i < columnGpuIndices.length && i < rest.length; i++) {
                cells.push(rest[i]);
            }
            rows.push({ gpu_index: gpuIndex, cells });

            // Try to extract NUMA node from the last column
            // The NUMA Affinity column is typically the last numeric value
            const numaCol = rest[rest.length - 1];
            const numaVal = safeInt(numaCol, -1);
            if (numaVal >= 0) {
                numaMap.set(gpuIndex, numaVal);
            } else {
                numaMap.set(gpuIndex, 0);
            }
        }
    }

    return { columnGpuIndices, rows, numaMap };
}

// =============================================================================
// getNvlinkMatrix()
// =============================================================================

/**
 * Parse `nvidia-smi topo -m` output into a matrix of connection types
 * between GPUs.
 *
 * Returns a map where key is "gpuA-gpuB" (sorted, gpuA < gpuB) and value
 * is the topology connection type string from nvidia-smi (e.g., "NV12",
 * "PHB", "PIX", "SYS", "NODE").
 *
 * Returns null if nvidia-smi is unavailable or no GPUs found.
 */
export function getNvlinkMatrix(): Map<string, string> | null {
    const output = nvidiaSmi(['topo', '-m']);
    if (!output) return null;

    const { columnGpuIndices, rows } = parseNvidiaTopoMatrix(output);
    if (columnGpuIndices.length === 0 || rows.length === 0) return null;

    const matrix = new Map<string, string>();

    for (const row of rows) {
        for (let i = 0; i < row.cells.length && i < columnGpuIndices.length; i++) {
            const cell = row.cells[i];
            const dstGpu = columnGpuIndices[i];

            // Skip self-connections
            if (row.gpu_index === dstGpu) continue;

            // Normalize key so gpuA < gpuB (avoid duplicate entries)
            const a = Math.min(row.gpu_index, dstGpu);
            const b = Math.max(row.gpu_index, dstGpu);
            const key = `${a}-${b}`;

            if (!matrix.has(key)) {
                matrix.set(key, cell);
            }
        }
    }

    return matrix.size > 0 ? matrix : null;
}

// =============================================================================
// getPcieTopology()
// =============================================================================

/**
 * Parse PCIe switch groupings from `nvidia-smi topo -m` output.
 *
 * GPUs sharing a PCIe switch are identified by PIX (same switch) or PXB
 * (traverses switch, same bridge hierarchy) connections in the topo matrix.
 *
 * Returns a map of switch group labels to arrays of GPU indices sharing
 * that PCIe switch, or null if unavailable.
 */
export function getPcieTopology(): Map<string, number[]> | null {
    const output = nvidiaSmi(['topo', '-m']);
    if (!output) return null;

    const { columnGpuIndices, rows } = parseNvidiaTopoMatrix(output);
    if (columnGpuIndices.length === 0 || rows.length === 0) return null;

    // Build an adjacency list for GPUs sharing a PCIe switch (PIX or PXB)
    const adjacency = new Map<number, Set<number>>();
    for (const row of rows) {
        if (!adjacency.has(row.gpu_index)) {
            adjacency.set(row.gpu_index, new Set());
        }
        for (let i = 0; i < row.cells.length && i < columnGpuIndices.length; i++) {
            const cell = row.cells[i];
            const dst = columnGpuIndices[i];
            if (row.gpu_index === dst) continue;
            // PIX = same PCIe switch, PXB = same PCIe bridge hierarchy
            if (cell === 'PIX' || cell === 'PXB') {
                adjacency.get(row.gpu_index)!.add(dst);
                if (!adjacency.has(dst)) adjacency.set(dst, new Set());
                adjacency.get(dst)!.add(row.gpu_index);
            }
        }
    }

    // Find connected components via BFS — each component is a switch group
    const visited = new Set<number>();
    const groups = new Map<string, number[]>();
    let groupCounter = 0;

    for (const gpuIdx of columnGpuIndices) {
        if (visited.has(gpuIdx)) continue;
        visited.add(gpuIdx);

        const neighbors = adjacency.get(gpuIdx);
        if (!neighbors || neighbors.size === 0) continue;

        const component: number[] = [gpuIdx];
        const queue = [...neighbors];
        for (const n of queue) {
            if (visited.has(n)) continue;
            visited.add(n);
            component.push(n);
            const nn = adjacency.get(n);
            if (nn) {
                for (const next of nn) {
                    if (!visited.has(next)) queue.push(next);
                }
            }
        }

        component.sort((a, b) => a - b);
        const label = `pcie_switch_${groupCounter}`;
        groups.set(label, component);
        groupCounter++;
    }

    return groups.size > 0 ? groups : null;
}

// =============================================================================
// AMD Topology Detection
// =============================================================================

/**
 * Query AMD GPU identities using rocm-smi.
 * Falls back to parsing `rocm-smi --showallinfo` output.
 */
function queryAmdGpuIdentities(): Array<{
    index: number;
    name: string;
    uuid: string;
    pci_bus_id: string;
}> {
    // Try rocm-smi --showid --showproductname --showbus --csv
    const output = rocmSmi(['--showid', '--showproductname', '--showbus', '--json']);
    if (!output) {
        // Fallback: parse basic rocm-smi output
        return queryAmdGpuIdentitiesFallback();
    }

    try {
        const data = JSON.parse(output);
        const gpus: Array<{ index: number; name: string; uuid: string; pci_bus_id: string }> = [];

        // rocm-smi JSON output uses "card0", "card1", etc. as keys
        const keys = Object.keys(data).filter(k => k.startsWith('card')).sort();
        for (let i = 0; i < keys.length; i++) {
            const card = data[keys[i]];
            gpus.push({
                index: i,
                name: card['Card series'] || card['Card model'] || `AMD GPU ${i}`,
                uuid: card['Unique ID'] || card['Serial Number'] || '',
                pci_bus_id: card['PCI Bus'] || '',
            });
        }
        return gpus;
    } catch {
        return queryAmdGpuIdentitiesFallback();
    }
}

/** Fallback AMD GPU identity query using line-based parsing. */
function queryAmdGpuIdentitiesFallback(): Array<{
    index: number;
    name: string;
    uuid: string;
    pci_bus_id: string;
}> {
    const output = rocmSmi([]);
    if (!output) return [];

    const gpus: Array<{ index: number; name: string; uuid: string; pci_bus_id: string }> = [];
    // rocm-smi default output lists GPUs with index numbers
    const gpuLines = output.split('\n');
    let idx = 0;
    for (const line of gpuLines) {
        // Look for lines with GPU index like "GPU[0]" or "0  ..."
        const match = line.match(/GPU\[(\d+)\]/) || line.match(/^(\d+)\s+/);
        if (match) {
            gpus.push({
                index: idx,
                name: `AMD GPU ${idx}`,
                uuid: '',
                pci_bus_id: '',
            });
            idx++;
        }
    }
    return gpus;
}

/**
 * Detect AMD xGMI / Infinity Fabric links between GPUs.
 * Uses `rocm-smi --showtopo` for topology information.
 */
function getAmdTopologyLinks(): Array<{
    gpu_a: number;
    gpu_b: number;
    type: 'pcie' | 'nvlink';
    weight: number;
}> {
    const output = rocmSmi(['--showtopo']);
    if (!output) return [];

    const links: Array<{ gpu_a: number; gpu_b: number; type: 'pcie' | 'nvlink'; weight: number }> = [];

    // rocm-smi --showtopo outputs a weight matrix and link type matrix
    // Weight: lower = closer (1 = same node xGMI, 15+ = PCIe, 40+ = cross-socket)
    // Type: XGMI, PCIE, etc.
    const lines = output.split('\n');
    let inWeightSection = false;
    let inTypeSection = false;
    let headerIndices: number[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.includes('Weight')) {
            inWeightSection = true;
            inTypeSection = false;
            headerIndices = [];
            continue;
        }
        if (trimmed.includes('Type') || trimmed.includes('Link')) {
            inTypeSection = true;
            inWeightSection = false;
            headerIndices = [];
            continue;
        }
        if (trimmed.length === 0) {
            inWeightSection = false;
            inTypeSection = false;
            continue;
        }

        // Parse header row for GPU indices
        if ((inWeightSection || inTypeSection) && headerIndices.length === 0) {
            const headerMatch = trimmed.match(/GPU\d+/g);
            if (headerMatch) {
                headerIndices = headerMatch.map(h => safeInt(h.replace('GPU', '')));
                continue;
            }
        }

        // Parse data rows
        if (inTypeSection && headerIndices.length > 0) {
            const rowMatch = trimmed.match(/^GPU(\d+)\s+(.*)/);
            if (rowMatch) {
                const srcGpu = safeInt(rowMatch[1]);
                const cells = rowMatch[2].split(/\s+/);
                for (let i = 0; i < cells.length && i < headerIndices.length; i++) {
                    const dstGpu = headerIndices[i];
                    if (srcGpu >= dstGpu) continue; // avoid duplicates + self
                    const cellVal = cells[i].toUpperCase();
                    if (cellVal === 'XGMI') {
                        links.push({ gpu_a: srcGpu, gpu_b: dstGpu, type: 'nvlink', weight: 1 });
                    } else if (cellVal === 'PCIE') {
                        links.push({ gpu_a: srcGpu, gpu_b: dstGpu, type: 'pcie', weight: 15 });
                    }
                }
            }
        }
    }

    return links;
}

// =============================================================================
// Apple Silicon Topology
// =============================================================================

/**
 * Build topology for Apple Silicon — unified memory architecture.
 * All "GPU cores" share the same memory fabric with zero copy overhead.
 */
function buildAppleSiliconTopology(): GpuTopology {
    // Detect chip name via sysctl
    const chipName = runCmd('sysctl', ['-n', 'machdep.cpu.brand_string']) || 'Apple Silicon';

    // system_profiler can give us GPU core count more reliably
    let gpuCoreName = chipName;
    const spOutput = runCmd('system_profiler', ['SPDisplaysDataType']);
    if (spOutput) {
        const chipMatch = spOutput.match(/Chipset Model:\s*(.+)/);
        if (chipMatch) {
            gpuCoreName = chipMatch[1].trim();
        }
    }

    // Apple Silicon bandwidth: M1 = ~68 GB/s, M1 Max = ~400 GB/s,
    // M2 Ultra = ~800 GB/s, M3 Max = ~400 GB/s, M4 Max = ~546 GB/s
    let memBandwidthGbs = 68; // conservative default
    const chipLower = chipName.toLowerCase();
    if (chipLower.includes('ultra')) memBandwidthGbs = 800;
    else if (chipLower.includes('max')) memBandwidthGbs = 400;
    else if (chipLower.includes('pro')) memBandwidthGbs = 200;
    else if (chipLower.includes('m4')) memBandwidthGbs = 120;
    else if (chipLower.includes('m3')) memBandwidthGbs = 100;
    else if (chipLower.includes('m2')) memBandwidthGbs = 100;

    return {
        gpus: [{
            index: 0,
            name: gpuCoreName,
            uuid: `apple-silicon-${os.hostname()}`,
            pci_bus_id: 'N/A (SoC)',
            numa_node: 0,
        }],
        links: [{
            gpu_a: 0,
            gpu_b: 0,
            type: 'soc',
            bandwidth_gb_s: memBandwidthGbs,
            bidirectional: true,
        }],
        pcie_topology: [{
            gpu_index: 0,
            pcie_gen: 0,
            pcie_width: 0,
        }],
        nvswitch_present: false,
        unified_memory: true,
        total_interconnect_bandwidth_gb_s: memBandwidthGbs,
    };
}

// =============================================================================
// NVIDIA: Full Topology Assembly
// =============================================================================

/**
 * Detect NVLink version by looking at GPU architecture.
 *
 * Uses compute capability or GPU name to infer NVLink generation:
 *   - Pascal (P100) -> NVLink 1
 *   - Volta (V100)  -> NVLink 2
 *   - Ampere (A100) -> NVLink 3
 *   - Hopper (H100) -> NVLink 4
 */
function detectNvlinkVersion(gpuNames: string[]): number | undefined {
    for (const name of gpuNames) {
        const n = name.toUpperCase();
        if (n.includes('H100') || n.includes('H200') || n.includes('GH200') || n.includes('B100') || n.includes('B200')) return 4;
        if (n.includes('A100') || n.includes('A800') || n.includes('A30')) return 3;
        if (n.includes('V100') || n.includes('TITAN V')) return 2;
        if (n.includes('P100') || n.includes('DGX-1')) return 1;
    }
    return undefined;
}

/** Detect NVSwitch presence from the topology matrix. */
function detectNvswitch(topoOutput: string): boolean {
    // NVSwitch typically manifests as NVn connections between ALL GPUs
    // in the matrix, and nvidia-smi may explicitly mention NVSwitch.
    const lower = topoOutput.toLowerCase();
    if (lower.includes('nvswitch')) return true;

    // Heuristic: if every GPU pair has NVLink (NVn) connections,
    // NVSwitch is likely present (DGX/HGX systems).
    const { columnGpuIndices, rows } = parseNvidiaTopoMatrix(topoOutput);
    if (columnGpuIndices.length < 4) return false; // NVSwitch only in 4+ GPU systems

    let nvlinkPairs = 0;
    let totalPairs = 0;
    for (const row of rows) {
        for (let i = 0; i < row.cells.length && i < columnGpuIndices.length; i++) {
            if (row.gpu_index === columnGpuIndices[i]) continue;
            if (row.gpu_index < columnGpuIndices[i]) {
                totalPairs++;
                if (/^NV\d+$/.test(row.cells[i])) nvlinkPairs++;
            }
        }
    }

    // If every pair is NVLink-connected in a 4+ GPU system, NVSwitch is likely
    return totalPairs > 0 && nvlinkPairs === totalPairs && columnGpuIndices.length >= 4;
}

/**
 * Build the full NVIDIA GPU topology structure.
 */
function buildNvidiaTopology(): GpuTopology {
    const identities = queryNvidiaGpuIdentities();
    const topoOutput = nvidiaSmi(['topo', '-m']);
    const pcieGroups = getPcieTopology();

    // Parse NUMA map from topo matrix
    let numaMap = new Map<number, number>();
    if (topoOutput) {
        const parsed = parseNvidiaTopoMatrix(topoOutput);
        numaMap = parsed.numaMap;
    }

    // Build GPU list
    const gpus = identities.map(gpu => ({
        index: gpu.index,
        name: gpu.name,
        uuid: gpu.uuid,
        pci_bus_id: gpu.pci_bus_id,
        numa_node: numaMap.get(gpu.index) ?? 0,
    }));

    // Build PCIe topology
    const pcieTopology = identities.map(gpu => {
        let pcieSwitch: string | undefined;
        if (pcieGroups) {
            for (const [label, gpuIndices] of pcieGroups) {
                if (gpuIndices.includes(gpu.index)) {
                    pcieSwitch = label;
                    break;
                }
            }
        }
        const entry: GpuTopology['pcie_topology'][number] = {
            gpu_index: gpu.index,
            pcie_gen: gpu.pcie_gen,
            pcie_width: gpu.pcie_width,
        };
        if (pcieSwitch !== undefined) {
            entry.pcie_switch = pcieSwitch;
        }
        return entry;
    });

    // Detect NVLink/NVSwitch
    const nvlinkVersion = detectNvlinkVersion(identities.map(g => g.name));
    const nvswitchPresent = topoOutput ? detectNvswitch(topoOutput) : false;
    const bwPerLink = nvlinkVersion ? (NVLINK_BW_PER_LINK[nvlinkVersion] ?? 25) : 25;

    // Build link list from the topology matrix
    const links: GpuTopology['links'] = [];
    let totalInterconnectBw = 0;

    if (topoOutput) {
        const { columnGpuIndices, rows } = parseNvidiaTopoMatrix(topoOutput);

        for (const row of rows) {
            for (let i = 0; i < row.cells.length && i < columnGpuIndices.length; i++) {
                const cell = row.cells[i];
                const dstGpu = columnGpuIndices[i];
                if (row.gpu_index >= dstGpu) continue; // avoid duplicates + self

                const nvMatch = cell.match(/^NV(\d+)$/);
                if (nvMatch) {
                    const numLinks = safeInt(nvMatch[1]);
                    const bandwidth = numLinks * bwPerLink;
                    links.push({
                        gpu_a: row.gpu_index,
                        gpu_b: dstGpu,
                        type: nvswitchPresent ? 'nvswitch' : 'nvlink',
                        bandwidth_gb_s: bandwidth,
                        bidirectional: true,
                    });
                    totalInterconnectBw += bandwidth * 2; // bidirectional
                } else if (cell !== 'X') {
                    // PCIe connection — estimate bandwidth from PCIe gen/width
                    const srcId = identities.find(g => g.index === row.gpu_index);
                    const dstId = identities.find(g => g.index === dstGpu);
                    const gen = Math.min(srcId?.pcie_gen ?? 4, dstId?.pcie_gen ?? 4);
                    const width = Math.min(srcId?.pcie_width ?? 16, dstId?.pcie_width ?? 16);
                    const bw = estimatePcieBandwidth(gen, width);
                    links.push({
                        gpu_a: row.gpu_index,
                        gpu_b: dstGpu,
                        type: 'pcie',
                        bandwidth_gb_s: bw,
                        bidirectional: true,
                    });
                    totalInterconnectBw += bw * 2;
                }
            }
        }
    } else if (identities.length > 1) {
        // No topo matrix available — infer PCIe connections between all GPU pairs
        for (let a = 0; a < identities.length; a++) {
            for (let b = a + 1; b < identities.length; b++) {
                const gen = Math.min(identities[a].pcie_gen, identities[b].pcie_gen);
                const width = Math.min(identities[a].pcie_width, identities[b].pcie_width);
                const bw = estimatePcieBandwidth(gen, width);
                links.push({
                    gpu_a: identities[a].index,
                    gpu_b: identities[b].index,
                    type: 'pcie',
                    bandwidth_gb_s: bw,
                    bidirectional: true,
                });
                totalInterconnectBw += bw * 2;
            }
        }
    }

    const result: GpuTopology = {
        gpus,
        links,
        pcie_topology: pcieTopology,
        nvswitch_present: nvswitchPresent,
        unified_memory: false,
        total_interconnect_bandwidth_gb_s: totalInterconnectBw,
    };

    if (nvlinkVersion !== undefined) {
        result.nvlink_version = nvlinkVersion;
    }

    return result;
}

// =============================================================================
// AMD: Full Topology Assembly
// =============================================================================

/**
 * Build the full AMD GPU topology structure.
 */
function buildAmdTopology(): GpuTopology {
    const identities = queryAmdGpuIdentities();
    const amdLinks = getAmdTopologyLinks();

    const gpus = identities.map(gpu => ({
        index: gpu.index,
        name: gpu.name,
        uuid: gpu.uuid,
        pci_bus_id: gpu.pci_bus_id,
        numa_node: 0, // AMD NUMA detection would require parsing /sys
    }));

    const links: GpuTopology['links'] = [];
    let totalInterconnectBw = 0;

    for (const link of amdLinks) {
        // xGMI (Infinity Fabric) bandwidth: ~92 GB/s per direction (MI250X)
        // PCIe fallback: use gen4 x16 estimate
        const bandwidth = link.type === 'nvlink' ? 92 : 32;
        links.push({
            gpu_a: link.gpu_a,
            gpu_b: link.gpu_b,
            type: link.type === 'nvlink' ? 'nvlink' : 'pcie', // xGMI reported as nvlink equivalent
            bandwidth_gb_s: bandwidth,
            bidirectional: true,
        });
        totalInterconnectBw += bandwidth * 2;
    }

    // If no links were found but we have multiple GPUs, assume PCIe
    if (links.length === 0 && identities.length > 1) {
        for (let a = 0; a < identities.length; a++) {
            for (let b = a + 1; b < identities.length; b++) {
                links.push({
                    gpu_a: identities[a].index,
                    gpu_b: identities[b].index,
                    type: 'pcie',
                    bandwidth_gb_s: 32, // assume PCIe 4.0 x16
                    bidirectional: true,
                });
                totalInterconnectBw += 64;
            }
        }
    }

    const pcieTopology = identities.map(gpu => ({
        gpu_index: gpu.index,
        pcie_gen: 4,   // default assumption for AMD
        pcie_width: 16,
    }));

    return {
        gpus,
        links,
        pcie_topology: pcieTopology,
        nvswitch_present: false,
        unified_memory: false,
        total_interconnect_bandwidth_gb_s: totalInterconnectBw,
    };
}

// =============================================================================
// estimateInterconnectBandwidth()
// =============================================================================

/**
 * Estimate PCIe bandwidth for a given generation and lane width.
 */
function estimatePcieBandwidth(gen: number, width: number): number {
    const x16bw = PCIE_BW_X16[gen] ?? PCIE_BW_X16[4]; // fallback to gen4
    return x16bw * (width / 16);
}

/**
 * Estimate the interconnect bandwidth (GB/s, one direction) between two GPUs
 * based on the detected topology.
 *
 * Returns 0 if the GPUs are not found or not connected.
 */
export function estimateInterconnectBandwidth(
    topology: GpuTopology,
    gpuA: number,
    gpuB: number,
): number {
    if (gpuA === gpuB) {
        // Same GPU — bandwidth is effectively infinite (local memory)
        return Infinity;
    }

    const a = Math.min(gpuA, gpuB);
    const b = Math.max(gpuA, gpuB);

    const link = topology.links.find(
        l => l.gpu_a === a && l.gpu_b === b,
    );

    return link ? link.bandwidth_gb_s : 0;
}

// =============================================================================
// getOptimalGpuPairs()
// =============================================================================

/**
 * Given N GPUs needed, return the best subset of GPU indices that maximizes
 * total interconnect bandwidth.
 *
 * Strategy:
 *   - Prefer NVLink/NVSwitch-connected GPUs over PCIe-connected ones
 *   - For tensor parallelism, all GPUs in the group should ideally be
 *     on the same high-bandwidth fabric
 *   - Falls back to highest-bandwidth pairs when perfect grouping isn't possible
 *
 * Returns the selected GPU indices, or an empty array if fewer than `count`
 * GPUs are available.
 */
export function getOptimalGpuPairs(topology: GpuTopology, count: number): number[] {
    const totalGpus = topology.gpus.length;

    if (count <= 0) return [];
    if (count >= totalGpus) return topology.gpus.map(g => g.index);
    if (count === 1) {
        // Single GPU — just return the first available
        return topology.gpus.length > 0 ? [topology.gpus[0].index] : [];
    }

    const gpuIndices = topology.gpus.map(g => g.index);

    // Score each possible subset of `count` GPUs by total pairwise bandwidth
    // For small GPU counts (<=16), enumerate combinations
    if (totalGpus <= 16 && count <= 8) {
        return findBestSubsetExhaustive(topology, gpuIndices, count);
    }

    // For larger systems, use greedy approach
    return findBestSubsetGreedy(topology, gpuIndices, count);
}

/**
 * Exhaustive search for the best GPU subset (small systems).
 */
function findBestSubsetExhaustive(
    topology: GpuTopology,
    gpuIndices: number[],
    count: number,
): number[] {
    let bestSubset: number[] = [];
    let bestScore = -1;

    function* combinations(arr: number[], k: number, start: number = 0, current: number[] = []): Generator<number[]> {
        if (current.length === k) {
            yield [...current];
            return;
        }
        for (let i = start; i <= arr.length - (k - current.length); i++) {
            current.push(arr[i]);
            yield* combinations(arr, k, i + 1, current);
            current.pop();
        }
    }

    for (const subset of combinations(gpuIndices, count)) {
        const score = scoreSubset(topology, subset);
        if (score > bestScore) {
            bestScore = score;
            bestSubset = subset;
        }
    }

    return bestSubset;
}

/**
 * Greedy search for the best GPU subset (large systems).
 *
 * Start with the GPU pair with highest bandwidth, then greedily add
 * the GPU that maximizes total bandwidth to the existing group.
 */
function findBestSubsetGreedy(
    topology: GpuTopology,
    gpuIndices: number[],
    count: number,
): number[] {
    // Find the highest-bandwidth link to seed the group
    let bestLink: GpuTopology['links'][number] | null = null;
    for (const link of topology.links) {
        if (!bestLink || link.bandwidth_gb_s > bestLink.bandwidth_gb_s) {
            bestLink = link;
        }
    }

    const selected = new Set<number>();
    if (bestLink) {
        selected.add(bestLink.gpu_a);
        selected.add(bestLink.gpu_b);
    } else if (gpuIndices.length > 0) {
        selected.add(gpuIndices[0]);
    }

    while (selected.size < count) {
        let bestCandidate = -1;
        let bestBw = -1;

        for (const idx of gpuIndices) {
            if (selected.has(idx)) continue;

            // Sum bandwidth from this candidate to all already-selected GPUs
            let totalBw = 0;
            for (const sel of selected) {
                totalBw += estimateInterconnectBandwidth(topology, idx, sel);
            }

            if (totalBw > bestBw) {
                bestBw = totalBw;
                bestCandidate = idx;
            }
        }

        if (bestCandidate < 0) break; // no more candidates
        selected.add(bestCandidate);
    }

    return [...selected].sort((a, b) => a - b);
}

/**
 * Score a subset of GPUs by total pairwise interconnect bandwidth.
 * Higher-bandwidth link types get a bonus multiplier to strongly prefer
 * NVLink/NVSwitch over PCIe.
 */
function scoreSubset(topology: GpuTopology, subset: number[]): number {
    let score = 0;
    for (let i = 0; i < subset.length; i++) {
        for (let j = i + 1; j < subset.length; j++) {
            const a = Math.min(subset[i], subset[j]);
            const b = Math.max(subset[i], subset[j]);
            const link = topology.links.find(l => l.gpu_a === a && l.gpu_b === b);
            if (link) {
                // Give NVLink/NVSwitch links a 10x bonus so they are strongly preferred
                const multiplier = (link.type === 'nvlink' || link.type === 'nvswitch') ? 10 : 1;
                score += link.bandwidth_gb_s * multiplier;
            }
        }
    }
    return score;
}

// =============================================================================
// getTopologySummary()
// =============================================================================

/**
 * Generate a human-readable summary of the GPU topology.
 *
 * Examples:
 *   "2x NVIDIA RTX 4090 via PCIe Gen4 x16 (32 GB/s each direction)"
 *   "8x NVIDIA A100 80GB via NVLink 3.0 + NVSwitch (600 GB/s total)"
 *   "Apple M2 Max — unified memory (400 GB/s memory bandwidth)"
 *   "1x NVIDIA RTX 3090 (standalone)"
 */
export function getTopologySummary(topology: GpuTopology): string {
    const gpuCount = topology.gpus.length;

    if (gpuCount === 0) {
        return 'No GPUs detected';
    }

    // Apple Silicon
    if (topology.unified_memory) {
        const gpuName = topology.gpus[0].name;
        const bw = topology.total_interconnect_bandwidth_gb_s;
        return `${gpuName} — unified memory (${bw} GB/s memory bandwidth)`;
    }

    // Collect unique GPU names
    const nameCount = new Map<string, number>();
    for (const gpu of topology.gpus) {
        nameCount.set(gpu.name, (nameCount.get(gpu.name) ?? 0) + 1);
    }

    const gpuDescription = [...nameCount.entries()]
        .map(([name, count]) => `${count}x ${name}`)
        .join(' + ');

    // Single GPU
    if (gpuCount === 1) {
        const pcie = topology.pcie_topology[0];
        if (pcie && pcie.pcie_gen > 0) {
            return `${gpuDescription} (standalone, PCIe Gen${pcie.pcie_gen} x${pcie.pcie_width})`;
        }
        return `${gpuDescription} (standalone)`;
    }

    // Multi-GPU: determine primary interconnect type
    const nvlinkLinks = topology.links.filter(l => l.type === 'nvlink' || l.type === 'nvswitch');
    const pcieLinks = topology.links.filter(l => l.type === 'pcie');

    if (nvlinkLinks.length > 0) {
        const maxBw = Math.max(...nvlinkLinks.map(l => l.bandwidth_gb_s));
        const totalBw = topology.total_interconnect_bandwidth_gb_s;
        const versionStr = topology.nvlink_version ? ` ${topology.nvlink_version}.0` : '';

        if (topology.nvswitch_present) {
            return `${gpuDescription} via NVLink${versionStr} + NVSwitch (${totalBw} GB/s total)`;
        }
        return `${gpuDescription} via NVLink${versionStr} (${maxBw} GB/s per link, ${totalBw} GB/s total)`;
    }

    if (pcieLinks.length > 0) {
        const gen = topology.pcie_topology[0]?.pcie_gen ?? 4;
        const width = topology.pcie_topology[0]?.pcie_width ?? 16;
        const perDirection = PCIE_BW_X16[gen] ? Math.round(PCIE_BW_X16[gen] * (width / 16)) : 32;
        return `${gpuDescription} via PCIe Gen${gen} x${width} (${perDirection} GB/s each direction)`;
    }

    return `${gpuDescription} (interconnect unknown)`;
}

// =============================================================================
// detectGpuTopology()
// =============================================================================

/**
 * Detect the full GPU interconnect topology for the current system.
 *
 * Automatically detects the GPU vendor and uses the appropriate tools:
 *   - NVIDIA: nvidia-smi topo -m, nvidia-smi --query-gpu
 *   - AMD: rocm-smi --showtopo
 *   - Apple Silicon: sysctl + system_profiler
 *
 * Returns the complete GpuTopology structure, or a minimal empty topology
 * if no GPUs are found.
 */
export function detectGpuTopology(): GpuTopology {
    console.log(`${LOG_PREFIX} Detecting GPU topology...`);

    // Check Apple Silicon first (before GPU tools)
    if (isAppleSilicon()) {
        console.log(`${LOG_PREFIX} Apple Silicon detected — unified memory architecture`);
        const topo = buildAppleSiliconTopology();
        console.log(`${LOG_PREFIX} ${getTopologySummary(topo)}`);
        return topo;
    }

    // Try NVIDIA
    if (hasNvidiaSmi()) {
        console.log(`${LOG_PREFIX} NVIDIA driver detected — querying topology via nvidia-smi`);
        const topo = buildNvidiaTopology();
        console.log(`${LOG_PREFIX} ${getTopologySummary(topo)}`);
        return topo;
    }

    // Try AMD
    if (hasRocmSmi()) {
        console.log(`${LOG_PREFIX} AMD ROCm detected — querying topology via rocm-smi`);
        const topo = buildAmdTopology();
        console.log(`${LOG_PREFIX} ${getTopologySummary(topo)}`);
        return topo;
    }

    // No GPUs detected
    console.log(`${LOG_PREFIX} No GPU management tools found (nvidia-smi, rocm-smi)`);
    return {
        gpus: [],
        links: [],
        pcie_topology: [],
        nvswitch_present: false,
        unified_memory: false,
        total_interconnect_bandwidth_gb_s: 0,
    };
}

// =============================================================================
// reportTopologyToGateway()
// =============================================================================

/**
 * POST the detected GPU topology to the TentaCLAW gateway for
 * topology-aware scheduling decisions.
 *
 * Sends a JSON payload to `POST {gatewayUrl}/api/topology`.
 *
 * @param gatewayUrl  The base URL of the gateway (e.g., "http://10.0.0.1:8080")
 * @param topology    The topology to report. If omitted, detects automatically.
 * @returns           True if the gateway accepted the report, false otherwise.
 */
export function reportTopologyToGateway(
    gatewayUrl: string,
    topology?: GpuTopology,
): Promise<boolean> {
    const topo = topology ?? detectGpuTopology();
    const payload = JSON.stringify({
        hostname: os.hostname(),
        timestamp: Date.now(),
        topology: topo,
        summary: getTopologySummary(topo),
    });

    return new Promise((resolve) => {
        const endpoint = `${gatewayUrl}/api/topology`;
        const parsed = new URL(endpoint);
        const transport = parsed.protocol === 'https:' ? https : http;

        const req = transport.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
                timeout: 10_000,
            },
            (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => {
                    const ok = res.statusCode !== undefined
                        && res.statusCode >= 200
                        && res.statusCode < 300;
                    if (ok) {
                        console.log(`${LOG_PREFIX} Topology reported to gateway (${res.statusCode})`);
                    } else {
                        console.error(`${LOG_PREFIX} Gateway rejected topology report: ${res.statusCode} ${body}`);
                    }
                    resolve(ok);
                });
                res.on('error', () => resolve(false));
            },
        );

        req.on('error', (err) => {
            console.error(`${LOG_PREFIX} Failed to report topology to gateway: ${err.message}`);
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy();
            console.error(`${LOG_PREFIX} Topology report timed out`);
            resolve(false);
        });

        req.write(payload);
        req.end();
    });
}
