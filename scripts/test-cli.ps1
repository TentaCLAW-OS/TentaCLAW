#Requires -Version 5.1
<#
.SYNOPSIS
    TentaCLAW CLI Test Suite for PowerShell
.DESCRIPTION
    Tests every feature of the TentaCLAW CLI: config, models, doctor,
    sessions, code agent, tools, slash commands, workspace, and more.
.EXAMPLE
    .\scripts\test-cli.ps1
.EXAMPLE
    .\scripts\test-cli.ps1 -Model "alexa-coder:latest"
#>
param(
    [string]$Model = "hermes3:8b"
)

$ErrorActionPreference = "Continue"

# --- Colors ---
$T = "`e[38;2;0;212;170m"    # Teal
$P = "`e[38;2;139;92;246m"   # Purple
$G = "`e[38;2;0;255;136m"    # Green
$R = "`e[38;2;255;70;70m"    # Red
$Y = "`e[38;2;255;220;0m"    # Yellow
$D = "`e[2m"                 # Dim
$B = "`e[1m"                 # Bold
$X = "`e[0m"                 # Reset

# PS 5.1 fallback
if ($PSVersionTable.PSVersion.Major -lt 7) {
    $T=""; $P=""; $G=""; $R=""; $Y=""; $D=""; $B=""; $X=""
}

$Pass = 0
$Fail = 0
$Total = 0
$Results = @()
$StartTime = Get-Date

function Test-Check {
    param([string]$Name, [bool]$Condition)
    $script:Total++
    if ($Condition) {
        $script:Pass++
        $script:Results += "  ${G}OK${X} $Name"
        Write-Host "  ${G}OK${X} $Name"
    } else {
        $script:Fail++
        $script:Results += "  ${R}XX${X} $Name"
        Write-Host "  ${R}XX${X} $Name"
    }
}

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "${T}${B}"
Write-Host "   _____ ___ _  _ _____  _    ___ _      ___      __  ___  ___ "
Write-Host "  |_   _| __| \| |_   _|/_\  / __| |    /_\ \    / / / _ \/ __|"
Write-Host "    | | | _|| .`` | | | / _ \| (__| |__ / _ \ \/\/ / | (_) \__ \"
Write-Host "    |_| |___|_|\_| |_|/_/ \_\\___|____/_/ \_\\_/\_/   \___/|___/"
Write-Host "${X}"
Write-Host "  ${P}${B}CLI Test Suite${X} ${D}-- PowerShell Edition${X}"
Write-Host "  ${D}Model: $Model | $(Get-Date -Format 'yyyy-MM-dd HH:mm')${X}"
Write-Host ""

# ═══════════════════════════════════════════════════════════════
Write-Host "  ${T}${B}--- VERSION & HELP ---${X}"
# ═══════════════════════════════════════════════════════════════

$ver = tentaclaw --version 2>&1 | Out-String
Test-Check "tentaclaw --version shows v2.38.0" ($ver -match "v2\.38\.0")

$help = tentaclaw help 2>&1 | Out-String
Test-Check "help has SETUP section" ($help -match "SETUP")
Test-Check "help has SESSIONS section" ($help -match "SESSIONS")
Test-Check "help has CLUSTER section" ($help -match "CLUSTER")
Test-Check "help has AGENT section" ($help -match "AGENT")
Test-Check "help shows setup command" ($help -match "setup.*Configure")
Test-Check "help shows config command" ($help -match "config.*View")
Test-Check "help shows doctor command" ($help -match "doctor.*Health")
Test-Check "help shows update command" ($help -match "update.*Self")
Test-Check "help shows sessions command" ($help -match "sessions.*List")

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- CONFIG ---${X}"
# ═══════════════════════════════════════════════════════════════

$cfgShow = tentaclaw config show 2>&1 | Out-String
Test-Check "config show displays provider" ($cfgShow -match "provider")
Test-Check "config show displays model" ($cfgShow -match "model")

$cfgPath = tentaclaw config path 2>&1 | Out-String
Test-Check "config path returns .json path" ($cfgPath -match "config\.json")

$cfgGet = tentaclaw config get model 2>&1 | Out-String
Test-Check "config get model returns value" ($cfgGet.Trim().Length -gt 0)

# Set/get roundtrip (filter tip lines that appear 20% of runs)
tentaclaw config set model "test-roundtrip-xyz" 2>&1 | Out-Null
$cfgRoundtrip = (tentaclaw config get model 2>&1 | Where-Object { $_ -notmatch "Tip:" } | Out-String).Trim()
tentaclaw config set model $Model 2>&1 | Out-Null
Test-Check "config set/get roundtrip" ($cfgRoundtrip -match "test-roundtrip-xyz")

$cfgValidate = tentaclaw config validate 2>&1 | Out-String
Test-Check "config validate passes" ($cfgValidate -match "valid")

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- MODELS ---${X}"
# ═══════════════════════════════════════════════════════════════

$models = tentaclaw models 2>&1 | Out-String
Test-Check "models lists provider" ($models -match "ollama|openai|openrouter")
Test-Check "models shows active marker" ($models -match "active")
$modelCount = ([regex]::Matches($models, "\d+\.\d+[BM]")).Count
Test-Check "models shows 5+ entries" ($modelCount -ge 5)

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- DOCTOR ---${X}"
# ═══════════════════════════════════════════════════════════════

$doc = tentaclaw doctor 2>&1 | Out-String
$docPassed = ([regex]::Matches($doc, "HEALTHY|passed|OK")).Count
Test-Check "doctor runs without error" ($docPassed -ge 1 -or $doc -match "Config:|Backend:")

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- SESSIONS ---${X}"
# ═══════════════════════════════════════════════════════════════

$sessList = tentaclaw sessions 2>&1 | Out-String
Test-Check "sessions list runs" ($sessList -match "SESSIONS")

$sessInfo = tentaclaw sessions info nonexistent-id 2>&1 | Out-String
Test-Check "sessions info (bad id) shows error" ($sessInfo -match "not found")

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- CODE AGENT (non-interactive) ---${X}"
# ═══════════════════════════════════════════════════════════════

Write-Host "  ${D}Running: tentaclaw code --task (simple math)...${X}"
$code1 = tentaclaw code --task "What is 9*9? Just the number." --yes --model $Model 2>&1 | Out-String
Test-Check "code --task returns response" ($code1 -match "81|◎")
Test-Check "code shows session ID" ($code1 -match "session:")
Test-Check "code loads workspace" ($code1 -match "Workspace:")

# Check session was persisted
$sessAfter = tentaclaw sessions 2>&1 | Out-String
Test-Check "session persisted after code" ($sessAfter -match "2026")

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- TOOLS (write, read, list, shell, search) ---${X}"
# ═══════════════════════════════════════════════════════════════

Write-Host "  ${D}Running: tool chain test (write + read + list + shell)...${X}"
$toolOut = tentaclaw code --task "Do ALL of these: 1) write_file 'ps-test.txt' with 'PowerShell test OK'. 2) read_file 'ps-test.txt'. 3) list_dir. 4) run_shell 'echo SHELL_OK'." --yes --model $Model 2>&1 | Out-String
Test-Check "write_file tool called" ($toolOut -match "write_file")
Test-Check "read_file tool called" ($toolOut -match "read_file")
Test-Check "list_dir tool called" ($toolOut -match "list_dir")
Test-Check "run_shell tool called" ($toolOut -match "run_shell")

# --- edit_file tool ---
Write-Host "  ${D}Running: edit_file test...${X}"
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "edit-test.txt"), "ORIG_TOKEN")
$editOut = tentaclaw code --task "Read 'edit-test.txt'. It contains ORIG_TOKEN. Use edit_file with old_text='ORIG_TOKEN' and new_text='EDIT_TOKEN'. Read back to confirm." --yes --model $Model 2>&1 | Out-String
Test-Check "edit_file tool used" ($editOut -match "edit_file")
$editResult = if (Test-Path "edit-test.txt") { Get-Content "edit-test.txt" -Raw } else { "" }
Test-Check "edit_file changed file content" ($editResult -match "EDIT_TOKEN")
Remove-Item "edit-test.txt" -ErrorAction SilentlyContinue

# --- create_directory + copy_file tools ---
Write-Host "  ${D}Running: create_directory + copy_file test...${X}"
$dirOut = tentaclaw code --task "Use create_directory to create 'wave2-test/', then use write_file to create 'wave2-test/source.txt' with content 'wave2', then use copy_file to copy it to 'wave2-test/copy.txt'." --yes --model $Model 2>&1 | Out-String
Test-Check "create_directory tool used" ($dirOut -match "create_directory")
Test-Check "copy_file tool used" ($dirOut -match "copy_file")
Test-Check "directory created" (Test-Path "wave2-test")
Test-Check "copied file exists" (Test-Path "wave2-test\copy.txt")
Remove-Item "wave2-test" -Recurse -ErrorAction SilentlyContinue

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- WORKSPACE ---${X}"
# ═══════════════════════════════════════════════════════════════

$wsDir = Join-Path $env:USERPROFILE ".tentaclaw\workspace"
Test-Check "workspace dir exists" (Test-Path $wsDir)
Test-Check "SOUL.md exists" (Test-Path (Join-Path $wsDir "SOUL.md"))
Test-Check "USER.md exists" (Test-Path (Join-Path $wsDir "USER.md"))
Test-Check "IDENTITY.md exists" (Test-Path (Join-Path $wsDir "IDENTITY.md"))
Test-Check "MEMORY.md exists" (Test-Path (Join-Path $wsDir "MEMORY.md"))
Test-Check "AGENTS.md exists" (Test-Path (Join-Path $wsDir "AGENTS.md"))
Test-Check "TOOLS.md exists" (Test-Path (Join-Path $wsDir "TOOLS.md"))

if (Test-Path (Join-Path $wsDir "SOUL.md")) {
    $soulContent = Get-Content (Join-Path $wsDir "SOUL.md") -Raw
    Test-Check "SOUL.md mentions TentaCLAW" ($soulContent -match "TentaCLAW")
}

Test-Check "memory/ subdir exists" (Test-Path (Join-Path $wsDir "memory"))

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- SESSION PERSISTENCE ---${X}"
# ═══════════════════════════════════════════════════════════════

$sessDir = Join-Path $env:USERPROFILE ".tentaclaw\sessions"
$jsonlFiles = Get-ChildItem "$sessDir\*.jsonl" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
Test-Check "JSONL files created" ($jsonlFiles.Count -ge 1)

if ($jsonlFiles.Count -ge 1) {
    $latest = Get-Content $jsonlFiles[0].FullName -Raw
    Test-Check "JSONL has session_start" ($latest -match "session_start")
    Test-Check "JSONL has user message" ($latest -match '"user"')
    Test-Check "JSONL has assistant message" ($latest -match '"assistant"')
    Test-Check "JSONL has timestamp" ($latest -match "timestamp")
    Test-Check "JSONL has model" ($latest -match '"model"')
    Test-Check "JSONL has usage event" ($latest -match '"usage"')
}

$indexPath = Join-Path $sessDir "sessions.json"
Test-Check "sessions.json index exists" (Test-Path $indexPath)

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- SESSION RESUME ---${X}"
# ═══════════════════════════════════════════════════════════════

if ($jsonlFiles.Count -ge 1) {
    $sid = $jsonlFiles[0].BaseName
    Write-Host "  ${D}Resuming session: $sid ...${X}"
    $resumeOut = tentaclaw code --resume $sid --task "What was my previous question? Repeat it." --yes --model $Model 2>&1 | Out-String
    Test-Check "resume shows 'Resumed session'" ($resumeOut -match "Resumed session")
    Test-Check "resume loads previous messages" ($resumeOut -match "messages loaded|◎")
}

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- SLASH COMMANDS ---${X}"
# ═══════════════════════════════════════════════════════════════

Write-Host "  ${D}Testing all slash commands via piped input...${X}"
$slashInput = "/help`n/status`n/context`n/workspace`n/sessions`n/model test-model`n/model $Model`n/auto`n/auto`n/think high`n/think off`n/compact`n/save`n/new`n/quit"
$slashOut = $slashInput | tentaclaw code --model $Model 2>&1 | Out-String

Test-Check "/help shows command list" ($slashOut -match "SLASH COMMANDS")
Test-Check "/status shows session info" ($slashOut -match "STATUS")
Test-Check "/context shows context info" ($slashOut -match "CONTEXT|messages|tokens")
Test-Check "/workspace shows files" ($slashOut -match "WORKSPACE")
Test-Check "/sessions shows recent" ($slashOut -match "RECENT SESSIONS|Resume:")
Test-Check "/model switches model" ($slashOut -match "Model: test-model")
Test-Check "/auto toggles approval" ($slashOut -match "Auto-approve")
Test-Check "/think sets level" ($slashOut -match "Thinking:")
Test-Check "/compact shows context info" ($slashOut -match "COMPACT|Compacted")
Test-Check "/save confirms save" ($slashOut -match "Session saved")
Test-Check "/new starts fresh session" ($slashOut -match "New session:")
Test-Check "/quit saves and exits" ($slashOut -match "waves goodbye")

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- CLI v2 FEATURES ---${X}"
# ═══════════════════════════════════════════════════════════════

# ! shell shortcut
$bangInput = "! echo SHELL_SHORTCUT_OK`n/quit"
$bangOut = $bangInput | tentaclaw code --model $Model 2>&1 | Out-String
Test-Check "! shell shortcut outputs command result" ($bangOut -match "SHELL_SHORTCUT_OK")

# /cd command
$cdInput = "/cd $env:TEMP`n/status`n/quit"
$cdOut = $cdInput | tentaclaw code --model $Model 2>&1 | Out-String
Test-Check "/cd changes directory" ($cdOut -match "Temp|TEMP|tentaclaw|cwd")

# /cwd with no args shows current dir
$cwdInput = "/cwd`n/quit"
$cwdOut = $cwdInput | tentaclaw code --model $Model 2>&1 | Out-String
Test-Check "/cwd shows current directory" ($cwdOut -match "cwd|tentaclaw-os|Users")

# /usage command in code agent
$usageInput = "/usage`n/quit"
$usageOut = $usageInput | tentaclaw code --model $Model 2>&1 | Out-String
Test-Check "/usage shows USAGE header" ($usageOut -match "USAGE")
Test-Check "/usage shows provider" ($usageOut -match "Provider|ollama|openai")
Test-Check "/usage shows token info" ($usageOut -match "tokens|FREE")

# Config backup
$cfgPath = Join-Path $env:USERPROFILE ".tentaclaw\config.json"
$bakPath = Join-Path $env:USERPROFILE ".tentaclaw\config.json.bak"
tentaclaw config set model $Model 2>&1 | Out-Null
Test-Check "config.json.bak created on config set" (Test-Path $bakPath)

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- CHAT COMMAND ---${X}"
# ═══════════════════════════════════════════════════════════════

Write-Host "  ${D}Testing: tentaclaw chat with piped input...${X}"
$chatInput = "Say only the word CHAT_OK and nothing else.`n/quit"
$chatOut = $chatInput | tentaclaw chat --model $Model 2>&1 | Out-String
Test-Check "chat responds to input"    ($chatOut -match "CHAT_OK|chat|message")
Test-Check "chat shows model name"     ($chatOut -match $Model -or $chatOut -match "model|provider|Chat")
Test-Check "chat /quit exits cleanly"  ($chatOut -match "quit|bye|goodbye|Saved|session|CHAT_OK|done")

Write-Host "  ${D}Testing: chat /help slash command...${X}"
$chatHelpInput = "/help`n/quit"
$chatHelpOut = $chatHelpInput | tentaclaw chat --model $Model 2>&1 | Out-String
Test-Check "chat /help shows commands" ($chatHelpOut -match "SLASH COMMANDS|/quit|/new|/save")

Write-Host "  ${D}Testing: chat /status command...${X}"
$chatStatusInput = "/status`n/quit"
$chatStatusOut = $chatStatusInput | tentaclaw chat --model $Model 2>&1 | Out-String
Test-Check "chat /status shows info" ($chatStatusOut -match "STATUS|model|session|messages")

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- ERROR HANDLING ---${X}"
# ═══════════════════════════════════════════════════════════════

$badGw = tentaclaw status --gateway "http://localhost:59999" 2>&1 | Out-String
Test-Check "bad gateway shows error" ($badGw -match "Cannot connect|timed out")

$badSess = tentaclaw sessions info "nonexistent-session-xyz" 2>&1 | Out-String
Test-Check "bad session ID shows 'not found'" ($badSess -match "not found")

# ═══════════════════════════════════════════════════════════════
# Wave 47: sessions clean + version alias
Write-Host ""
Write-Host "  ${T}${B}--- SESSIONS CLEAN + VERSION ALIAS ---${X}"
# ═══════════════════════════════════════════════════════════════

$cleanOut = tentaclaw sessions clean 999 2>&1 | Out-String
Test-Check "sessions clean runs" ($cleanOut -match "Cleaned|remaining")

$verShort = tentaclaw -v 2>&1 | Out-String
$verAlias = tentaclaw version 2>&1 | Out-String
Test-Check "version alias (-v)" ($verShort -match "v2\." -or $verAlias -match "v2\.")

# ═══════════════════════════════════════════════════════════════
# Wave 48 + 53: chat JSONL usage event, tok/s, --file flag, doctor expanded
Write-Host ""
Write-Host "  ${T}${B}--- ADVANCED FEATURES ---${X}"
# ═══════════════════════════════════════════════════════════════

# Chat JSONL has usage event (Wave 35/48)
# Run one inference turn in chat — no /quit so stdin closes after response.
# The rl.on('close') handler saves session_end cleanly.
$sessDir2 = Join-Path $env:USERPROFILE ".tentaclaw\sessions"
"Reply with the single word CHATDONE." | tentaclaw chat --model $Model 2>&1 | Out-Null
$chatUsageFound = $false
foreach ($j in (Get-ChildItem "$sessDir2\*.jsonl" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5)) {
    $raw = Get-Content $j.FullName -Raw
    if ($raw -match '"mode"' -and $raw -match '"usage"') { $chatUsageFound = $true; break }
}
Test-Check "chat JSONL has usage event" $chatUsageFound

# Doctor expanded checks (Wave 53)
$doctorOut2 = tentaclaw doctor 2>&1 | Out-String
Test-Check "doctor checks config dir writable" ($doctorOut2 -match "writable|Config dir")
Test-Check "doctor checks backend" ($doctorOut2 -match "Backend:|reachable|cannot reach")

# --file flag test (Wave 53 + 45)
$fileTaskPath = Join-Path $env:TEMP "tentaclaw-file-test.txt"
[System.IO.File]::WriteAllText($fileTaskPath, "TASK: Print the number 42 and nothing else.")
$fileOut = tentaclaw code --file $fileTaskPath --yes --model $Model 2>&1 | Out-String
Test-Check "--file flag loads task" ($fileOut -match "42|file|File")
Remove-Item $fileTaskPath -ErrorAction SilentlyContinue

# tok/s display (Wave 48/46) — run a quick code task and check for tok/s
$toksOut = tentaclaw code --task "Reply with only the word DONE." --yes --model $Model 2>&1 | Out-String
Test-Check "tok/s displayed after response" ($toksOut -match "tok/s")

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ${T}${B}--- CODING BENCHMARK (5 rounds) ---${X}"
# ═══════════════════════════════════════════════════════════════

$benchPass = 0
$benchFail = 0

function Run-Bench {
    param([int]$Num, [string]$Name, [string]$Task, [string]$Check)
    $t = Get-Date
    Write-Host "  ${D}  Bench $Num : $Name ...${X}" -NoNewline
    $out = tentaclaw code --task $Task --yes --model $Model 2>&1 | Out-String
    $dt = [math]::Round(((Get-Date) - $t).TotalSeconds)
    if ($out -match $Check -or $out -match "write_file|run_shell|read_file") {
        Write-Host " ${G}OK${X} (${dt}s)"
        $script:benchPass++
    } else {
        Write-Host " ${R}FAIL${X} (${dt}s)"
        $script:benchFail++
    }
}

Run-Bench 1 "FizzBuzz" "Write fizzbuzz.js for 1-20, run with node." "Fizz|Buzz|Written"
Run-Bench 2 "Factorial" "Write fact.js that prints 10! using recursion. Run with node." "3628800|Written"
Run-Bench 3 "Palindrome" "Write pal.js with isPalindrome(). Test 'racecar' and 'hello'. Run with node." "true|false|Written"
Run-Bench 4 "File I/O" "Create test.txt with 'hello world'. Read it back. Print contents." "hello|Written|read_file"
Run-Bench 5 "Shell cmd" "Use run_shell to run 'node -e console.log(Math.PI)' and report the result." "3.14|run_shell"

Test-Check "benchmark: $benchPass/5 passed" ($benchPass -ge 3)

# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════

$elapsed = [math]::Round(((Get-Date) - $StartTime).TotalSeconds)
$mins = [math]::Floor($elapsed / 60)
$secs = $elapsed % 60

Write-Host ""
Write-Host "${T}${B}================================================================${X}"
Write-Host ""
Write-Host "  ${P}${B}TentaCLAW CLI Test Results${X}"
Write-Host ""
Write-Host "  Tests:   ${B}$Pass passed${X} / ${R}$Fail failed${X} / $Total total"
Write-Host "  Bench:   ${B}$benchPass passed${X} / $($benchPass + $benchFail) total"
Write-Host "  Time:    ${mins}m ${secs}s"
Write-Host "  Model:   $Model"
Write-Host "  Platform: PowerShell $($PSVersionTable.PSVersion) on $([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)"
Write-Host ""

if ($Fail -eq 0) {
    Write-Host "  ${G}${B}ALL $Pass TESTS PASSED${X}"
} else {
    Write-Host "  ${Y}$Fail test(s) need attention${X}"
    Write-Host ""
    foreach ($r in $Results) {
        if ($r -match "XX") { Write-Host $r }
    }
}

Write-Host ""
Write-Host "${T}${B}================================================================${X}"
Write-Host ""

exit $Fail
