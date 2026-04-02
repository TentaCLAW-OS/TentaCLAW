/**
 * BitNet CPU Inference Backend Manager
 *
 * Manages Microsoft's BitNet 1-bit inference engine for CPU-only nodes.
 * BitNet runs 2-6x faster than FP16 on CPUs and uses ~70% less energy.
 *
 * TentaCLAW says: "No GPU? No problem. I've got CPUs for that."
 */

import * as fs from 'fs';
import * as os from 'os';
import { execSync, execFileSync } from 'child_process';

// =============================================================================
// Constants
// =============================================================================

/** Paths where BitNet binaries may be installed */
const BITNET_BINARY_PATHS = [
    '/opt/bitnet/build/bin/run_inference',
    '/usr/local/bin/bitnet-server',
    '/opt/tentaclaw/bitnet/run_inference',
] as const;

/** Default port for the BitNet llama.cpp-compatible server */
const BITNET_PORT = 8082;

/** Default install directory when building from source */
const BITNET_INSTALL_DIR = '/opt/bitnet';

/** Health check endpoint */
const BITNET_HEALTH_URL = `http://localhost:${BITNET_PORT}/health`;

/** Available BitNet models */
export const BITNET_MODELS = [
    { name: 'bitnet-b1.58-2B', size_mb: 400, description: '2B param 1-bit model' },
    { name: 'bitnet-b1.58-8B', size_mb: 1500, description: '8B param 1-bit model' },
] as const;

// =============================================================================
// Detection
// =============================================================================

/**
 * Check if BitNet is installed.
 * Checks all known binary paths for a BitNet executable.
 */
export function isBitNetInstalled(): boolean {
    return BITNET_BINARY_PATHS.some((p) => fs.existsSync(p));
}

/**
 * Get the BitNet binary path (first found).
 * Returns null if no binary is found at any known path.
 */
export function getBitNetPath(): string | null {
    for (const p of BITNET_BINARY_PATHS) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

// =============================================================================
// Status
// =============================================================================

/**
 * Check if the BitNet server is running on its default port.
 * Sends a health-check request with a 2-second timeout.
 */
export function isBitNetRunning(): boolean {
    try {
        const output = execFileSync('curl', ['-s', '--max-time', '2', BITNET_HEALTH_URL], {
            encoding: 'utf-8',
            timeout: 5000,
        });
        return output.length > 0;
    } catch {
        return false;
    }
}

/**
 * Get comprehensive BitNet server status.
 */
export function getBitNetStatus(): {
    installed: boolean;
    running: boolean;
    port: number;
    model: string | null;
    binaryPath: string | null;
} {
    const installed = isBitNetInstalled();
    const binaryPath = getBitNetPath();
    const running = installed ? isBitNetRunning() : false;

    let model: string | null = null;
    if (running) {
        // Try to extract the loaded model from the health endpoint
        try {
            const output = execFileSync('curl', ['-s', '--max-time', '2', BITNET_HEALTH_URL], {
                encoding: 'utf-8',
                timeout: 5000,
            });
            const parsed = JSON.parse(output);
            if (parsed && typeof parsed.model === 'string') {
                model = parsed.model;
            }
        } catch {
            // Health returned data but model field absent or unparseable — not fatal
        }

        // Fallback: if health didn't report a model, default to the base model name
        if (!model) {
            model = 'bitnet-b1.58';
        }
    }

    return { installed, running, port: BITNET_PORT, model, binaryPath };
}

// =============================================================================
// Resource Helpers
// =============================================================================

/**
 * Get the optimal thread count for BitNet inference.
 * Reserves 2 cores for the OS / other services, minimum 1 thread.
 */
export function getOptimalThreads(): number {
    const cpuCount = os.cpus().length;
    return Math.max(1, cpuCount - 2);
}

// =============================================================================
// Install
// =============================================================================

// Note: installBitNet uses execSync with shell features (pipes, &&, nohup)
// for build tooling commands. All arguments are hardcoded constants, not
// user-supplied input, so shell injection is not a concern here. This matches
// the pattern used in index.ts for system-level operations.

/**
 * Install BitNet from source (downloads and builds).
 *
 * Steps:
 *   1. git clone https://github.com/Microsoft/BitNet into /opt/bitnet
 *   2. pip install -r requirements.txt
 *   3. python setup_env.py --hf-repo 1bitLLM/bitnet_b1_58-3B -q i2_s
 *
 * Returns the install path on success, null on failure.
 */
export function installBitNet(): string | null {
    const repoUrl = 'https://github.com/Microsoft/BitNet.git';

    try {
        // Create parent directory if it doesn't exist
        if (!fs.existsSync('/opt')) {
            fs.mkdirSync('/opt', { recursive: true });
        }

        // Clone repository (skip if directory already exists with a .git folder)
        if (!fs.existsSync(`${BITNET_INSTALL_DIR}/.git`)) {
            console.log('[bitnet] Cloning Microsoft/BitNet...');
            execFileSync('git', ['clone', repoUrl, BITNET_INSTALL_DIR], {
                stdio: 'inherit',
                timeout: 300000, // 5 min for clone
            });
        } else {
            console.log('[bitnet] Repository already cloned, pulling latest...');
            execFileSync('git', ['pull'], {
                cwd: BITNET_INSTALL_DIR,
                stdio: 'inherit',
                timeout: 60000,
            });
        }

        // Install Python dependencies
        console.log('[bitnet] Installing Python requirements...');
        execFileSync('pip', ['install', '-r', 'requirements.txt'], {
            cwd: BITNET_INSTALL_DIR,
            stdio: 'inherit',
            timeout: 300000, // 5 min for pip
        });

        // Run the setup environment script (builds llama.cpp with BitNet kernels)
        console.log('[bitnet] Building inference engine (this may take several minutes)...');
        execFileSync('python', ['setup_env.py', '--hf-repo', '1bitLLM/bitnet_b1_58-3B', '-q', 'i2_s'], {
            cwd: BITNET_INSTALL_DIR,
            stdio: 'inherit',
            timeout: 600000, // 10 min for build
        });

        // Verify the binary was produced
        const binaryPath = `${BITNET_INSTALL_DIR}/build/bin/run_inference`;
        if (fs.existsSync(binaryPath)) {
            console.log(`[bitnet] Install successful — binary at ${binaryPath}`);
            return binaryPath;
        }

        console.error('[bitnet] Build completed but binary not found at expected path');
        return null;
    } catch (err) {
        console.error('[bitnet] Install failed:', err instanceof Error ? err.message : String(err));
        return null;
    }
}

// =============================================================================
// Server Lifecycle
// =============================================================================

/**
 * Start the BitNet server.
 *
 * @param model  - Model name to load (default: first from BITNET_MODELS)
 * @param threads - Number of threads (default: auto-detected via getOptimalThreads)
 * @returns true if the server was started (or was already running), false on failure
 */
export function startBitNetServer(model?: string, threads?: number): boolean {
    // Already running? Nothing to do.
    if (isBitNetRunning()) {
        console.log('[bitnet] Server already running on port ' + BITNET_PORT);
        return true;
    }

    const binaryPath = getBitNetPath();
    if (!binaryPath) {
        console.error('[bitnet] Cannot start — no BitNet binary found. Run installBitNet() first.');
        return false;
    }

    const threadCount = threads ?? getOptimalThreads();
    const modelName = model ?? BITNET_MODELS[0].name;

    try {
        // Start as a detached background process so it outlives the calling script.
        // We use execSync here because we need shell features (nohup, &, redirection).
        // All arguments are from trusted sources (function params or constants).
        console.log(`[bitnet] Starting server — model=${modelName}, threads=${threadCount}, port=${BITNET_PORT}`);
        execSync(
            `nohup "${binaryPath}" ` +
            `--model "${modelName}" ` +
            `--threads ${threadCount} ` +
            `--port ${BITNET_PORT} ` +
            `> /var/log/bitnet-server.log 2>&1 &`,
            { timeout: 10000 }
        );

        // Give the server a moment to bind the port, then verify
        execFileSync('sleep', ['2']);
        if (isBitNetRunning()) {
            console.log('[bitnet] Server started successfully');
            return true;
        }

        console.error('[bitnet] Server process launched but health check failed');
        return false;
    } catch (err) {
        console.error('[bitnet] Failed to start server:', err instanceof Error ? err.message : String(err));
        return false;
    }
}

/**
 * Stop the BitNet server.
 *
 * Finds the process listening on the BitNet port and sends SIGTERM.
 * @returns true if the server was stopped (or wasn't running), false on failure
 */
export function stopBitNetServer(): boolean {
    if (!isBitNetRunning()) {
        console.log('[bitnet] Server is not running');
        return true;
    }

    try {
        // Find the PID of the process bound to the BitNet port
        const lsofOutput = execFileSync('lsof', ['-ti', `:${BITNET_PORT}`], {
            encoding: 'utf-8',
            timeout: 5000,
        }).trim();

        if (lsofOutput) {
            const pids = lsofOutput.split('\n').map((p) => p.trim()).filter(Boolean);
            for (const pid of pids) {
                console.log(`[bitnet] Sending SIGTERM to PID ${pid}`);
                execFileSync('kill', [pid], { timeout: 5000 });
            }

            // Verify it's actually stopped
            execFileSync('sleep', ['1']);
            if (!isBitNetRunning()) {
                console.log('[bitnet] Server stopped successfully');
                return true;
            }

            // Force kill if still alive
            console.log('[bitnet] Server still running, sending SIGKILL...');
            for (const pid of pids) {
                try {
                    execFileSync('kill', ['-9', pid], { timeout: 5000 });
                } catch {
                    // Process may already be gone
                }
            }
            return !isBitNetRunning();
        }

        console.error('[bitnet] Could not find process on port ' + BITNET_PORT);
        return false;
    } catch (err) {
        console.error('[bitnet] Failed to stop server:', err instanceof Error ? err.message : String(err));
        return false;
    }
}
