<#
.SYNOPSIS
    TentaCLAW CLI Installer for Windows
.DESCRIPTION
    One-line install for the TentaCLAW AI coding assistant.
    Checks prerequisites (Node.js >= 20, git), clones the repo,
    builds the CLI, creates a global 'tentaclaw' command, and
    optionally runs the interactive setup wizard.

    Usage:
      irm https://tentaclaw.io/install.ps1 | iex

    Or download and run:
      .\install-cli.ps1
      .\install-cli.ps1 -InstallDir "D:\TentaCLAW" -SkipSetup
#>

# --- Config ---
$InstallDir = "$env:USERPROFILE\.tentaclaw\src"
$Branch     = "master"
$RepoUrl    = "https://github.com/TentaCLAW-OS/tentaclaw-os.git"
$ErrorActionPreference = "Stop"

# --- Colors (PS 5.1 compatible) ---
$ESC = [char]27
if ($Host.UI.SupportsVirtualTerminal -or $PSVersionTable.PSVersion.Major -ge 7) {
    $T = "$ESC[38;2;0;212;170m"    # Teal
    $P = "$ESC[38;2;139;92;246m"   # Purple
    $G = "$ESC[38;2;0;255;136m"    # Green
    $R = "$ESC[38;2;255;70;70m"    # Red
    $Y = "$ESC[38;2;255;220;0m"    # Yellow
    $D = "$ESC[2m"                 # Dim
    $B = "$ESC[1m"                 # Bold
    $X = "$ESC[0m"                 # Reset
} else {
    $T=""; $P=""; $G=""; $R=""; $Y=""; $D=""; $B=""; $X=""
}

function Show-Banner {
    Write-Host ""
    Write-Host -NoNewline "${T}"
    Write-Host @'
  ████████╗███████╗███╗   ██╗████████╗ █████╗  ██████╗██╗      █████╗ ██╗    ██╗
     ██╔══╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔════╝██║     ██╔══██╗██║    ██║
     ██║   █████╗  ██╔██╗ ██║   ██║   ███████║██║     ██║     ███████║██║ █╗ ██║
     ██║   ██╔══╝  ██║╚██╗██║   ██║   ██╔══██║██║     ██║     ██╔══██║██║███╗██║
     ██║   ███████╗██║ ╚████║   ██║   ██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝
     ╚═╝   ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
'@
    Write-Host "${D}  Distributed AI Inference Cluster Management${X}"
    Write-Host ""
    Write-Host -NoNewline "${T}"
    Write-Host @'
                          ___
                       .-'   `'.
                      /         \
                      |         ;
                      |         |           ___.--,
             _.._     |0) ~ (0) |    _.---'`__.-( (_.
      __.--'`_.. '.__.\.    '--. \_.-' ,.--'`     `""`
     ( ,.--'`   ',__/|)  `-. '.  `.   /   _
     _`) )  .---.__.' /   `. `. \_  `-'  /`.)
    `)_')  /        /     `.  `\  \ `'  /
     `'''  |  _    |       `. `. `.  /`
            ;  \   '.        `. `. `./
             \  '.   \         `. `.  `-._     _
              '.  `'. `.         `-. `.    `.__/
                `'.  `\ `.         `.  `-.
                   `'  \ `;          `-._`.
                        ` \               `'
'@
    Write-Host "${X}"
    Write-Host "  ${P}${B}CLI Installer for Windows${X} ${D}-- Eight arms. One mind.${X}"
    Write-Host ""
}

function Show-Info($msg)  { Write-Host "  ${G}[OK]${X} $msg" }
function Show-Warn($msg)  { Write-Host "  ${Y}[!!]${X} $msg" }
function Show-Fail($msg)  { Write-Host "  ${R}[XX]${X} $msg"; Write-Host ""; exit 1 }
function Show-Step($msg)  { Write-Host "  ${T}[>>]${X} $msg" }

# ═══════════════════════════════════════════════════════════
# Prerequisites
# ═══════════════════════════════════════════════════════════

function Ensure-Git {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        $gitVer = (git --version 2>$null) -replace '[^0-9.]',''
        Show-Info "git $gitVer"
        return
    }

    Show-Step "git not found. Installing via winget..."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Show-Fail "git is required. Install from https://git-scm.com/download/win"
    }

    winget install Git.Git --accept-source-agreements --accept-package-agreements --silent 2>$null | Out-Null
    Refresh-Path
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        Show-Fail "git installation failed. Install manually from https://git-scm.com"
    }
    Show-Info "git installed"
}

function Ensure-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        $ver = [int]((node -v) -replace '^v(\d+).*','$1')
        if ($ver -ge 20) {
            Show-Info "Node.js $(node -v)"
            return
        }
        Show-Warn "Node.js v$ver too old (need >= 20). Upgrading..."
    } else {
        Show-Step "Node.js not found. Installing..."
    }

    # Try winget
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Show-Step "Installing Node.js LTS via winget..."
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent 2>$null | Out-Null
        Refresh-Path
        $node = Get-Command node -ErrorAction SilentlyContinue
        if ($node) {
            Show-Info "Node.js $(node -v) installed"
            return
        }
    }

    # Fallback: MSI download
    Show-Step "Downloading Node.js 22 installer..."
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $msiUrl = "https://nodejs.org/dist/v22.16.0/node-v22.16.0-$arch.msi"
    $msiPath = Join-Path $env:TEMP "node-v22-installer.msi"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
    } catch {
        Show-Fail "Download failed. Install Node.js manually from https://nodejs.org"
    }

    Show-Step "Running Node.js installer..."
    $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -PassThru -NoNewWindow
    Remove-Item $msiPath -ErrorAction SilentlyContinue
    Refresh-Path

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Show-Fail "Node.js installation failed. Install manually from https://nodejs.org"
    }
    Show-Info "Node.js $(node -v) installed"
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    $userPath    = [Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH    = "$machinePath;$userPath"
}

# ═══════════════════════════════════════════════════════════
# Install
# ═══════════════════════════════════════════════════════════

function Install-Repo {
    if (Test-Path (Join-Path $InstallDir ".git")) {
        Show-Step "Updating existing installation..."
        Push-Location $InstallDir
        try {
            git fetch origin $Branch --quiet 2>$null
            git checkout $Branch --quiet 2>$null
            git reset --hard "origin/$Branch" --quiet 2>$null
        } catch {
            Show-Warn "git update failed, continuing with existing code"
        }
        Pop-Location
        Show-Info "Updated to latest $Branch"
    } else {
        Show-Step "Cloning TentaCLAW OS (this may take a minute)..."
        $parent = Split-Path $InstallDir -Parent
        if (-not (Test-Path $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        try {
            git clone --branch $Branch --depth 1 $RepoUrl $InstallDir --quiet 2>$null
        } catch {
            Show-Fail "Clone failed. Check your internet connection and try again."
        }
        Show-Info "Cloned to $InstallDir"
    }
}

function Build-TentaCLAW {
    Push-Location $InstallDir

    Show-Step "Installing dependencies (npm install)..."
    $npmOut = npm install --no-audit --no-fund --loglevel=error 2>&1
    if ($LASTEXITCODE -ne 0) {
        Show-Warn "npm install had warnings (continuing)"
    }
    Show-Info "Dependencies installed"

    Show-Step "Building CLI (npm run build)..."
    $buildOut = npm run build --workspace=cli 2>&1
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Show-Fail "CLI build failed:`n$buildOut"
    }
    Show-Info "CLI built successfully"

    Pop-Location
}

function Install-GlobalCommand {
    Show-Step "Creating global 'tentaclaw' command..."

    $entryJs = Join-Path $InstallDir "cli\dist\cli\src\index.js"
    if (-not (Test-Path $entryJs)) {
        Show-Fail "Build output not found at $entryJs"
    }

    # Find npm global prefix
    $npmPrefix = (npm prefix -g).Trim()

    # Create .cmd wrapper (works in cmd.exe and PowerShell)
    $cmdPath = Join-Path $npmPrefix "tentaclaw.cmd"
    $cmdBody = "@echo off`r`nnode `"$entryJs`" %*"
    Set-Content -Path $cmdPath -Value $cmdBody -Encoding ASCII -Force

    # Create .ps1 wrapper (preferred in PowerShell)
    $ps1Path = Join-Path $npmPrefix "tentaclaw.ps1"
    $ps1Body = @"
#!/usr/bin/env pwsh
& node "$entryJs" `$args
exit `$LASTEXITCODE
"@
    Set-Content -Path $ps1Path -Value $ps1Body -Encoding UTF8 -Force

    # Ensure npm prefix is in PATH
    $inPath = $env:PATH -split ';' | Where-Object { $_.TrimEnd('\') -eq $npmPrefix.TrimEnd('\') }
    if (-not $inPath) {
        Show-Step "Adding npm global bin to PATH..."
        $currentUser = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($currentUser -notmatch [regex]::Escape($npmPrefix)) {
            [Environment]::SetEnvironmentVariable("PATH", "$currentUser;$npmPrefix", "User")
            $env:PATH = "$env:PATH;$npmPrefix"
            Show-Info "Added $npmPrefix to user PATH"
        }
    }

    Show-Info "'tentaclaw' command installed"
    Write-Host "    ${D}CMD:  $cmdPath${X}"
    Write-Host "    ${D}PS1:  $ps1Path${X}"
}

# ═══════════════════════════════════════════════════════════
# Post-install
# ═══════════════════════════════════════════════════════════

function Test-Ollama {
    foreach ($port in @(11434, 11435)) {
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:${port}/api/tags" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($resp.StatusCode -eq 200) {
                return $port
            }
        } catch { }
    }
    return 0
}

function Show-PostInstall {
    Write-Host ""

    # Verify the command works
    $tc = Get-Command tentaclaw -ErrorAction SilentlyContinue
    if ($tc) {
        Show-Info "Verification: tentaclaw command found"
        $versionOut = tentaclaw --version 2>&1 | Out-String
        if ($versionOut -match "v\d+\.\d+\.\d+") {
            Show-Info "Version: $($Matches[0])"
        }
    } else {
        Show-Warn "tentaclaw not in PATH yet. Restart your terminal, then run: tentaclaw --version"
    }

    Write-Host ""

    # Detect Ollama
    $ollamaPort = Test-Ollama
    if ($ollamaPort -gt 0) {
        Show-Info "Ollama detected on port $ollamaPort"
        Write-Host ""
        Write-Host "  ${T}${B}Get started:${X}"
        Write-Host "    ${G}tentaclaw setup${X}         ${D}# configure your model provider${X}"
        Write-Host "    ${G}tentaclaw code${X}          ${D}# start the AI coding agent${X}"
        Write-Host "    ${G}tentaclaw chat${X}          ${D}# simple chat with your model${X}"
    } else {
        Write-Host "  ${Y}${B}Next steps:${X}"
        Write-Host ""
        Write-Host "    ${G}1.${X} Install Ollama       ${D}https://ollama.com/download${X}"
        Write-Host "    ${G}2.${X} Pull a model         ${D}ollama pull llama3.1:8b${X}"
        Write-Host "    ${G}3.${X} Configure            ${D}tentaclaw setup${X}"
        Write-Host "    ${G}4.${X} Start coding         ${D}tentaclaw code${X}"
        Write-Host ""
        Write-Host "  ${D}Or use an API provider (OpenAI, OpenRouter):${X}"
        Write-Host "    ${G}tentaclaw setup${X}         ${D}# select provider and enter API key${X}"
    }

    Write-Host ""
    Write-Host "  ${D}Other commands:${X}"
    Write-Host "    ${G}tentaclaw models${X}       ${D}# list available models${X}"
    Write-Host "    ${G}tentaclaw doctor${X}       ${D}# health check${X}"
    Write-Host "    ${G}tentaclaw help${X}         ${D}# full command reference${X}"
    Write-Host ""
}

# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════

Show-Banner

$startTime = Get-Date

Write-Host "  ${T}${B}Checking prerequisites...${X}"
Write-Host ""
Ensure-Git
Ensure-Node
Write-Host ""

Write-Host "  ${T}${B}Installing TentaCLAW CLI...${X}"
Write-Host ""
Install-Repo
Build-TentaCLAW
Write-Host ""

Write-Host "  ${T}${B}Setting up global command...${X}"
Write-Host ""
Install-GlobalCommand

Show-PostInstall

$elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
Write-Host "  ${D}Installed in ${elapsed}s${X}"
Write-Host ""
Write-Host "  ${P}${B}TentaCLAW is ready. Happy coding!${X}"
Write-Host ""
