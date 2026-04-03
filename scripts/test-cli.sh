#!/usr/bin/env bash
# =============================================================================
# TentaCLAW CLI Test Suite — Linux / macOS / Proxmox
# =============================================================================
#
# Usage:
#   bash scripts/test-cli.sh
#   bash scripts/test-cli.sh alexa-coder:latest
#
# Requirements:
#   - tentaclaw installed globally (npm install -g --force ./cli)
#   - Ollama running on localhost (or TENTACLAW_GATEWAY set)
# =============================================================================

set -uo pipefail

MODEL="${1:-hermes3:8b}"

# --- Colors ---
T=$'\033[38;2;0;212;170m'
P=$'\033[38;2;139;92;246m'
G=$'\033[38;2;0;255;136m'
R=$'\033[38;2;255;70;70m'
Y=$'\033[38;2;255;220;0m'
D=$'\033[2m'
B=$'\033[1m'
X=$'\033[0m'

# Disable colors when not a TTY
if [ ! -t 1 ]; then
    T=""; P=""; G=""; R=""; Y=""; D=""; B=""; X=""
fi

PASS=0
FAIL=0
TOTAL=0
START_TIME=$(date +%s)

check() {
    local name="$1"
    local condition="$2"
    TOTAL=$((TOTAL + 1))
    if [ "$condition" = "1" ] || [ "$condition" = "true" ]; then
        PASS=$((PASS + 1))
        echo "  ${G}OK${X} $name"
    else
        FAIL=$((FAIL + 1))
        echo "  ${R}XX${X} $name"
    fi
}

contains() { echo "$1" | grep -qi "$2" && echo 1 || echo 0; }
file_exists() { [ -f "$1" ] && echo 1 || echo 0; }
dir_exists() { [ -d "$1" ] && echo 1 || echo 0; }

# --- Banner ---
echo ""
echo "${T}${B}"
echo "   _____ ___ _  _ _____  _    ___ _      ___      __  ___  ___ "
echo "  |_   _| __| \| |_   _|/_\  / __| |    /_\ \    / / / _ \/ __|"
echo "    | | | _|| .\` | | | / _ \| (__| |__ / _ \ \/\/ / | (_) \__ \\"
echo "    |_| |___|_|\_| |_|/_/ \_\\___|____/_/ \_\\_/\_/   \___/|___/"
echo "${X}"
echo "  ${P}${B}CLI Test Suite${X} ${D}-- Bash Edition${X}"
echo "  ${D}Model: $MODEL | $(date '+%Y-%m-%d %H:%M')${X}"
echo ""

# ═══════════════════════════════════════════════════════════════
echo "  ${T}${B}--- VERSION & HELP ---${X}"
# ═══════════════════════════════════════════════════════════════

ver=$(tentaclaw --version 2>&1)
check "tentaclaw --version shows v2.0.0" "$(contains "$ver" "v2\.0\.0")"

help=$(tentaclaw help 2>&1)
check "help has SETUP section"    "$(contains "$help" "SETUP")"
check "help has SESSIONS section" "$(contains "$help" "SESSIONS")"
check "help has CLUSTER section"  "$(contains "$help" "CLUSTER")"
check "help has AGENT section"    "$(contains "$help" "AGENT")"
check "help shows setup command"  "$(contains "$help" "setup.*Configure\|Configure.*setup")"
check "help shows config command" "$(contains "$help" "config.*View\|View.*config")"
check "help shows doctor command" "$(contains "$help" "doctor.*Health\|Health.*doctor")"
check "help shows update command" "$(contains "$help" "update.*Self\|Self.*update")"
check "help shows sessions command" "$(contains "$help" "sessions.*List\|List.*sessions")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- CONFIG ---${X}"
# ═══════════════════════════════════════════════════════════════

cfg_show=$(tentaclaw config show 2>&1)
check "config show displays provider" "$(contains "$cfg_show" "provider")"
check "config show displays model"    "$(contains "$cfg_show" "model")"

cfg_path=$(tentaclaw config path 2>&1)
check "config path returns .json path" "$(contains "$cfg_path" "config\.json")"

cfg_get=$(tentaclaw config get model 2>&1)
check "config get model returns value" "$([ -n "${cfg_get// /}" ] && echo 1 || echo 0)"

# Set/get roundtrip
tentaclaw config set model "test-roundtrip-xyz" >/dev/null 2>&1
cfg_roundtrip=$(tentaclaw config get model 2>&1 | grep -v "^Tip:" | tr -d '[:space:]')
tentaclaw config set model "$MODEL" >/dev/null 2>&1
check "config set/get roundtrip" "$(contains "$cfg_roundtrip" "test-roundtrip-xyz")"

cfg_validate=$(tentaclaw config validate 2>&1)
check "config validate passes" "$(contains "$cfg_validate" "valid")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- MODELS ---${X}"
# ═══════════════════════════════════════════════════════════════

models=$(tentaclaw models 2>&1)
check "models lists provider"      "$(contains "$models" "ollama\|openai\|openrouter")"
check "models shows active marker" "$(contains "$models" "active")"
model_count=$(echo "$models" | grep -oE '[0-9]+\.[0-9]+[BM]' | wc -l)
check "models shows 5+ entries" "$([ "$model_count" -ge 5 ] && echo 1 || echo 0)"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- DOCTOR ---${X}"
# ═══════════════════════════════════════════════════════════════

doc=$(tentaclaw doctor 2>&1)
doc_passed=$(echo "$doc" | grep -ci "HEALTHY\|passed\|OK\|Config:\|Backend:")
check "doctor runs without error" "$([ "$doc_passed" -ge 1 ] && echo 1 || echo 0)"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- SESSIONS ---${X}"
# ═══════════════════════════════════════════════════════════════

sess_list=$(tentaclaw sessions 2>&1)
check "sessions list runs" "$(contains "$sess_list" "SESSIONS")"

sess_info=$(tentaclaw sessions info nonexistent-id 2>&1)
check "sessions info (bad id) shows error" "$(contains "$sess_info" "not found")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- CODE AGENT (non-interactive) ---${X}"
# ═══════════════════════════════════════════════════════════════

echo "  ${D}Running: tentaclaw code --task (simple math)...${X}"
code1=$(tentaclaw code --task "What is 9*9? Just the number." --yes --model "$MODEL" 2>&1)
check "code --task returns response"  "$(contains "$code1" "81\|◎")"
check "code shows session ID"         "$(contains "$code1" "session:")"
check "code loads workspace"          "$(contains "$code1" "Workspace:")"

sess_after=$(tentaclaw sessions 2>&1)
check "session persisted after code" "$(contains "$sess_after" "202[0-9]")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- TOOLS (write, read, list, shell, search) ---${X}"
# ═══════════════════════════════════════════════════════════════

echo "  ${D}Running: tool chain test (write + read + list + shell)...${X}"
tool_out=$(tentaclaw code --task "Do ALL of these: 1) write_file 'bash-test.txt' with 'Bash test OK'. 2) read_file 'bash-test.txt'. 3) list_dir. 4) run_shell 'echo SHELL_OK'." --yes --model "$MODEL" 2>&1)
check "write_file tool called" "$(contains "$tool_out" "write_file")"
check "read_file tool called"  "$(contains "$tool_out" "read_file")"
check "list_dir tool called"   "$(contains "$tool_out" "list_dir")"
check "run_shell tool called"  "$(contains "$tool_out" "run_shell")"

# --- edit_file ---
echo "  ${D}Running: edit_file test...${X}"
printf 'ORIG_TOKEN' > edit-test-bash.txt
edit_out=$(tentaclaw code --task "Read 'edit-test-bash.txt'. It contains ORIG_TOKEN. Use edit_file with old_text='ORIG_TOKEN' and new_text='EDIT_TOKEN'. Read back to confirm." --yes --model "$MODEL" 2>&1)
check "edit_file tool used" "$(contains "$edit_out" "edit_file")"
if [ -f "edit-test-bash.txt" ]; then
    edit_result=$(cat "edit-test-bash.txt")
else
    edit_result=""
fi
check "edit_file changed file content" "$(contains "$edit_result" "EDIT_TOKEN")"
rm -f "edit-test-bash.txt"

# --- create_directory + copy_file ---
echo "  ${D}Running: create_directory + copy_file test...${X}"
dir_out=$(tentaclaw code --task "Use create_directory to create 'wave2-bash-test/', then use write_file to create 'wave2-bash-test/source.txt' with content 'wave2', then use copy_file to copy it to 'wave2-bash-test/copy.txt'." --yes --model "$MODEL" 2>&1)
check "create_directory tool used" "$(contains "$dir_out" "create_directory")"
check "copy_file tool used"        "$(contains "$dir_out" "copy_file")"
check "directory created"          "$(dir_exists "wave2-bash-test")"
check "copied file exists"         "$(file_exists "wave2-bash-test/copy.txt")"
rm -rf "wave2-bash-test"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- WORKSPACE ---${X}"
# ═══════════════════════════════════════════════════════════════

WS_DIR="$HOME/.tentaclaw/workspace"
check "workspace dir exists"  "$(dir_exists "$WS_DIR")"
check "SOUL.md exists"        "$(file_exists "$WS_DIR/SOUL.md")"
check "USER.md exists"        "$(file_exists "$WS_DIR/USER.md")"
check "IDENTITY.md exists"    "$(file_exists "$WS_DIR/IDENTITY.md")"
check "MEMORY.md exists"      "$(file_exists "$WS_DIR/MEMORY.md")"
check "AGENTS.md exists"      "$(file_exists "$WS_DIR/AGENTS.md")"
check "TOOLS.md exists"       "$(file_exists "$WS_DIR/TOOLS.md")"

if [ -f "$WS_DIR/SOUL.md" ]; then
    soul_content=$(cat "$WS_DIR/SOUL.md")
    check "SOUL.md mentions TentaCLAW" "$(contains "$soul_content" "TentaCLAW")"
fi

check "memory/ subdir exists" "$(dir_exists "$WS_DIR/memory")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- SESSION PERSISTENCE ---${X}"
# ═══════════════════════════════════════════════════════════════

SESS_DIR="$HOME/.tentaclaw/sessions"
jsonl_count=$(ls "$SESS_DIR"/*.jsonl 2>/dev/null | wc -l)
check "JSONL files created" "$([ "$jsonl_count" -ge 1 ] && echo 1 || echo 0)"

if [ "$jsonl_count" -ge 1 ]; then
    latest=$(ls -t "$SESS_DIR"/*.jsonl 2>/dev/null | head -1)
    latest_content=$(cat "$latest" 2>/dev/null || echo "")
    check "JSONL has session_start"    "$(contains "$latest_content" "session_start")"
    check "JSONL has user message"     "$(contains "$latest_content" '"user"')"
    check "JSONL has assistant message" "$(contains "$latest_content" '"assistant"')"
    check "JSONL has timestamp"        "$(contains "$latest_content" "timestamp")"
    check "JSONL has model"            "$(contains "$latest_content" '"model"')"
    check "JSONL has usage event"      "$(contains "$latest_content" '"usage"')"
fi

index_path="$SESS_DIR/sessions.json"
check "sessions.json index exists" "$(file_exists "$index_path")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- SESSION RESUME ---${X}"
# ═══════════════════════════════════════════════════════════════

if [ "$jsonl_count" -ge 1 ]; then
    latest=$(ls -t "$SESS_DIR"/*.jsonl 2>/dev/null | head -1)
    SID=$(basename "$latest" .jsonl)
    echo "  ${D}Resuming session: $SID ...${X}"
    resume_out=$(tentaclaw code --resume "$SID" --task "What was my previous question? Repeat it." --yes --model "$MODEL" 2>&1)
    check "resume shows 'Resumed session'" "$(contains "$resume_out" "Resumed session")"
    check "resume loads previous messages"  "$(contains "$resume_out" "messages loaded\|◎")"
fi

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- SLASH COMMANDS ---${X}"
# ═══════════════════════════════════════════════════════════════

echo "  ${D}Testing all slash commands via piped input...${X}"
slash_input=$'/help\n/status\n/context\n/workspace\n/sessions\n/model test-model\n/model '"$MODEL"$'\n/auto\n/auto\n/think high\n/think off\n/compact\n/save\n/new\n/quit'
slash_out=$(echo "$slash_input" | tentaclaw code --model "$MODEL" 2>&1)

check "/help shows command list"   "$(contains "$slash_out" "SLASH COMMANDS")"
check "/status shows session info" "$(contains "$slash_out" "STATUS")"
check "/context shows message count" "$(contains "$slash_out" "messages in context")"
check "/workspace shows files"     "$(contains "$slash_out" "WORKSPACE")"
check "/sessions shows recent"     "$(contains "$slash_out" "RECENT SESSIONS\|Resume:")"
check "/model switches model"      "$(contains "$slash_out" "Model: test-model")"
check "/auto toggles approval"     "$(contains "$slash_out" "Auto-approve")"
check "/think sets level"          "$(contains "$slash_out" "Thinking:")"
check "/compact trims context"     "$(contains "$slash_out" "Compacted")"
check "/save confirms save"        "$(contains "$slash_out" "Session saved")"
check "/new starts fresh session"  "$(contains "$slash_out" "New session:")"
check "/quit saves and exits"      "$(contains "$slash_out" "waves goodbye")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- CLI v2 FEATURES ---${X}"
# ═══════════════════════════════════════════════════════════════

# ! shell shortcut
bang_out=$(printf '! echo SHELL_SHORTCUT_OK\n/quit\n' | tentaclaw code --model "$MODEL" 2>&1)
check "! shell shortcut outputs command result" "$(contains "$bang_out" "SHELL_SHORTCUT_OK")"

# /cd command
cd_out=$(printf '/cd /tmp\n/status\n/quit\n' | tentaclaw code --model "$MODEL" 2>&1)
check "/cd changes directory" "$(contains "$cd_out" "tmp\|cwd")"

# /cwd
cwd_out=$(printf '/cwd\n/quit\n' | tentaclaw code --model "$MODEL" 2>&1)
check "/cwd shows current directory" "$(contains "$cwd_out" "cwd\|tentaclaw\|home\|Users")"

# /usage
usage_out=$(printf '/usage\n/quit\n' | tentaclaw code --model "$MODEL" 2>&1)
check "/usage shows USAGE header"  "$(contains "$usage_out" "USAGE")"
check "/usage shows provider"      "$(contains "$usage_out" "Provider\|ollama\|openai")"
check "/usage shows token info"    "$(contains "$usage_out" "tokens\|FREE")"

# Config backup
tentaclaw config set model "$MODEL" >/dev/null 2>&1
bak_path="$HOME/.tentaclaw/config.json.bak"
check "config.json.bak created on config set" "$(file_exists "$bak_path")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- CHAT COMMAND ---${X}"
# ═══════════════════════════════════════════════════════════════

echo "  ${D}Testing: tentaclaw chat with piped input...${X}"
chat_out=$(printf 'Say only the word CHAT_OK and nothing else.\n/quit\n' | tentaclaw chat --model "$MODEL" 2>&1)
check "chat responds to input"    "$(contains "$chat_out" "CHAT_OK\|chat\|message")"
check "chat shows model name"     "$(contains "$chat_out" "$MODEL\|model\|provider\|Chat")"
check "chat /quit exits cleanly"  "$(contains "$chat_out" "quit\|bye\|goodbye\|Saved\|session\|CHAT_OK\|done")"

echo "  ${D}Testing: chat /help slash command...${X}"
chat_help_out=$(printf '/help\n/quit\n' | tentaclaw chat --model "$MODEL" 2>&1)
check "chat /help shows commands" "$(contains "$chat_help_out" "SLASH COMMANDS\|/quit\|/new\|/save")"

echo "  ${D}Testing: chat /status command...${X}"
chat_status_out=$(printf '/status\n/quit\n' | tentaclaw chat --model "$MODEL" 2>&1)
check "chat /status shows info" "$(contains "$chat_status_out" "STATUS\|model\|session\|messages")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- ERROR HANDLING ---${X}"
# ═══════════════════════════════════════════════════════════════

bad_gw=$(tentaclaw status --gateway "http://localhost:59999" 2>&1)
check "bad gateway shows error" "$(contains "$bad_gw" "Cannot connect\|timed out\|ECONNREFUSED\|connect")"

bad_sess=$(tentaclaw sessions info "nonexistent-session-xyz" 2>&1)
check "bad session ID shows 'not found'" "$(contains "$bad_sess" "not found")"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "  ${T}${B}--- CODING BENCHMARK (5 rounds) ---${X}"
# ═══════════════════════════════════════════════════════════════

BENCH_PASS=0
BENCH_FAIL=0

run_bench() {
    local num="$1" name="$2" task="$3" pattern="$4"
    local t0 t1 dt out
    t0=$(date +%s)
    printf "  ${D}  Bench %s : %s ...${X}" "$num" "$name"
    out=$(tentaclaw code --task "$task" --yes --model "$MODEL" 2>&1)
    t1=$(date +%s)
    dt=$((t1 - t0))
    if echo "$out" | grep -qiE "$pattern|write_file|run_shell|read_file"; then
        echo " ${G}OK${X} (${dt}s)"
        BENCH_PASS=$((BENCH_PASS + 1))
    else
        echo " ${R}FAIL${X} (${dt}s)"
        BENCH_FAIL=$((BENCH_FAIL + 1))
    fi
}

run_bench 1 "FizzBuzz"   "Write fizzbuzz.js for 1-20, run with node."                                           "Fizz|Buzz|Written"
run_bench 2 "Factorial"  "Write fact.js that prints 10! using recursion. Run with node."                         "3628800|Written"
run_bench 3 "Palindrome" "Write pal.js with isPalindrome(). Test 'racecar' and 'hello'. Run with node."         "true|false|Written"
run_bench 4 "File I/O"   "Create test.txt with 'hello world'. Read it back. Print contents."                    "hello|Written|read_file"
run_bench 5 "Shell cmd"  "Use run_shell to run 'node -e console.log(Math.PI)' and report the result."          "3\.14|run_shell"

check "benchmark: $BENCH_PASS/5 passed" "$([ "$BENCH_PASS" -ge 3 ] && echo 1 || echo 0)"

# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINS=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))

echo ""
echo "${T}${B}================================================================${X}"
echo ""
echo "  ${P}${B}TentaCLAW CLI Test Results${X}"
echo ""
echo "  Tests:   ${B}${PASS} passed${X} / ${R}${FAIL} failed${X} / ${TOTAL} total"
echo "  Bench:   ${B}${BENCH_PASS} passed${X} / $((BENCH_PASS + BENCH_FAIL)) total"
printf "  Time:    %dm %ds\n" "$MINS" "$SECS"
echo "  Model:   $MODEL"
echo "  Platform: bash $(bash --version | head -1 | cut -d' ' -f4) on $(uname -sr)"
echo ""

if [ "$FAIL" -eq 0 ]; then
    echo "  ${G}${B}ALL ${PASS} TESTS PASSED${X}"
else
    echo "  ${Y}${FAIL} test(s) need attention${X}"
fi

echo ""
echo "${T}${B}================================================================${X}"
echo ""

exit "$FAIL"
