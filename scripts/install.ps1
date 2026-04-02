#Requires -Version 5.1
<#
.SYNOPSIS
    TentaCLAW OS Installer for Windows
.DESCRIPTION
    Installs TentaCLAW OS on Windows systems. Checks prerequisites (Node.js, git),
    clones the repository, installs dependencies, and provides startup instructions.
.PARAMETER InstallDir
    Installation directory. Defaults to $env:USERPROFILE\TentaCLAW
.PARAMETER AgentOnly
    Only install the agent component (skip gateway).
.PARAMETER GatewayOnly
    Only install the gateway component (skip agent).
.PARAMETER Mock
    Start in mock mode after installation (no real GPU/Ollama required).
.PARAMETER WhatIf
    Show what would be done without making changes.
.EXAMPLE
    iwr tentaclaw.io/install.ps1 | iex
.EXAMPLE
    .\install.ps1 -InstallDir "D:\MyCluster\TentaCLAW"
.EXAMPLE
    .\install.ps1 -AgentOnly -Mock
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallDir = "$env:USERPROFILE\TentaCLAW",
    [switch]$AgentOnly,
    [switch]$GatewayOnly,
    [switch]$Mock
)

# --- Brand colors ---
$Teal    = "`e[38;2;0;212;170m"
$Purple  = "`e[38;2;139;92;246m"
$Green   = "`e[38;2;0;255;136m"
$Red     = "`e[38;2;255;70;70m"
$Yellow  = "`e[38;2;255;200;50m"
$Dim     = "`e[2m"
$Bold    = "`e[1m"
$Reset   = "`e[0m"

$ErrorActionPreference = "Stop"

# --- Helper functions ---

function Write-Banner {
    Write-Host ""
    Write-Host "$Teal$Bold"
    Write-Host "        _____ ___ _  _ _____  _    ___ _      ___      __  ___  ___  "
    Write-Host "       |_   _| __| \| |_   _|/_\  / __| |    /_\ \    / / / _ \/ __| "
    Write-Host "         | | | _|| .\` | | | / _ \| (__| |__ / _ \ \/\/ / | (_) \__ \ "
    Write-Host "         |_| |___|_|\_| |_|/_/ \_\\___|____/_/ \_\_/\_/   \___/|___/ "
    Write-Host "$Reset"
    Write-Host ""
    Write-Host "$Purple$Bold          Eight arms. One mind. Zero compromises.$Reset"
    Write-Host ""
    Write-Host "$Dim          TentaCLAW ASCII mascot:$Reset"
    Write-Host "$Teal"
    Write-Host "                      ,--."
    Write-Host "                     {    }"
    Write-Host "                     K,   }"
    Write-Host "                    /  \`~./"
    Write-Host "                   /   /   )"
    Write-Host "                  /   /   /    ___"
    Write-Host "           ~~~~~~/   /   / ~~~(   )~~~"
    Write-Host "          (  (  /   /   /  )   ) ("
    Write-Host "           ) \/   /   / (   ( ) )"
    Write-Host "          (  /   /   /   )   ) ("
    Write-Host "           \/   /   /\  (   ( ) )"
    Write-Host "            `~~~~`~~~`  ~)   ) ("
    Write-Host "                        (  ( )"
    Write-Host "                         ) )"
    Write-Host "                        ( ("
    Write-Host "                         \\"
    Write-Host "$Reset"
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    Write-Host "  $Dim[ ]$Reset $Message"
}

function Write-Success {
    param([string]$Message)
    # Move cursor up one line and overwrite
    Write-Host "`e[1A  $Green[+]$Reset $Message"
}

function Write-Fail {
    param([string]$Message)
    Write-Host "`e[1A  $Red[x]$Reset $Message"
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  $Yellow[!]$Reset $Message"
}

function Write-Info {
    param([string]$Message)
    Write-Host "  $Dim[i]$Reset $Message"
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-NodeVersion {
    try {
        $ver = & node --version 2>$null
        if ($ver -match 'v(\d+)') {
            return [int]$Matches[1]
        }
    } catch {}
    return 0
}

# --- Main installer ---

Write-Banner

# Validate flag combinations
if ($AgentOnly -and $GatewayOnly) {
    Write-Fail "Cannot use -AgentOnly and -GatewayOnly together."
    exit 1
}

Write-Host "  ${Bold}Install directory:$Reset $InstallDir"
if ($AgentOnly)   { Write-Host "  ${Bold}Mode:$Reset Agent only" }
if ($GatewayOnly) { Write-Host "  ${Bold}Mode:$Reset Gateway only" }
if ($Mock)        { Write-Host "  ${Bold}Mock mode:$Reset Enabled" }
Write-Host ""

# --- Step 1: Check Node.js ---
Write-Step "Checking Node.js..."

if (Test-Command "node") {
    $nodeVer = (& node --version 2>$null)
    $nodeMajor = Get-NodeVersion
    if ($nodeMajor -ge 22) {
        Write-Success "Node.js $nodeVer detected"
    } elseif ($nodeMajor -ge 18) {
        Write-Success "Node.js $nodeVer detected"
        Write-Warn "Node.js 22+ is recommended. Current: $nodeVer"
    } else {
        Write-Fail "Node.js $nodeVer is too old (minimum: 18, recommended: 22+)"
        Write-Host ""
        Write-Host "  Install Node.js using one of:"
        Write-Host "    ${Bold}winget:$Reset     winget install OpenJS.NodeJS.LTS"
        Write-Host "    ${Bold}chocolatey:$Reset  choco install nodejs-lts"
        Write-Host "    ${Bold}manual:$Reset      https://nodejs.org/en/download"
        Write-Host ""
        exit 1
    }
} else {
    Write-Fail "Node.js is not installed"
    Write-Host ""
    Write-Host "  Install Node.js (22+ recommended) using one of:"
    Write-Host "    ${Bold}winget:$Reset     winget install OpenJS.NodeJS.LTS"
    Write-Host "    ${Bold}chocolatey:$Reset  choco install nodejs-lts"
    Write-Host "    ${Bold}fnm:$Reset         winget install Schniz.fnm && fnm install 22"
    Write-Host "    ${Bold}manual:$Reset      https://nodejs.org/en/download"
    Write-Host ""
    exit 1
}

# --- Step 2: Check git ---
Write-Step "Checking git..."

if (Test-Command "git") {
    $gitVer = (& git --version 2>$null)
    Write-Success "git detected ($gitVer)"
} else {
    Write-Fail "git is not installed"
    Write-Host ""
    Write-Host "  Install git using one of:"
    Write-Host "    ${Bold}winget:$Reset     winget install Git.Git"
    Write-Host "    ${Bold}chocolatey:$Reset  choco install git"
    Write-Host "    ${Bold}manual:$Reset      https://git-scm.com/download/win"
    Write-Host ""
    exit 1
}

# --- Step 3: Check npm ---
Write-Step "Checking npm..."

if (Test-Command "npm") {
    $npmVer = (& npm --version 2>$null)
    Write-Success "npm $npmVer detected"
} else {
    Write-Fail "npm is not available (should come with Node.js)"
    Write-Host "  Try reinstalling Node.js."
    exit 1
}

# --- Step 4: Clone or update repository ---
Write-Step "Setting up TentaCLAW OS..."

$RepoUrl = "https://github.com/TentaCLAW-OS/TentaCLAW.git"

if ($PSCmdlet.ShouldProcess($InstallDir, "Clone/update TentaCLAW repository")) {
    if (Test-Path (Join-Path $InstallDir ".git")) {
        # Existing installation -- pull latest
        Write-Info "Existing installation found. Pulling latest..."
        Push-Location $InstallDir
        try {
            & git pull --ff-only 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "git pull failed. Continuing with existing version."
            }
        } finally {
            Pop-Location
        }
        Write-Success "TentaCLAW OS updated at $InstallDir"
    } else {
        # Fresh clone
        $parentDir = Split-Path $InstallDir -Parent
        if (-not (Test-Path $parentDir)) {
            New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
        }
        try {
            & git clone --depth 1 $RepoUrl $InstallDir 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "git clone failed"
            }
            Write-Success "TentaCLAW OS cloned to $InstallDir"
        } catch {
            Write-Fail "Failed to clone repository"
            Write-Host "  $Red$($_.Exception.Message)$Reset"
            Write-Host ""
            Write-Host "  You can clone manually:"
            Write-Host "    git clone $RepoUrl `"$InstallDir`""
            Write-Host ""
            exit 1
        }
    }
} else {
    Write-Info "Would clone $RepoUrl to $InstallDir"
}

# --- Step 5: Install gateway dependencies ---
if (-not $AgentOnly) {
    Write-Step "Installing gateway dependencies..."

    $gatewayDir = Join-Path $InstallDir "gateway"
    if ($PSCmdlet.ShouldProcess($gatewayDir, "npm install")) {
        if (Test-Path (Join-Path $gatewayDir "package.json")) {
            Push-Location $gatewayDir
            try {
                & npm install --production 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    throw "npm install failed in gateway"
                }
                Write-Success "Gateway dependencies installed"
            } catch {
                Write-Fail "Failed to install gateway dependencies"
                Write-Host "  $Red$($_.Exception.Message)$Reset"
                Write-Host "  Try manually: cd `"$gatewayDir`" && npm install"
                exit 1
            } finally {
                Pop-Location
            }
        } else {
            Write-Fail "Gateway package.json not found at $gatewayDir"
            Write-Host "  The repository may be incomplete. Try re-cloning."
            exit 1
        }
    } else {
        Write-Info "Would run npm install in $gatewayDir"
    }
}

# --- Step 6: Install agent dependencies ---
if (-not $GatewayOnly) {
    Write-Step "Installing agent dependencies..."

    $agentDir = Join-Path $InstallDir "agent"
    if ($PSCmdlet.ShouldProcess($agentDir, "npm install")) {
        if (Test-Path (Join-Path $agentDir "package.json")) {
            Push-Location $agentDir
            try {
                & npm install --production 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    throw "npm install failed in agent"
                }
                Write-Success "Agent dependencies installed"
            } catch {
                Write-Fail "Failed to install agent dependencies"
                Write-Host "  $Red$($_.Exception.Message)$Reset"
                Write-Host "  Try manually: cd `"$agentDir`" && npm install"
                exit 1
            } finally {
                Pop-Location
            }
        } else {
            Write-Fail "Agent package.json not found at $agentDir"
            Write-Host "  The repository may be incomplete. Try re-cloning."
            exit 1
        }
    } else {
        Write-Info "Would run npm install in $agentDir"
    }
}

# --- Step 7: Detect GPU (informational) ---
Write-Step "Detecting GPU hardware..."

$gpuInfo = @()
try {
    $gpus = Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue
    foreach ($gpu in $gpus) {
        if ($gpu.Name -match "NVIDIA|AMD|Radeon|GeForce|RTX|GTX|RX") {
            $gpuInfo += $gpu.Name
        }
    }
} catch {}

if ($gpuInfo.Count -gt 0) {
    $gpuList = $gpuInfo -join ", "
    Write-Success "$($gpuInfo.Count) GPU(s) detected: $gpuList"
} else {
    Write-Success "No dedicated GPU detected (CPU inference available)"
}

# --- Step 8: Check for Ollama (optional) ---
Write-Step "Checking Ollama..."

if (Test-Command "ollama") {
    $ollamaVer = & ollama --version 2>$null
    Write-Success "Ollama detected ($ollamaVer)"
} else {
    Write-Success "Ollama not found (optional - needed for local inference)"
    Write-Info "Install Ollama: https://ollama.com/download/windows"
}

# --- Done! ---
Write-Host ""
Write-Host "$Teal$Bold  ========================================$Reset"
Write-Host "$Teal$Bold   TentaCLAW OS installed successfully!$Reset"
Write-Host "$Teal$Bold  ========================================$Reset"
Write-Host ""
Write-Host "  ${Bold}Location:$Reset    $InstallDir"
Write-Host ""

if (-not $AgentOnly) {
    Write-Host "  ${Bold}Start the gateway:$Reset"
    Write-Host "    cd `"$InstallDir\gateway`""
    Write-Host "    npm run dev"
    Write-Host ""
    Write-Host "  ${Bold}Dashboard:$Reset   http://localhost:8080/dashboard/"
    Write-Host "  ${Bold}API:$Reset         http://localhost:8080/api/v1"
    Write-Host ""
}

if (-not $GatewayOnly) {
    Write-Host "  ${Bold}Start the agent:$Reset"
    if ($Mock) {
        Write-Host "    cd `"$InstallDir\agent`""
        Write-Host "    `$env:TENTACLAW_MOCK='true'; npm run dev"
    } else {
        Write-Host "    cd `"$InstallDir\agent`""
        Write-Host "    npm run dev"
    }
    Write-Host ""
}

Write-Host "  ${Dim}Documentation: https://tentaclaw.io/docs$Reset"
Write-Host "  ${Dim}GitHub:        https://github.com/TentaCLAW-OS/TentaCLAW$Reset"
Write-Host ""

# --- Auto-start in mock mode if requested ---
if ($Mock -and -not $WhatIfPreference) {
    Write-Host "$Purple$Bold  Starting in mock mode...$Reset"
    Write-Host ""

    if (-not $AgentOnly) {
        $env:TENTACLAW_MOCK = "true"
        Push-Location (Join-Path $InstallDir "gateway")
        Write-Host "  Starting gateway (mock mode)..."
        Write-Host "  Press Ctrl+C to stop."
        Write-Host ""
        & npm run dev
        Pop-Location
    } elseif (-not $GatewayOnly) {
        $env:TENTACLAW_MOCK = "true"
        Push-Location (Join-Path $InstallDir "agent")
        Write-Host "  Starting agent (mock mode)..."
        Write-Host "  Press Ctrl+C to stop."
        Write-Host ""
        & npm run dev
        Pop-Location
    }
}
