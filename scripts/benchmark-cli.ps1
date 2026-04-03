#Requires -Version 5.1
<#
.SYNOPSIS
    TentaCLAW CLI — 15-Round Coding Benchmark (PowerShell)
.DESCRIPTION
    Runs 15 coding tasks across 4 categories and grades the agent.
    Symmetric with scripts/benchmark-cli.sh.
.EXAMPLE
    .\scripts\benchmark-cli.ps1
    .\scripts\benchmark-cli.ps1 -Model alexa-coder:latest
#>
param(
    [string]$Model = "alexa-coder:latest"
)

$ErrorActionPreference = "Continue"

# --- Colors (PS 5.1 compatible) ---
$ESC = [char]27
if ($Host.UI.SupportsVirtualTerminal -or $PSVersionTable.PSVersion.Major -ge 7) {
    $T = "$ESC[38;2;0;212;170m"; $P = "$ESC[38;2;139;92;246m"
    $G = "$ESC[38;2;0;255;136m"; $R = "$ESC[38;2;255;70;70m"
    $Y = "$ESC[38;2;255;220;0m"; $D = "$ESC[2m"; $B = "$ESC[1m"; $X = "$ESC[0m"
} else {
    $T=""; $P=""; $G=""; $R=""; $Y=""; $D=""; $B=""; $X=""
}

$BenchPass = 0
$BenchFail = 0
$BenchTotal = 0
$StartTime = Get-Date

Write-Host ""
Write-Host "${T}${B}+==============================================================+${X}"
Write-Host "${T}${B}|       TentaCLAW CLI -- 15-Round Coding Benchmark            |${X}"
Write-Host "${T}${B}+==============================================================+${X}"
Write-Host ""
Write-Host "  ${D}Model:  $Model${X}"
Write-Host "  ${D}Date:   $(Get-Date -Format 'yyyy-MM-dd HH:mm')${X}"
Write-Host ""

function Run-Bench {
    param([int]$Num, [string]$Name, [string]$Task, [string]$Pattern)
    $script:BenchTotal++
    $t = Get-Date
    Write-Host ("  ${D}[{0,2}/15]${X} {1,-28} " -f $Num, $Name) -NoNewline
    $out = tentaclaw code --task $Task --yes --model $Model 2>&1 | Out-String
    $dt = [math]::Round(((Get-Date) - $t).TotalSeconds)
    if ($out -match $Pattern) {
        Write-Host "${G}PASS${X} ${D}(${dt}s)${X}"
        $script:BenchPass++
    } else {
        Write-Host "${R}FAIL${X} ${D}(${dt}s)${X}"
        $script:BenchFail++
    }
    Remove-Item fizzbuzz.js,fact.js,pal.js,fib.js,primes.js,sort.js,greet.js `
                test.txt,data.txt,source.txt,copy.txt,moved.txt,words.txt `
                -ErrorAction SilentlyContinue
}

Write-Host "  ${P}${B}Category 1: Basic Algorithms${X}"
Run-Bench  1 "FizzBuzz 1-20"         "Write fizzbuzz.js printing FizzBuzz for 1-20. Run with node."                                               "Fizz|Buzz|Written|fizzbuzz"
Run-Bench  2 "Factorial (recursion)" "Write fact.js printing 10! via recursion. Run with node and verify 3628800."                                 "3628800|Written|factorial"
Run-Bench  3 "Fibonacci sequence"    "Write fib.js that prints the first 10 Fibonacci numbers. Run it."                                            "55|34|21|Written|fib"
Run-Bench  4 "Prime sieve"           "Write primes.js that prints all primes up to 50. Run it."                                                   "47|43|41|Written|prime"
Run-Bench  5 "Palindrome check"      "Write pal.js with isPalindrome. Test racecar (true) and hello (false). Run it."                             "true|false|Written|palindrome"

Write-Host ""
Write-Host "  ${P}${B}Category 2: File I/O${X}"
Run-Bench  6 "Write and read file"   "Create test.txt with 'TentaCLAW benchmark'. Read it back and print contents."                               "TentaCLAW|benchmark|read_file|write_file"
Run-Bench  7 "Edit file content"     "Write data.txt with 'original'. Use edit_file to change 'original' to 'modified'. Read it back."            "modified|edit_file"
Run-Bench  8 "Directory listing"     "Create bench-test dir, write a.txt b.txt c.txt in it, then list the directory."                             "a.txt|b.txt|c.txt|list_dir|create_directory"
Run-Bench  9 "Copy + move files"     "Write source.txt with 'hello'. Copy to copy.txt. Move copy.txt to moved.txt. Read moved.txt."                "hello|copy_file|move_file|moved"
Run-Bench 10 "Search in files"       "Write words.txt with 5 animals one per line. Use search_files to find lines containing 'cat'."              "search_files|cat|found|match|write_file"

Write-Host ""
Write-Host "  ${P}${B}Category 3: Shell Integration${X}"
Run-Bench 11 "Run Node.js"           "Use run_shell to run: node -e console.log(Math.PI.toFixed(4)) and report the result."                       "3.1415|run_shell"
Run-Bench 12 "Git status"            "Use run_shell to run 'git status' in the current directory and summarize what you see."                      "git|branch|status|run_shell"
Run-Bench 13 "Environment info"      "Use run_shell to get Node.js version and OS platform. Report both."                                          "node|v[0-9]|windows|linux|run_shell"

Write-Host ""
Write-Host "  ${P}${B}Category 4: Code Generation${X}"
Run-Bench 14 "Sorting algorithm"     "Write sort.js with bubbleSort([5,3,1,4,2]). Print the sorted result. Run it."                               "1,2,3,4,5|1 2 3 4 5|\[1|Written|sort"
Run-Bench 15 "Class + methods"       "Write greet.js with a Greeter class with name property and greet method. Create instance and run it."        "Hello|Greeter|greet|Written"

# --- Summary ---
$elapsed = [math]::Round(((Get-Date) - $StartTime).TotalSeconds)
$mins    = [math]::Floor($elapsed / 60)
$secs    = $elapsed % 60
$pct     = [math]::Round($BenchPass * 100 / $BenchTotal)

Write-Host ""
Write-Host "${T}${B}===============================================================${X}"
Write-Host ""
Write-Host "  ${P}${B}Benchmark Results${X}"
Write-Host ""
Write-Host "  Model:   $Model"
Write-Host "  Score:   ${B}$BenchPass/$BenchTotal ($pct%)${X}"
Write-Host "  Time:    ${mins}m ${secs}s"
Write-Host "  Date:    $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
Write-Host "  Platform: PowerShell $($PSVersionTable.PSVersion) on $([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)"
Write-Host ""

if     ($pct -ge 90) { Write-Host "  ${G}${B}Grade: A -- Excellent${X}" }
elseif ($pct -ge 80) { Write-Host "  ${G}${B}Grade: B -- Good${X}" }
elseif ($pct -ge 70) { Write-Host "  ${Y}${B}Grade: C -- Acceptable${X}" }
elseif ($pct -ge 60) { Write-Host "  ${Y}${B}Grade: D -- Needs work${X}" }
else                  { Write-Host "  ${R}${B}Grade: F -- Below threshold${X}" }

Write-Host ""
Write-Host "${T}${B}===============================================================${X}"
Write-Host ""

exit $BenchFail
