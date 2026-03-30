/**
 * Windows Native Agent Module
 * CLAWtopus says: "Windows? I've got arms for panes too."
 *
 * Windows-native functionality for TentaCLAW agent nodes running on gaming
 * PCs with NVIDIA GPUs:
 *   - Platform detection
 *   - GPU info via nvidia-smi (with wmic fallback)
 *   - System info (CPU, RAM, disk)
 *   - Windows Service install/uninstall/status
 *   - Power monitoring (GPU via nvidia-smi, CPU TDP estimation)
 *   - Network interface enumeration
 *   - WSL2 detection
 *   - Firewall rule generation
 *   - System tray config generation
 *   - Auto-start (Startup folder) path
 *
 * Zero external dependencies — Windows-only (gracefully returns null/false on
 * other platforms).
 */

import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';

// =============================================================================
// Types
// =============================================================================

export interface WindowsGpuInfo {
    name: string;
    vram_mb: number;
    driver_version: string;
    pci_id: string;
}

export interface WindowsSystemInfo {
    cpu_model: string;
    cpu_cores: number;
    cpu_threads: number;
    ram_total_mb: number;
    ram_available_mb: number;
    disk_total_gb: number;
    disk_free_gb: number;
    os_version: string;
    hostname: string;
}

export interface WindowsPowerInfo {
    gpu_power_w: number | null;
    gpu_power_limit_w: number | null;
    cpu_tdp_estimate_w: number;
    total_estimate_w: number;
}

export interface WindowsNetworkInterface {
    name: string;
    ip: string;
    mac: string;
    family: 'IPv4' | 'IPv6';
    internal: boolean;
}

export interface SystemTrayConfig {
    app_name: string;
    tooltip: string;
    icon: string;
    menu: Array<{
        label: string;
        action: string;
        separator?: boolean;
    }>;
}

// =============================================================================
// Helpers
// =============================================================================

/** Run a command and return trimmed stdout, or null on failure. */
function runCmd(cmd: string, args: string[], timeoutMs: number = 10_000): string | null {
    try {
        return execFileSync(cmd, args, {
            encoding: 'utf-8',
            timeout: timeoutMs,
            windowsHide: true,
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

/** Safe parseFloat with fallback. */
function safeFloat(s: string | null | undefined, fallback: number = 0): number {
    if (s == null) return fallback;
    const v = parseFloat(s);
    return isNaN(v) ? fallback : v;
}

// =============================================================================
// Constants
// =============================================================================

const SERVICE_NAME = 'TentaCLAWAgent';
const SERVICE_DISPLAY_NAME = 'TentaCLAW Agent';
const SERVICE_DESCRIPTION = 'TentaCLAW AI inference cluster agent daemon';

/** Ports that need firewall rules for TentaCLAW operation. */
const FIREWALL_PORTS = [8080, 11434, 41337];

// =============================================================================
// 1. Platform Detection
// =============================================================================

/**
 * Check if running on Windows.
 *
 * Returns true when `process.platform === 'win32'`.
 */
export function isWindows(): boolean {
    return process.platform === 'win32';
}

// =============================================================================
// 2. GPU Info
// =============================================================================

/**
 * Get GPU info via nvidia-smi (primary) or wmic (fallback).
 *
 * nvidia-smi is the preferred source as it provides accurate VRAM, driver
 * version, and PCI bus ID. The wmic fallback provides basic name and VRAM
 * for systems where nvidia-smi is not in PATH.
 *
 * Returns null on non-Windows platforms or if no GPU info can be obtained.
 */
export function getWindowsGpuInfo(): WindowsGpuInfo[] | null {
    if (!isWindows()) return null;

    // Try nvidia-smi first (preferred for NVIDIA GPUs)
    const gpus = getGpuInfoViaNvidiaSmi();
    if (gpus && gpus.length > 0) return gpus;

    // Fallback to wmic
    return getGpuInfoViaWmic();
}

/** Query nvidia-smi for GPU info (CSV format). */
function getGpuInfoViaNvidiaSmi(): WindowsGpuInfo[] | null {
    const output = runCmd('nvidia-smi', [
        '--query-gpu=name,memory.total,driver_version,pci.bus_id',
        '--format=csv,noheader,nounits',
    ]);
    if (!output) return null;

    const gpus: WindowsGpuInfo[] = [];
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
        const cols = line.split(',').map(s => s.trim());
        if (cols.length >= 4) {
            gpus.push({
                name: cols[0] || 'Unknown GPU',
                vram_mb: safeInt(cols[1]),
                driver_version: cols[2] || 'unknown',
                pci_id: cols[3] || 'unknown',
            });
        }
    }

    return gpus.length > 0 ? gpus : null;
}

/** Query PowerShell Get-CimInstance for GPU info as a fallback. */
function getGpuInfoViaWmic(): WindowsGpuInfo[] | null {
    const output = runCmd('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,PNPDeviceID | ConvertTo-Csv -NoTypeInformation',
    ], 15_000);
    if (!output) return null;

    const gpus: WindowsGpuInfo[] = [];
    const lines = output.split('\n').filter(l => l.trim().length > 0);

    // Skip the CSV header line
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // Parse CSV with quoted fields
        const cols = parseCsvLine(line);
        if (cols.length >= 4) {
            const adapterRamBytes = safeFloat(cols[1]);
            gpus.push({
                name: cols[0] || 'Unknown GPU',
                vram_mb: Math.round(adapterRamBytes / (1024 * 1024)),
                driver_version: cols[2] || 'unknown',
                pci_id: cols[3] || 'unknown',
            });
        }
    }

    return gpus.length > 0 ? gpus : null;
}

/** Parse a CSV line handling quoted fields. */
function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++; // skip escaped quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

// =============================================================================
// 3. System Info
// =============================================================================

/**
 * Get Windows system information (CPU, RAM, disk).
 *
 * Uses the Node.js `os` module for CPU and RAM, and PowerShell for disk info
 * and OS version. Returns null on non-Windows platforms.
 */
export function getWindowsSystemInfo(): WindowsSystemInfo | null {
    if (!isWindows()) return null;

    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';
    const cpuCores = countPhysicalCores();
    const cpuThreads = cpus.length;

    const ramTotalMb = Math.round(os.totalmem() / (1024 * 1024));
    const ramAvailableMb = Math.round(os.freemem() / (1024 * 1024));

    // Get disk info for fixed drives
    const { totalGb, freeGb } = getDiskInfo();

    // Get OS version string
    const osVersion = getOsVersionString();

    return {
        cpu_model: cpuModel,
        cpu_cores: cpuCores,
        cpu_threads: cpuThreads,
        ram_total_mb: ramTotalMb,
        ram_available_mb: ramAvailableMb,
        disk_total_gb: totalGb,
        disk_free_gb: freeGb,
        os_version: osVersion,
        hostname: os.hostname(),
    };
}

/** Attempt to get physical core count (as opposed to logical/hyperthreaded). */
function countPhysicalCores(): number {
    const output = runCmd('powershell', [
        '-NoProfile',
        '-Command',
        '(Get-CimInstance Win32_Processor).NumberOfCores',
    ], 10_000);
    if (output) {
        const cores = safeInt(output);
        if (cores > 0) return cores;
    }
    // Fallback: logical processors / 2 (assumes hyperthreading)
    return Math.max(1, Math.floor(os.cpus().length / 2));
}

/** Get fixed-drive disk space via PowerShell. */
function getDiskInfo(): { totalGb: number; freeGb: number } {
    const output = runCmd('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object Size,FreeSpace | ConvertTo-Csv -NoTypeInformation',
    ], 10_000);
    if (!output) return { totalGb: 0, freeGb: 0 };

    const lines = output.split('\n').filter(l => l.trim().length > 0);
    let totalBytes = 0;
    let freeBytes = 0;

    // Sum all fixed drives
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        if (cols.length >= 2) {
            totalBytes += safeFloat(cols[0]);
            freeBytes += safeFloat(cols[1]);
        }
    }

    return {
        totalGb: Math.round(totalBytes / (1024 * 1024 * 1024)),
        freeGb: Math.round(freeBytes / (1024 * 1024 * 1024)),
    };
}

/** Get a human-readable OS version string. */
function getOsVersionString(): string {
    const output = runCmd('powershell', [
        '-NoProfile',
        '-Command',
        '(Get-CimInstance Win32_OperatingSystem).Caption',
    ], 10_000);
    if (output) return output.replace(/"/g, '').trim();
    return `Windows ${os.release()}`;
}

// =============================================================================
// 4. Install as Windows Service
// =============================================================================

/**
 * Generate a PowerShell script to install TentaCLAW as a Windows Service.
 *
 * The generated script uses `New-Service` to create a service named
 * "TentaCLAWAgent" that auto-starts on boot. The script must be run
 * as Administrator.
 *
 * @param executablePath  Path to the TentaCLAW agent executable (node or compiled binary).
 * @param args            Optional command-line arguments for the agent.
 * @returns The PowerShell script as a string, or null on non-Windows.
 */
export function installAsWindowsService(executablePath: string, args: string[] = []): string | null {
    if (!isWindows()) return null;

    const argsStr = args.length > 0 ? ' ' + args.join(' ') : '';
    const binaryPath = `"${executablePath}"${argsStr}`;

    const script = `
# TentaCLAW Agent — Windows Service Installation Script
# Run this script as Administrator

$ServiceName = '${SERVICE_NAME}'
$DisplayName = '${SERVICE_DISPLAY_NAME}'
$Description = '${SERVICE_DESCRIPTION}'
$BinaryPath  = '${binaryPath.replace(/'/g, "''")}'

# Check for Administrator privileges
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

# Remove existing service if present
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Removing existing $ServiceName service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName
    Start-Sleep -Seconds 2
}

# Create the service
Write-Host "Creating service $ServiceName..."
New-Service -Name $ServiceName \`
    -BinaryPathName $BinaryPath \`
    -DisplayName $DisplayName \`
    -Description $Description \`
    -StartupType Automatic

# Configure recovery: restart on first and second failure, reset after 1 day
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000

# Start the service
Write-Host "Starting $ServiceName..."
Start-Service -Name $ServiceName

Write-Host "$ServiceName installed and started successfully." -ForegroundColor Green
`.trim();

    return script;
}

// =============================================================================
// 5. Uninstall Windows Service
// =============================================================================

/**
 * Remove the TentaCLAW Windows Service via sc.exe.
 *
 * Stops the service if running, then deletes it. Returns true if the
 * uninstall command succeeded, false otherwise.
 *
 * Returns false on non-Windows platforms.
 */
export function uninstallWindowsService(): boolean {
    if (!isWindows()) return false;

    try {
        // Stop the service first (ignore errors if already stopped)
        runCmd('sc.exe', ['stop', SERVICE_NAME], 15_000);

        // Delete the service
        const result = runCmd('sc.exe', ['delete', SERVICE_NAME], 15_000);
        if (result !== null) {
            console.log(`[windows] Service ${SERVICE_NAME} removed successfully`);
            return true;
        }
        console.error(`[windows] Failed to delete service ${SERVICE_NAME}`);
        return false;
    } catch (e) {
        console.error(`[windows] Error uninstalling service: ${e}`);
        return false;
    }
}

// =============================================================================
// 6. Service Status
// =============================================================================

/**
 * Check if the TentaCLAW Windows Service is currently running.
 *
 * Queries `sc query` for the service state. Returns true only if the
 * service is in the RUNNING state. Returns false on non-Windows,
 * if the service does not exist, or if it is stopped.
 */
export function isWindowsServiceRunning(): boolean {
    if (!isWindows()) return false;

    const output = runCmd('sc.exe', ['query', SERVICE_NAME], 10_000);
    if (!output) return false;

    // sc query output contains a line like "STATE : 4  RUNNING"
    return /STATE\s*:\s*4\s+RUNNING/i.test(output);
}

// =============================================================================
// 7. Power Info
// =============================================================================

/**
 * Get power information for the Windows system.
 *
 * Reads GPU power draw and power limit from nvidia-smi. Estimates CPU TDP
 * based on the CPU model name (common Intel/AMD desktop and mobile SKUs).
 *
 * Returns null on non-Windows platforms.
 */
export function getWindowsPowerInfo(): WindowsPowerInfo | null {
    if (!isWindows()) return null;

    // GPU power via nvidia-smi
    let gpuPowerW: number | null = null;
    let gpuPowerLimitW: number | null = null;

    const nvOutput = runCmd('nvidia-smi', [
        '--query-gpu=power.draw,power.limit',
        '--format=csv,noheader,nounits',
    ]);
    if (nvOutput) {
        const lines = nvOutput.split('\n').filter(l => l.trim().length > 0);
        let totalDraw = 0;
        let totalLimit = 0;
        for (const line of lines) {
            const cols = line.split(',').map(s => s.trim());
            if (cols.length >= 2) {
                totalDraw += safeFloat(cols[0]);
                totalLimit += safeFloat(cols[1]);
            }
        }
        if (totalDraw > 0) gpuPowerW = Math.round(totalDraw * 100) / 100;
        if (totalLimit > 0) gpuPowerLimitW = Math.round(totalLimit * 100) / 100;
    }

    // CPU TDP estimation based on model name
    const cpuTdp = estimateCpuTdp();

    const totalEstimate = (gpuPowerW ?? 0) + cpuTdp;

    return {
        gpu_power_w: gpuPowerW,
        gpu_power_limit_w: gpuPowerLimitW,
        cpu_tdp_estimate_w: cpuTdp,
        total_estimate_w: Math.round(totalEstimate * 100) / 100,
    };
}

/**
 * Estimate CPU TDP from the model name.
 *
 * This is a rough heuristic based on common Intel and AMD desktop/mobile
 * CPU families. Returns a conservative estimate in watts.
 */
function estimateCpuTdp(): number {
    const cpus = os.cpus();
    if (cpus.length === 0) return 65; // fallback

    const model = cpus[0].model.toLowerCase();

    // Intel Core i9 (desktop)
    if (model.includes('i9-14') || model.includes('i9-13')) return 253;
    if (model.includes('i9-12')) return 241;
    if (model.includes('i9-11')) return 125;
    if (model.includes('i9-10')) return 125;
    if (model.includes('i9')) return 125;

    // Intel Core i7 (desktop)
    if (model.includes('i7-14') || model.includes('i7-13')) return 253;
    if (model.includes('i7-12')) return 180;
    if (model.includes('i7-11')) return 125;
    if (model.includes('i7-10')) return 125;
    if (model.includes('i7')) return 95;

    // Intel Core i5 (desktop)
    if (model.includes('i5-14') || model.includes('i5-13')) return 154;
    if (model.includes('i5-12')) return 117;
    if (model.includes('i5')) return 65;

    // Intel Core i3
    if (model.includes('i3')) return 60;

    // AMD Ryzen 9
    if (model.includes('ryzen 9 7') || model.includes('ryzen 9 9')) return 170;
    if (model.includes('ryzen 9 5')) return 105;
    if (model.includes('ryzen 9')) return 105;

    // AMD Ryzen 7
    if (model.includes('ryzen 7 7') || model.includes('ryzen 7 9')) return 120;
    if (model.includes('ryzen 7 5')) return 105;
    if (model.includes('ryzen 7')) return 95;

    // AMD Ryzen 5
    if (model.includes('ryzen 5 7') || model.includes('ryzen 5 9')) return 105;
    if (model.includes('ryzen 5 5')) return 65;
    if (model.includes('ryzen 5')) return 65;

    // AMD Ryzen 3
    if (model.includes('ryzen 3')) return 65;

    // AMD Threadripper
    if (model.includes('threadripper')) return 280;

    // Intel Xeon
    if (model.includes('xeon')) return 150;

    // Generic fallback based on logical core count
    const threads = cpus.length;
    if (threads >= 32) return 250;
    if (threads >= 16) return 125;
    if (threads >= 8) return 95;
    return 65;
}

// =============================================================================
// 8. Network Interfaces
// =============================================================================

/**
 * List network interfaces with their IP addresses.
 *
 * Returns all network interfaces with IPv4 and IPv6 addresses using the
 * Node.js `os` module. Returns null on non-Windows platforms.
 */
export function getWindowsNetworkInterfaces(): WindowsNetworkInterface[] | null {
    if (!isWindows()) return null;

    const ifaces = os.networkInterfaces();
    const result: WindowsNetworkInterface[] = [];

    for (const [name, addrs] of Object.entries(ifaces)) {
        if (!addrs) continue;
        for (const addr of addrs) {
            result.push({
                name,
                ip: addr.address,
                mac: addr.mac,
                family: addr.family as 'IPv4' | 'IPv6',
                internal: addr.internal,
            });
        }
    }

    return result;
}

// =============================================================================
// 9. WSL2 Detection
// =============================================================================

/**
 * Detect if the current process is running inside WSL2.
 *
 * Checks for the WSL-specific markers:
 *   - /proc/version contains "microsoft" or "WSL"
 *   - WSL_DISTRO_NAME environment variable is set
 *
 * On native Windows (win32), this always returns false since the process
 * is not inside WSL. On Linux, it checks for WSL markers.
 */
export function detectWSL2(): boolean {
    // If we're running as native Windows, we are NOT in WSL
    if (process.platform === 'win32') return false;

    // On Linux, check for WSL markers
    if (process.platform === 'linux') {
        // Check environment variable
        if (process.env.WSL_DISTRO_NAME) return true;

        // Check /proc/version for WSL signature
        try {
            const version = execFileSync('cat', ['/proc/version'], {
                encoding: 'utf-8',
                timeout: 5_000,
            });
            if (/microsoft|wsl/i.test(version)) return true;
        } catch {
            // /proc/version not readable
        }
    }

    return false;
}

// =============================================================================
// 10. Firewall Configuration
// =============================================================================

/**
 * Generate a PowerShell script to add Windows Firewall rules for TentaCLAW.
 *
 * Creates inbound TCP allow rules for:
 *   - Port 8080  (Gateway HTTP API)
 *   - Port 11434 (Ollama API)
 *   - Port 41337 (TentaCLAW discovery / P2P)
 *
 * The script must be run as Administrator.
 *
 * Returns null on non-Windows platforms.
 */
export function configureWindowsFirewall(): string | null {
    if (!isWindows()) return null;

    const rules = FIREWALL_PORTS.map(port => {
        const ruleName = `TentaCLAW-TCP-${port}`;
        return `
# Port ${port}
$ruleName = '${ruleName}'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Rule '$ruleName' already exists, updating..."
    Set-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Enabled True
} else {
    Write-Host "Creating rule '$ruleName'..."
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Enabled True -Profile Any -Description 'TentaCLAW agent communication port'
}`;
    }).join('\n');

    const script = `
# TentaCLAW Agent — Windows Firewall Configuration Script
# Run this script as Administrator

# Check for Administrator privileges
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

Write-Host "Configuring Windows Firewall for TentaCLAW..." -ForegroundColor Cyan
${rules}

Write-Host ""
Write-Host "Firewall rules configured successfully." -ForegroundColor Green
Write-Host "Ports opened: ${FIREWALL_PORTS.join(', ')}"
`.trim();

    return script;
}

// =============================================================================
// 11. System Tray Config
// =============================================================================

/**
 * Generate a JSON configuration for a TentaCLAW system tray application.
 *
 * Returns a structured config object with menu items for common agent
 * operations. This config can be consumed by an Electron, .NET, or native
 * Win32 tray app.
 *
 * Returns null on non-Windows platforms.
 */
export function generateSystemTrayConfig(): SystemTrayConfig | null {
    if (!isWindows()) return null;

    return {
        app_name: 'TentaCLAW Agent',
        tooltip: 'TentaCLAW AI Inference Agent',
        icon: 'tentaclaw-icon.ico',
        menu: [
            { label: 'Open Dashboard', action: 'open_dashboard' },
            { label: 'Status', action: 'show_status' },
            { label: 'GPUs', action: 'show_gpus' },
            { label: 'Logs', action: 'show_logs' },
            { label: 'Settings', action: 'open_settings' },
            { label: '', action: '', separator: true },
            { label: 'Restart Agent', action: 'restart_agent' },
            { label: 'Quit', action: 'quit' },
        ],
    };
}

// =============================================================================
// 12. Windows Startup Path
// =============================================================================

/**
 * Get the path for auto-start on Windows login.
 *
 * Returns the user's Startup folder path where a shortcut or script can
 * be placed to auto-launch the agent on login. This is the
 * `shell:startup` folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`).
 *
 * Returns null on non-Windows platforms.
 */
export function getWindowsStartupPath(): string | null {
    if (!isWindows()) return null;

    const appData = process.env.APPDATA;
    if (!appData) return null;

    return path.join(
        appData,
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        'Startup',
    );
}
