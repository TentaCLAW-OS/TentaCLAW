#!/usr/bin/env bash
# =============================================================================
# TentaCLAW CLI — 15-Round Coding Benchmark
# =============================================================================
#
# Usage:
#   bash scripts/benchmark-cli.sh
#   bash scripts/benchmark-cli.sh alexa-coder:latest
#   bash scripts/benchmark-cli.sh hermes3:8b
#
# Runs 15 coding tasks and grades the agent on:
#   - Tool usage (did it use the right tools?)
#   - Output quality (does the result match?)
#   - Reliability (does it finish?)
# =============================================================================

set -uo pipefail

MODEL="${1:-alexa-coder:latest}"

T=$'\033[38;2;0;212;170m'
P=$'\033[38;2;139;92;246m'
G=$'\033[38;2;0;255;136m'
R=$'\033[38;2;255;70;70m'
Y=$'\033[38;2;255;220;0m'
D=$'\033[2m'
B=$'\033[1m'
X=$'\033[0m'

if [ ! -t 1 ]; then T=""; P=""; G=""; R=""; Y=""; D=""; B=""; X=""; fi

PASS=0
FAIL=0
TOTAL=0
START=$(date +%s)

echo ""
echo "${T}${B}╔══════════════════════════════════════════════════════════════╗${X}"
echo "${T}${B}║       TentaCLAW CLI — 15-Round Coding Benchmark             ║${X}"
echo "${T}${B}╚══════════════════════════════════════════════════════════════╝${X}"
echo ""
echo "  ${D}Model:  $MODEL${X}"
echo "  ${D}Date:   $(date '+%Y-%m-%d %H:%M')${X}"
echo ""

bench() {
    local num="$1" name="$2" task="$3" pattern="$4"
    local t0 t1 dt out result
    TOTAL=$((TOTAL + 1))
    t0=$(date +%s)
    printf "  ${D}[%2d/15]${X} %-28s " "$num" "$name"
    out=$(tentaclaw code --task "$task" --yes --model "$MODEL" 2>&1)
    t1=$(date +%s)
    dt=$((t1 - t0))
    if echo "$out" | grep -qiE "$pattern"; then
        PASS=$((PASS + 1))
        echo "${G}PASS${X} ${D}(${dt}s)${X}"
        result="PASS"
    else
        FAIL=$((FAIL + 1))
        echo "${R}FAIL${X} ${D}(${dt}s)${X}"
        result="FAIL"
    fi
    # Clean up temp files
    rm -f fizzbuzz.js fact.js pal.js hello.js fib.js primes.js sort.js greet.js \
          test.txt output.txt data.txt result.txt words.txt numbers.txt 2>/dev/null || true
}

echo "  ${P}${B}Category 1: Basic Algorithms${X}"
bench  1 "FizzBuzz 1-20"        "Write fizzbuzz.js printing FizzBuzz for 1-20. Run with node."                                                        "Fizz|Buzz|Written|fizzbuzz"
bench  2 "Factorial (recursion)" "Write fact.js printing 10! via recursion. Run with node and verify 3628800."                                          "3628800|Written|factorial"
bench  3 "Fibonacci sequence"   "Write fib.js that prints the first 10 Fibonacci numbers. Run it."                                                     "55|34|21|Written|fib"
bench  4 "Prime sieve"          "Write primes.js that prints all primes up to 50. Run it."                                                             "47|43|41|Written|prime"
bench  5 "Palindrome check"     "Write pal.js with isPalindrome(s). Test 'racecar' (true) and 'hello' (false). Run it."                               "true|false|Written|palindrome"

echo ""
echo "  ${P}${B}Category 2: File I/O${X}"
bench  6 "Write and read file"  "Create test.txt with 'TentaCLAW benchmark'. Read it back and print contents."                                         "TentaCLAW|benchmark|read_file|write_file"
bench  7 "Edit file content"    "Write data.txt with 'original'. Use edit_file to change 'original' to 'modified'. Read it back."                      "modified|edit_file"
bench  8 "Directory listing"    "Create a directory 'bench-test/', write 3 files in it (a.txt b.txt c.txt), then list the directory."                  "a\.txt|b\.txt|c\.txt|list_dir|create_directory"
bench  9 "Copy + move files"    "Write source.txt with 'hello'. Copy it to copy.txt. Move copy.txt to moved.txt. Read moved.txt."                      "hello|copy_file|move_file|moved"
bench 10 "Search in files"      "Write words.txt with 5 animals (one per line). Use search_files to find lines containing 'cat'."                      "search_files|cat\|found\|match\|write_file"

echo ""
echo "  ${P}${B}Category 3: Shell Integration${X}"
bench 11 "Run Node.js"          "Use run_shell to run: node -e \"console.log(Math.PI.toFixed(4))\" and report the result."                             "3\.1415|run_shell"
bench 12 "Git status"           "Use run_shell to run 'git status' in the current directory and summarize what you see."                               "git\|branch\|status\|run_shell"
bench 13 "Environment info"     "Use run_shell to get Node.js version and OS platform. Report both."                                                   "node\|v[0-9]\|linux\|darwin\|win\|run_shell"

echo ""
echo "  ${P}${B}Category 4: Code Generation${X}"
bench 14 "Sorting algorithm"    "Write sort.js with bubbleSort([5,3,1,4,2]). Print the sorted result. Run it."                                        "1,2,3,4,5\|1 2 3 4 5\|\[1\|Written|sort"
bench 15 "Class + methods"      "Write greet.js with a Greeter class (name property, greet() method). Create one instance and call greet(). Run it."  "Hello\|Greeter\|greet\|Written"

# ═══════════════════════════════════════════════════════════════
END=$(date +%s)
ELAPSED=$((END - START))
MINS=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))
PCT=$((PASS * 100 / TOTAL))

echo ""
echo "${T}${B}══════════════════════════════════════════════════════════════${X}"
echo ""
echo "  ${P}${B}Benchmark Results${X}"
echo ""
echo "  Model:   $MODEL"
printf "  Score:   %s%d/%d (%d%%)%s\n" "${B}" "$PASS" "$TOTAL" "$PCT" "${X}"
echo "  Time:    ${MINS}m ${SECS}s"
echo "  Date:    $(date '+%Y-%m-%d %H:%M')"
echo ""

if   [ "$PCT" -ge 90 ]; then echo "  ${G}${B}Grade: A — Excellent${X}"
elif [ "$PCT" -ge 80 ]; then echo "  ${G}${B}Grade: B — Good${X}"
elif [ "$PCT" -ge 70 ]; then echo "  ${Y}${B}Grade: C — Acceptable${X}"
elif [ "$PCT" -ge 60 ]; then echo "  ${Y}${B}Grade: D — Needs work${X}"
else                          echo "  ${R}${B}Grade: F — Below threshold${X}"
fi

echo ""
echo "${T}${B}══════════════════════════════════════════════════════════════${X}"
echo ""

exit "$FAIL"
