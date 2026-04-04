# Changelog

All notable changes to TentaCLAW OS are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [2.34.0] — 2026-04-03

### Phase 2 — Cluster Intelligence cont. + Phase 3 — Coding Agent Excellence (Waves 476–575)

**Fleet Management (Waves 476–499)**

- **Wave 480 — LRU eviction** — `GET /api/v1/eviction/candidates` lists least-recently-used models per node; `POST /api/v1/eviction/run` evicts a specific model from a node; `POST /api/v1/eviction/auto` clears candidates from all nodes below VRAM headroom threshold
- **Wave 482 — Wake-on-LAN** — `POST /api/v1/nodes/:nodeId/wakeup` sends a UDP broadcast magic packet to power on sleeping rigs by MAC address
- **Wave 487 — Multi-node benchmark** — `POST /api/v1/benchmarks/multi-node` runs parallel benchmarks across all online nodes and returns per-node tok/s results
- **Wave 488 — Capacity planner** — `POST /api/v1/capacity/plan` checks a list of models against current VRAM and reports fit/no-fit per node with required/available VRAM
- **Wave 490 — Rolling fleet restart** — `POST /api/v1/fleet/restart` restarts all agents either in rolling (one at a time) or simultaneous mode
- **Wave 494 — GPU hang detection** — background 60s check: nodes with in-flight requests and zero tok/s for >60s are flagged and broadcast as `gpu_hang` SSE events; also exposed at `POST /api/v1/fleet/hang-check`
- **Wave 496 — Thermal dashboard** — `GET /api/v1/fleet/thermal` returns per-node GPU temperatures, fan speeds, and cluster-wide thermal grade
- **Wave 498 — Anomaly detection** — `GET /api/v1/fleet/anomalies` compares current 1h req/min, p95 latency, and error rate against 24h baseline; flags deviations >50% as anomalies with severity and suggested action

**CLI Fleet Commands**
- `tentaclaw capacity plan --models <list>` — VRAM fit check
- `tentaclaw eviction candidates` / `eviction run` / `eviction auto` — LRU eviction management
- `tentaclaw thermal` — cluster thermal summary
- `tentaclaw route explain|telemetry|rules|standby` — routing visibility

**Phase 3 — Coding Agent Excellence (Waves 539–575)**

- **Wave 539 — `tentaclaw review`** — streams a code review of the current git diff; `--style brief|full`; `--model` override
- **Wave 540 — `tentaclaw refactor <pattern>`** — delegates refactoring task to code agent; `--dry-run` for preview
- **Wave 547 — `tentaclaw pr`** — generates a PR description from git diff and commit log; `--base <branch>`, `--title`, `--dry-run`
- **Wave 550 — `tentaclaw debug <error>`** — passes an error message to the code agent for root-cause analysis and fix
- **Wave 551 — `tentaclaw docs [path]`** — generates documentation for the given file or directory via code agent
- **Wave 555 — `tentaclaw scaffold <description>`** — scaffolds a new project or module from a natural-language description
- **Wave 558 — `tentaclaw costs`** — token usage report: input/output totals, Anthropic equivalent cost, local power cost vs cloud savings; `--hours <N>` window
- **Wave 560 — `--persona <type>`** — injects a personality modifier into the code agent system prompt; types: `security`, `concise`, `educational`, `senior`, `rubber-duck`
- **Wave 562 — `--consensus`** — instructs agent to consider 2–3 implementation alternatives before committing
- **Wave 566 — `--long-context`** — disables shell history injection to preserve context budget
- **Wave 567 — `--quantize-aware`** — adds VRAM/quantization guidance to system prompt (GGUF, AWQ, GPTQ, bitsandbytes)
- **Wave 556 — Shell history context** — last 15 shell commands automatically injected into code agent system prompt for situational awareness (disabled with `--long-context`)

---

## [2.33.0] — 2026-04-03

### Phase 2 — Cluster Intelligence (Waves 461–475)

**Smart Routing**

- **Wave 461 — VRAM-primary routing** — complete rewrite of `findBestNode()` scoring: free VRAM is now the primary factor (200pt penalty if model won't fit; 0–50pt VRAM pressure); replaces the old flat `(100-headroom)*0.3` term that barely moved the needle
- **Wave 462 — Latency-aware routing** — latency contribution reweighted; routing telemetry log now tracks every decision with score, reason, free VRAM MB, and in-flight count
- **Wave 464 — Task-type routing** — `x-task-type: code|chat|math|reasoning` header (or `task_type` body field); `code` tasks auto-try coder model aliases (`code-fast`, `code`, `coder`) before falling back to the requested model
- **Wave 466 — Node health weighting** — thermal penalty baked into routing score: +15pts at >75°C GPU, +50pts at >85°C (throttle territory) — unhealthy nodes lose routing priority automatically
- **Wave 467 — Sticky sessions** — `x-session-id` header keeps a user on the same node for the duration of a conversation (30-min TTL); persists across requests in the same session; clearable via `DELETE /api/v1/routing/sessions/:id`
- **Wave 468 — Hot standby API** — `GET /api/v1/routing/hotstandby` lists all warm models per node; `POST /api/v1/routing/hotstandby` queues a model preload to a specific node
- **Wave 470 — Routing rules API** — `POST/GET/DELETE /api/v1/routing/rules` — in-memory routing rules evaluated before standard routing; match on model name, task type, or session pattern; actions: pin node, force model, set priority, or reject
- **Wave 471 — Routing telemetry** — `GET /api/v1/routing/telemetry` — last 500 routing decisions with node, model, score, reason, free VRAM, in-flight count, task type, and priority
- **Wave 472 — Route explain** — `POST /api/v1/routing/explain` + `tentaclaw route explain <model>` — shows exactly why a request would route to a specific node, all candidate scores, scoring factor definitions, and why no-node errors occur; also `tentaclaw route telemetry`, `tentaclaw route rules`, `tentaclaw route standby`
- **Wave 473 — Least-loaded routing** — in-flight request penalty (40pts each) remains the heaviest single factor; combined with VRAM pressure gives accurate load-aware routing
- **Wave 475 — Cost/speed priority routing** — `x-routing-priority: cost|speed|balanced` header (or `routing_priority` body field); `cost` adds power-draw penalty (prefer low-watt nodes); `speed` subtracts throughput bonus (prefer high tok/s nodes); reflected in `_tentaclaw` response metadata

---

## [2.32.0] — 2026-04-03

### CLI — Local Model Stability (Waves 444–453)

- **Wave 444 — Operator Precedence Fix** — fixed missing parentheses in the Ollama `/api/show` check that caused spurious 2s delays and false architecture detections for LM Studio, llamafile, and all other localhost backends
- **Wave 445 — Inference Timeout + Loading Spinner** — added 120s socket timeout on the inference SSE request (prevents forever-hangs on loaded/stuck Ollama); 5s loading spinner upgrade shows "Loading model into memory…" with recovery commands on timeout
- **Wave 446 — `detectLocalBackend()`** — new async probe function detects which backend is running (Ollama, LM Studio, llamafile, vllm, tabbyAPI, OpenAI, OpenRouter) by probing `/api/tags`, `/health`, `/v1/token/encode`, and port heuristics; result shown in startup banner
- **Wave 447 — BACKEND_CAPS Matrix** — `BackendCapabilities` interface + `BACKEND_CAPS` record; all local backends now get: `tool_choice` omitted, `parallel_tool_calls: false`; Ollama gets `options: { num_ctx: 32768 }` to prevent silent context overflow from its 2048-token default
- **Wave 448 — Ollama Context Management** — SSE parser now reads `finish_reason`; on `'length'` or `'max_tokens'` shows actionable warning with `/compact`, `/new`, and model upgrade suggestions
- **Wave 449 — `edit_file` Whitespace Normalization** — `normalize449` function handles `\r\n`→`\n`, `\r`→`\n`, and trailing whitespace per line before `indexOf`; applied as primary fallback before Wave 216; on failure shows first 20 lines of actual file; writes normalized result back
- **Wave 450 — Aggressive Text Tool Recovery** — expanded from 1 to 4 regex patterns for text-mode tool JSON from local models: standard, reversed, function-wrapped, and markdown code block formats; also handles tools with no arguments
- **Wave 451 — Context Auto-Trim** — when local backend and `messages.length > 22`, auto-keeps system prompt + last 12 messages; finds safe start at first `user` message in tail; logs trimmed count to console
- **Wave 452 — `edit_file` Auto-Re-Read** — when `edit_file` returns "Error: old_text not found", automatically reads the file and appends first 25 lines to the tool result so the model can self-correct on the next turn
- **Wave 453 — Tool Args JSON Hardening** — `try/catch` around `JSON.parse(tc.args)` before executing each tool call; surfaces clear error message with raw args preview instead of silently running with malformed args

---

## [2.31.0] — 2026-04-03

### CLI — First-Agent Design Wizard (Wave 443)

- **Wave 443 — `tentaclaw agent design`** — interactive wizard to design and personalize your coding agent in ~60 seconds: collects your name, role, tech stack, and preferences (writes `USER.md`); lets you pick from four agent personality styles (default TentaCLAW, concise, educational, or custom-named); optionally injects custom coding rules into `AGENTS.md`
- **Setup integration** — `tentaclaw setup` now offers to launch the design wizard immediately after provider configuration, so new users can go from zero to a personalized agent in one flow
- **Standalone command** — also accessible as `tentaclaw agent design`, `tentaclaw agent init`, or `tentaclaw design` at any time to re-personalize

---

## [2.30.0] — 2026-04-03

### CLI — Bootstrap & Session Reliability (Waves 429–432)

- **Wave 429 — Bootstrap immediate deletion** — `BOOTSTRAP.md` is now deleted immediately on injection (not deferred to session end), preventing re-trigger on model failure
- **Wave 430 — Session resume preview** — `--resume` now shows the last user message as a preview line so you remember what you were working on
- **Wave 431 — Empty nudge cap** — nudge loop for empty model responses is now capped at 2 to prevent infinite loops
- **Wave 432 — Token count in session log** — `tentaclaw log` now shows token count alongside message count per session

---

## [2.29.0] — 2026-04-03

### CLI — Agent Reliability & Model Discovery (Waves 441–442)

- **Wave 441 — `tentaclaw recommend --local`** — standalone recommendation (no cluster needed) that detects available system RAM and lists the best Ollama models to install for that hardware tier, from BitNet CPU-only up to 30B workstation models, with ready-to-copy `ollama pull` and `config set` commands
- **Wave 442 — Task mode system prompt injection** — when `--task` is active, an explicit `TASK MODE` section is appended to the system prompt: distinguishes between "use tools immediately" for file/code tasks vs "answer directly" for math/knowledge questions; prevents the model from stalling with "I'll..." instead of acting

---

### CLI — Model Discovery (Wave 441)

- **Wave 441 — `tentaclaw recommend --local`** — standalone recommendation (no cluster needed) that detects available system RAM and lists the best Ollama models to install for that hardware tier, from BitNet CPU-only (0 GB VRAM) up to 30B models for workstation RAM, with `ollama pull` and `config set` commands ready to copy

---

## [2.28.0] — 2026-04-03

### CLI — First-Run Experience & Model Accessibility (Waves 438–440)

- **Wave 438 — Better no-backend error** — when no inference backend is reachable, the error now detects whether Ollama is installed-but-not-running vs not installed at all, and gives the exact fix command in each case, including BitNet for CPU-only setups
- **Wave 439 — RAM-aware setup guidance** — `tentaclaw setup` now detects total system RAM at startup and recommends appropriate model sizes (e.g. "8 GB RAM → hermes3:8b or bitnet-b1.58-3b")
- **Wave 440 — `tentaclaw models <filter>`** — positional argument or `--filter` flag filters the model list by name; e.g. `tentaclaw models qwen` shows only Qwen models

---

## [2.27.0] — 2026-04-03

### CLI — Model Selection & Accessibility (Waves 435–437)

- **Wave 435 — Improved loop detection** — tracks cumulative tool call frequency across the session, not just consecutive pairs; warns and nudges the agent when any identical tool call fires 4+ times
- **Wave 436 — Smarter `tentaclaw setup` model selection** — Ollama model picker now shows estimated VRAM per model, marks recommended coding models with ★, warns ⚠no-tools for gemma/phi/etc; when no models are installed, shows curated options including `bitnet-b1.58-3b` (CPU-only, 1.3 GB) for users without a GPU; `doctor` now flags no-tools models as an issue with recommended alternatives
- **Wave 437 — `tentaclaw models` clarity** — model list now annotates no-tools models with `⚠no-tools` and small models (≤2 GB) with `CPU-ok` so users can immediately see what works with the coding agent

---

## [2.26.0] — 2026-04-03

### CLI — UX & Reliability (Waves 430–434)

- **Wave 430 — Session resume context preview** — when resuming a session, the last user message is shown in the banner so users instantly know what was being worked on
- **Wave 431 — Empty nudge cap** — the Wave 422b empty-response nudge in `--task` mode is now capped at 2 retries to prevent infinite loops when a model is stuck
- **Wave 432 — Token count in `tentaclaw log`** — session log now shows token count per entry (e.g. `4.2K tok`) so users can assess context usage before deciding to resume or start fresh
- **Wave 433 — Architecture-based no-tools detection** — Ollama's `/api/show` endpoint is queried at startup to detect no-tools architectures (gemma3, phi4, etc.) in custom models that don't have the architecture in their name (e.g. `alexa-research:latest` which is gemma3-based)
- **Wave 434 — `tentaclaw setup` no-tools warning** — model selection during setup now warns immediately when a no-tools model is chosen, recommending tools-capable alternatives

---

## [2.25.0] — 2026-04-03

### CLI — Code Agent Reliability (Waves 426–429)

- **Wave 426 — HEARTBEAT task filter fix** — filter now uses regex `/^\s*[-*]\s+\S/` so only real bullet-point lines count as tasks; template prose/comment lines no longer show "2 tasks queued" falsely
- **Wave 427 — `--no-tools` model detection** — `noTools` changed from `const` to `let`; startup warning shown for known no-tools models (dark-champion, gemma, phi, command-r, stablelm); stream error handler detects "does not support tools" and offers to flip `--no-tools` for the session
- **Wave 428 — `write_note` deduplication** — notes already present in MEMORY.md are skipped (written to daily log only) to prevent MEMORY.md bloat across sessions
- **Wave 429 — BOOTSTRAP.md immediate deletion** — BOOTSTRAP.md is deleted the moment it is injected into the first agent message, not deferred to session end; prevents re-triggering onboarding every session when the model fails before completing it

---

## [2.23.0] — 2026-04-03

### CLI — Code Agent Reliability (Waves 423–425b)

- **Wave 423 — `run_shell` clean output in `--print` mode** — live stdout/stderr and exit-code status lines are suppressed when `--print` or `--task` is active; output goes only to the captured tool result fed to the LLM, keeping scripted output clean
- **Wave 424 — `edit_file` auto-read on failure** — when `old_text` is not found, the tool now includes the full file content (up to 80 lines) in the error response so the agent can self-correct with the correct text in the same round-trip, saving an extra `read_file` call
- **Wave 425 — CWD file listing on first message** — when a task involves files/code, the agent's first message is prefixed with `[CWD: ... | files: ...]` so it knows what's in the working directory without needing to call `list_dir` first; skipped for pure knowledge tasks (math, definitions)
- **Wave 422b — empty response nudge** — in `--task` mode, when the model produces an empty response with no tool calls, an automatic nudge re-presents the original task to get the agent back on track

---

## [2.22.0] — 2026-04-03

### CLI — Code Agent Reliability

- **Wave 421 — `read_file` out-of-range validation** — clamps `start_line` to `totalLines` and returns a clear error if `start_line > end_line`, preventing the confusing "Lines 11–5 of 5" header that caused the LLM to stall
- **Wave 422 — `--print` mode fallback** — if the agent calls tools but produces no text response (e.g. list_dir with no summary), the last tool result is printed to stdout so `--task --print` scripting always gets output
- **Tip suppression in `--task`/`--print` mode** — the random 🐙 tip no longer fires when `--task` or `--print` is active, preventing it from polluting piped/scripted output

---

## [2.21.0] — 2026-04-03

### CLI — Bug Fixes

- **`2>/dev/null` on Windows** — stripped all 52 `2>/dev/null` shell redirects from `execSync` calls; they're invalid in Windows `cmd.exe` and were silently breaking every git command (`commit`, `diff`, `branch`, `commits`, etc.) when run from native shell. `stdio: 'pipe'` already captures stderr so the redirects were redundant everywhere.

### CLI — New Commands

- **`tentaclaw push`** — `git push` wrapper; auto-`--set-upstream` on first push; `--force` uses `--force-with-lease`
- **`tentaclaw pull`** — `git pull --rebase` with pre-flight unstaged-change detection: shows stash workflow instead of crashing; friendly messages for "no upstream" and "diverged" cases; `--no-rebase` for merge mode
- **`tentaclaw fetch`** — `git fetch --prune` with branch staleness display (↑ahead / ↓behind / [gone])
- **`tentaclaw branch`** — top-level branch command (list, create `-b`, delete `--delete`) — was REPL-only before
- **`tentaclaw revert <commit>`** — `git revert --no-edit` wrapper with before/after commit preview

### CLI — Existing Command Improvements

- **`tentaclaw commits --since / --until`** — date-range filtering (e.g. `--since "2 weeks ago"`, `--since 2026-01-01`); shown in header when active
- **`tentaclaw commit --no-stage`** — skip `git add -A`, commit only already-staged files
- **`tentaclaw stats --ext <ext>`** — filter statistics to specific extension(s), comma-separated; unknown extensions displayed as uppercase label
- **`/undo` REPL command** — removes last user + assistant exchange (including all tool messages) from context
- **Arg parser: `-n 3` short flag** — single-char flags now accept space-separated values (`-n 3`) and inline `=` form (`-n=3`)

### CLI — Agent Quality

- **`run_shell` — `env` param** — pass extra env vars as `"KEY=val,KEY2=val2"` string; merged with current environment
- **`list_dir` — `show_hidden` param** — include dotfiles/dotdirs in flat and tree listings
- **`read_file` — `count_only` param** — return line count only without reading content; fast pre-check for large files
- **`http_get` — timeout raised to 60s** — was capped at 30s; useful for slow APIs and large file downloads
- **`/grep` REPL** — header now shows `N matches in M files` count
- **System prompt** — Wave 420: "File Size Discipline" — don't grow files beyond what the task requires; trim after writing

---

## [2.20.0] — 2026-04-03

### CLI — New Commands

- **`tentaclaw push`** — `git push` wrapper; auto-sets `--set-upstream` on first push to a remote; `--force` uses `--force-with-lease`; `--tags` passes tag push flag
- **`tentaclaw pull`** — `git pull --rebase` with conflict detection; prints conflict file list when merge conflicts occur; `--no-rebase` for merge mode
- **`tentaclaw fetch`** — `git fetch --prune` with branch staleness display; shows ahead/behind counts and `[gone]` markers for deleted remote branches
- **`tentaclaw branch`** — top-level branch management (was REPL-only); lists with tracking info, `-b <name>` creates+switches, `--delete` removes branch
- **`tentaclaw revert <commit>`** — `git revert` wrapper with commit summary preview; always uses `--no-edit` (no interactive editor); shows resulting new commit hash

### CLI — Agent Quality

- **`read_file` — `count_only` param** — returns just the line count of a file without reading content; fast for large files; useful for pre-check before deciding to read
- **`write_file` — auto-dir reporting** — when the target directory doesn't exist, creates it and reports `[created dir: <path>]` in the return value
- **`/grep`** — match count header now shows total matches and file count: `GREP "pattern" — 12 matches in 3 files`
- **`tentaclaw diff --word`** — word-level diff via `git diff --word-diff=plain`; `[-removed-]` in red and `{+added+}` in green inline within context lines
- **System prompt** — Wave 410: "Commit checkpoints" guidance: commit after each discrete unit of work, don't batch changes, checkpoint before risky refactors, conventional commit message format

---

## [2.19.0] — 2026-04-03

### CLI — New Features

- **`tentaclaw search --replace <text>`** — in-place find-and-replace across all matching files; pure Node.js (no `sed` dependency, works on Windows); supports `--type ts`, `-i` case-insensitive, `--dry-run` preview, and comma-free glob targeting
- **`tentaclaw commit --amend`** — amend the last commit with staged changes; optional new message replaces the last one; `--push` triggers `--force-with-lease` automatically

### CLI — Existing Command Improvements

- **`tentaclaw tree --sizes`** — new flag shows file sizes inline and total size at the bottom of the tree
- **`tentaclaw open`** — now accepts multiple file/URL/dir arguments (space-separated), opening each in the system default app
- **`tentaclaw commit`** — `--amend` path is handled before the normal staged-change check

### CLI — Agent Quality

- **`read_file` — `encoding="hex"` param** — returns a formatted hex dump of the first 256 bytes; replaces the generic "binary file" error for inspectable binary content; error message now mentions this option
- **`glob_files` — `skip_binary` param** — exclude common binary extensions (images, archives, compiled objects, fonts, databases) from pattern-match results
- **`move_file`** — approval prompt now shows source file size for context
- **`/env`** — now shows inference URL, temperature, max-iter, and auto-approve status alongside gateway/model/session
- **`/note @tag:`** — inline tag prefix: `/note @bug: description` saves `[BUG] description` to the daily memory file; confirmation line shows the tag
- **System prompt** — `http_get` strategy note updated to mention `json_path` extraction; `run_shell` note updated to mention `max_output_lines` for noisy commands

---

## [2.18.0] — 2026-04-03

### CLI — New Features

- **`tentaclaw build --watch`** — continuous build watcher; re-runs build on any file change via `fs.watch` with 500ms debounce; Ctrl+C to stop
- **`tentaclaw commits --graph`** — ASCII branch graph via `git log --graph`; teal-colored graph lines alongside short hashes and relative timestamps

### CLI — Existing Command Improvements

- **`tentaclaw todo --flat`** — new output mode: one `file:line:TAG: text` per line, no grouping — easy to pipe or grep further
- **`tentaclaw commits`** — existing compact view unchanged; `--graph` is opt-in
- **`/compact` (no args)** — now shows context stats + menu of options (`summarize`, `tools`, `drop`, `N`) instead of silently running the vague default trim; makes the command self-documenting
- **`run_shell`** — exit status line now includes elapsed time `(Xs)` matching the `/run` output style added in Wave 373

### CLI — Agent Quality

- **`patch_file` — `dry_run` param** — preview which patches succeed/fail without writing the file; use before a large multi-patch edit to validate old_text matches
- **`write_file` — `backup` param** — create a `.bak` copy of the existing file before overwriting; safe recovery if the rewrite goes wrong
- **`search_files` — `whole_word` param** — match only whole words (e.g. `"log"` matches `log(` but not `logger`); passes `--word-regexp` to rg when available, falls back to `\b...\b` regex in pure-Node mode
- **`http_get` — `json_path` param** — extract a specific field from JSON responses using dot notation (e.g. `json_path="choices[0].message.content"`); returns just the value, not the full response body

---

## [2.17.0] — 2026-04-03

### CLI — New Features

- **`tentaclaw test --watch`** — continuous test watcher; for Vitest/Jest uses their native watch modes; for other runners polls via `fs.watch` with a 400ms debounce; Ctrl+C to stop
- **`tentaclaw test` — pass/fail summary** — parses test runner output for `N passed` / `N failed` counts and shows them on the summary line alongside elapsed time

### CLI — Existing Command Improvements

- **`tentaclaw profile`** — now shows git remote URL (origin) and saved session count alongside branch and workspace info
- **`/diff --context N`** — configurable unified diff context lines (`-U N`); use `--context 0` for tight diffs or `--context 10` for more surrounding code
- **`/run`** — elapsed time `(Xs)` shown on the Done/Failed line for all /run executions
- **`/ask @file` expansion** — `@path/to/file.ts` references in `/ask` prompts now expand the file content inline (same as the main REPL input), with a confirmation line per file injected

### CLI — Agent Quality

- **`glob_files` — `modified_since` param** — filter results to files modified within the last N minutes/hours/days (e.g. `modified_since="30m"`, `"2h"`, `"1d"`); combine with `sort="mtime"` for a recent-changes workflow
- **`search_files` — `max_results` param** — expose the file limit as a parameter (default 20, max 100) instead of a hardcoded constant
- **System prompt — efficiency rules** — Wave 380 adds an explicit section reinforcing "search before reading", glob with `modified_since`, and `read_file(grep=)` as the efficient path; never glob-then-read-all
- **TIPS** — 7 new rotation tips covering grep param, file_type shorthand, nth_occurrence, /symbols, modified_since, /diff --context, and /ask @file syntax

---

## [2.16.0] — 2026-04-03

### CLI — New Commands

- **`tentaclaw clone <url> [<dir>]`** — clone a git repository with streaming output and a ready-to-run hint; no dependencies beyond git

### CLI — Existing Command Improvements

- **`tentaclaw fmt --check`** — new flag for CI: verifies files are correctly formatted and exits non-zero if not; maps to `--check` / `--check` / `black --check` per formatter
- **`tentaclaw search -B N -A N`** — separate before/after context flags (ripgrep pass-through) for asymmetric context windows around matches
- **`tentaclaw snapshot diff [ref]`** — show colored diff between the current working tree and a saved snapshot; supports per-file stats header
- **`tentaclaw stash` completions** — added to shell completion scripts

### CLI — Agent Quality

- **`edit_file` — `nth_occurrence` param** — when `old_text` appears multiple times, target the Nth match (1=first, 2=second, etc.) instead of failing with an ambiguity error; error message now lists all recovery options
- **`delete_file` — `dry_run` param + batch paths** — preview deletions before committing; comma-separate multiple paths for batch deletion in a single call
- **`list_dir` — `sort` param** — sort flat directory listings by `mtime` (newest first, shows timestamps) or `size` (largest first)
- **`/symbols` and `/bench` added to `/help` listing**
- **`/focus` multi-file** — `/focus file1.ts file2.ts` injects multiple files at once as pinned session context
- **`/bench [--n N] <cmd>`** — run a shell command N times and display per-run timing with avg/min/max summary (benchmarking inside the REPL)
- **System prompt** — updated Tool Strategy section with concrete guidance on grep param, file_type shorthand, nth_occurrence, and list_dir sort options

---

## [2.15.0] — 2026-04-03

### CLI — New Commands

- **`tentaclaw stash [list|pop|apply|drop|clear] [--msg <m>] [--index N]`** — git stash wrapper: push WIP with an auto-timestamped message, list stashes, pop/apply by index, drop, or clear all stashes

### CLI — Existing Command Improvements

- **`tentaclaw diff --stat`** — new flag shows per-file breakdown (file · `+ins -del` bar chart) like `git diff --stat`, instead of the full patch
- **`tentaclaw todo --file <path>`** — scan a specific file (or comma-separated list) instead of walking the whole tree; new `--json` flag outputs raw JSON for scripting
- **`tentaclaw watch --once`** — run the watched command once and exit (useful for pre-commit hooks and CI); no file-watching loop
- **`tentaclaw search`** — new `file_type` shorthand (`ts`, `py`, `go`, `rs`, `md`, `json`, etc.) that sets `--glob` automatically; avoids having to remember glob syntax
- **`glob_files` agent tool** — new `exclude` parameter (comma-separated glob patterns) to skip specific files or directories during pattern matching

### CLI — Agent Quality

- **`read_file` tool — `grep` param** — filter file content to lines matching a regex pattern before returning; includes 2 lines of context around each match (configurable via `grep_context`); returns early with match count when no matches found — saves context by avoiding full-file reads for pattern lookups
- **`/symbols <file>` REPL command** — pattern-based extractor shows functions, classes, interfaces, types, and top-level consts with line numbers; works for TypeScript, JavaScript, Python, Go, and Rust
- **Context growth warning** — after every 10th user exchange, shows a dim hint to run `/compact summarize` to save tokens

---

## [2.14.0] — 2026-04-03

### CLI — New Commands

- **`tentaclaw memory stats`** — show workspace memory usage: file count, total bytes, last-modified time for MEMORY.md; gives a clear snapshot of how much agent memory has accumulated

### CLI — Agent Quality

- **`write_note(note, persist=true)`** — the `write_note` tool now accepts an optional `persist` flag; when `persist=true`, the note is appended to both the dated daily note file *and* `MEMORY.md`, allowing the agent to bookmark facts that survive across sessions without a manual memory edit
- **System prompt — Memory section** — clarified agent memory guidance: use `write_note(persist=true)` for cross-session facts (preferences, architecture decisions, gotchas), use `write_note()` for transient session notes, reserve direct `edit_file`/`write_file` to MEMORY.md for full structured updates; agent now writes memory proactively without asking permission

---

## [2.13.0] — 2026-04-03

### CLI — New Commands

- **`tentaclaw ping [--n N]`** — measure gateway round-trip latency: runs N pings (default 3), shows per-ping bar chart and avg/min/max summary

### CLI — Existing Command Improvements

- **`tentaclaw doctor`** — now also checks: ripgrep (`rg`) availability with install hint; `.clawcode` presence in cwd; `.clawignore` pattern count
- **`tentaclaw sessions clean [days] [--keep N]`** — new `--keep <N>` flag protects the N most recent sessions regardless of age; output now shows bytes freed
- **`tentaclaw code` banner** — now shows `timeout: Xs` and `max-iter: N` hints in the startup line when those flags are set
- **`list_dir` tool** — now inherits `.clawignore` directory exclusions in addition to the built-in skip set (node_modules, dist, etc.)
- **`edit_file` spinner summary** — now shows `+N lines / -N lines` delta alongside the old text preview for at-a-glance diff size awareness

### CLI — Agent Quality

- **`.clawignore` + `list_dir` integration** — directory segments from `.clawignore` are merged into the `LIST_SKIP` set so the model doesn't try to descend into ignored directories during tree exploration

---

## [2.12.0] — 2026-04-03

### CLI — New Commands

- **`tentaclaw show <session-id>`** — *(continued from v2.11)* formatted conversation transcript viewer with turn numbering, tool result previews, and resume hint

### CLI — Existing Command Improvements

- **`/history [N]`** — now shows tool call count per exchange (`[2 tools]`); restructured to pair user/assistant messages by turn number for easier reading
- **`/retry [modified prompt]`** — *(v2.11 addition)* now confirmed working: accepts optional tweaked prompt text before retrying the last exchange
- **`tentaclaw todo [--type <tag>]`** — new `--type FIXME|TODO|HACK|BUG` filter flag; results now sorted by priority (FIXME/BUG → TODO → HACK → WARN → OPTIMIZE → REFACTOR)
- **`tentaclaw search`** — new `--count` flag prints match counts per file sorted by frequency; new `--files` / `-l` flag lists only files with matches (both work with or without rg)
- **`tentaclaw init`** — now also creates `.clawignore` alongside `.clawcode`; `.clawignore` pre-filled with project-appropriate exclusion patterns (node_modules, dist, *.lock, lang-specific dirs)
- **`tentaclaw watch`** — timing shown per run; debounce confirmed working for IDE burst-save scenarios
- **Thinking block display** — when a model outputs `<think>…</think>` blocks (deepseek-r1, QwQ), the REPL now shows `🧠 thought for Xs` with actual duration after the thinking completes

### CLI — Agent Quality

- **`.clawignore` support** — the agent's `read_file` tool now respects `.clawignore` patterns: files matching exclusion rules return a skip message instead of content; the module-level `_clawIgnorePatterns` array is populated by `cmdCode` on startup and shared with `executeCodeTool`

---

## [2.11.0] — 2026-04-03

### CLI — New Commands

- **`tentaclaw commits [--n N] [--author <name>] [<file>]`** — pretty-printed git commit history: short hash, message, author, relative time; checkpoint commits shown dimmed; filter by author or file path
- **`tentaclaw blame <file> [--line <n>]`** — git blame output with color coding: hash, author, date, line number; `--line N` focuses the view around that line (±5 lines) with the target line highlighted
- **`tentaclaw show <session-id>`** — formatted conversation transcript viewer: renders user/agent exchanges with turn numbers, previews tool results, ready to resume with `--resume`

### CLI — Existing Command Improvements

- **`tentaclaw explain <file[:start[-end]]>`** — now supports line ranges: `tentaclaw explain src/index.ts:100-200` explains only those lines; single line `file:100` also works; prints what range is being explained before inference
- **`tentaclaw diff [--staged] [<file|ref>]`** — new `--staged` / `--cached` flag to show only staged changes; git SHA / `HEAD` positional argument for comparing against a ref; stat header now shows diff mode (staged / unstaged / vs ref)
- **`tentaclaw commit [--push] [--dry-run]`** — new `--dry-run` shows files that would be committed without committing; new `--push` flag auto-pushes to remote after a successful commit
- **`tentaclaw watch`** — debounced triggers: rapid saves (IDE auto-save bursts) now batch into a single re-run after 300ms quiet period; shows elapsed time per run
- **`tentaclaw code --timeout <s>`** — new flag: stop agent loop after N wall-clock seconds (e.g. `--timeout 120` for CI budgets)
- **`tentaclaw ask --file <path>`** — inject one or more file contents into the question (comma-separated); works alongside stdin
- **`/retry [modified prompt]`** — now accepts an optional argument to tweak the prompt before retrying (previously only retried exact same message)
- **`/cd <dir>`** — REPL prompt now updates to show current directory basename after changing directory

---

## [2.10.0] — 2026-04-03

### CLI — New Commands

- **`tentaclaw snapshot [save|restore|drop|list] [name]`** — save/restore named working-tree states via git stash; `save [name]` creates a labeled stash, `restore [ref]` pops it back, `list` shows all TentaCLAW snapshots
- **`tentaclaw profile`** — concise environment overview: gateway URL, model, workspace dir, cwd, platform, git branch, config file location
- **`tentaclaw diff`** improvements — now shows a stat summary header: `N files changed  +insertions  -deletions`

### CLI — Slash Commands (new)

- **`/inline <cmd>`** — run a shell command and inject its output into context as a fenced code block; great for injecting `git log`, `npm ls`, `cargo check` output
- **`/pin-context [text]`** — set persistent text prepended to every agent message; `/pin-context` with no args clears it; shown in `/status`
- **`/tokens`** — quick breakdown of session token usage: input tokens, output tokens, total, requests made, average per request
- **`/tag <label>`** (also `/label`) — set a human-readable label on the current session for easy identification in `tentaclaw log`
- **`/reload`** — shorthand for `/workspace reload`; reloads SOUL.md, MEMORY.md, etc. into the system prompt without restarting
- **`/model list [filter]`** — `/model` now supports `list [query]` sub-command to browse and filter available cluster models by name

### CLI — Existing Command Improvements

- **`tentaclaw ask`** — now supports `--sys <text>` (custom system prompt), `--temp N` (temperature), `--max-tokens N` (response length limit), and `--json` (output structured JSON `{response, model, tokens}`)
- **`tentaclaw watch`** — now shows which files changed in each trigger (file names, relative paths, `+N more` for large batches)
- **`tentaclaw code --resume`** — new `--no-history` flag: resumes the session ID for log continuity but starts with a clean context
- **`/clear`** — now shows how many messages were removed
- **`/save [label]`** — now accepts an optional label argument to name the session at save-time
- **`--checkpoint` commits** — improved commit messages: now use `tentaclaw(verb): relative/path` format instead of just basename
- **Memory search** — now shows line numbers and hit counts per file; searches last 10 daily notes (not just MEMORY.md)
- **`/status`** — now shows pinned context if `/pin-context` is active
- **Code agent banner** — now warns when there are uncommitted git changes on startup

### CLI — Agent Quality

- **Task mode modified-files summary** — after a `--task` run completes, modified git files are now listed alongside the token/tool-call summary
- **`/status` pinned context display** — `/status` now shows the current pinned context string if one is active via `/pin-context`

---

## [2.9.0] — 2026-04-02

### CLI — New Commands

- **`tentaclaw diff [file]`** — color-coded git diff: `+` lines in green, `-` lines in red, `@@` hunks in teal, file headers bold white; staged changes shown if working tree is clean
- **`tentaclaw log [-n N]`** — compact session log: today's sessions highlighted in green, quick resume reference, model and message count at a glance
- **`tentaclaw init`** — scaffold a `.clawcode` project context file (auto-detected project type, build/test commands pre-filled; file is auto-loaded by the agent on every session)
- **`tentaclaw fmt [path]`** — auto-format using project's formatter: detects prettier, eslint, gofmt, cargo fmt, black; falls back gracefully with instructions
- **`--json` flag for `code`** — outputs final result as a JSON object `{"response":"...","tool_calls":N,"tokens":N,"model":"..."}` for scripting and integration

### CLI — Slash Commands (new)

- **`/retry`** — re-runs last prompt after removing the previous response from context; useful when model gives a bad answer
- **`/env`** — shows session environment: gateway URL, model, session ID, token count, request count, message count, cwd, and current git branch
- **`/undo` improvements** — now shows tool call counts removed and the last prompt text; hints about `/retry` for re-running

### CLI — Additional Commands

- **`tentaclaw test [args]`** — auto-detects and runs test suite: npm test, vitest, jest, cargo test, pytest, go test; color-coded output (red failures, green passes)
- **`tentaclaw lint [path]`** — auto-detects and runs linter: eslint, biome, cargo clippy, go vet, flake8; shows errors in red, warnings in yellow
- **`tentaclaw watch <cmd>`** — zero-dependency file watcher: re-runs command on any file change; `--glob` filter, `--dir` scope; 800ms debounce
- **`tentaclaw tree [dir]`** — pretty directory tree with `--depth N` and `--all` for hidden files; dirs in teal, files dimmed
- **`tentaclaw todo [dir]`** — scan codebase for TODO/FIXME/HACK/BUG comments; grouped by tag type with file:line references

### CLI — Agent Tools & UX

- **`@file` inline syntax in REPL** — type `@src/index.ts` in any message to auto-inject file content as a fenced code block; shows injection confirmation
- **`--max-tokens N` flag for `code`** — pass `max_tokens` to model (e.g. `--max-tokens 500` for short answers)
- **`/grep <pattern>` slash command** — search conversation context with regex; shows role, message index, and line number for each match
- **`tentaclaw init`** — create `.clawcode` project context file with auto-detected type, build and test commands; auto-loaded by agent on every session
- **Improved context estimate** — now includes tool result content in token estimate; tiered warnings at 70%/80%/90% with severity-appropriate hints

### CLI — Agent Quality

- **Temperature auto-reduction on nudge (Wave 257)** — when the agent is stuck and a nudge fires, `agentTemperature` drops by 0.2 (min 0.0); makes the model more deterministic on retry without affecting normal operation
- **`asksPermission` recovery** — detects "Do you want me to proceed?" style responses after tool calls → auto-approves with "Yes, proceed. Auto-approved. Make the change now."
- **`hasSuccessfulEdit` gate** — prevents nudge from firing after a successful `edit_file`/`write_file`/`create` result; avoids double-edits and wrong-token hallucinations
- **Nudge limit raised to 2** — `intentionNudgeCount` cap raised from 1 to 2 per `runAgentLoop` call for stubborn models
- **Read-first reminder on edit tasks** — for first-message edit/fix tasks that mention a file, appends `[REMINDER: read_file first]` to help models that skip the read step
- **`--json` mode streaming suppression** — in `--json` mode, token chunks no longer stream to stdout; entire response is collected and output as single JSON object at completion
- **Usage event on nudge path** — usage events now also emitted on nudge iterations (previously only emitted on final-answer iterations); ensures JSONL always contains `"usage"` data even for sessions that only nudged

---

## [2.8.0] — 2026-04-03

### CLI — New Commands

- **`tentaclaw ask "<question>"`** — fast inline inference: no workspace loading, no tools, no splash screen; perfect for quick questions and pipe input (`git log | tentaclaw ask "summarize"`)
- **`--print` flag for `code`** — scripting mode: suppresses all decorative output (splash, spinner, tok/s, tool display, task/done lines); only streams the model's response to stdout; trailing newline guaranteed
- **`--stdin` flag for `code`** — explicitly reads from stdin and prepends to task (`git diff | tentaclaw code --stdin --task "write commit msg"`)

### CLI — Agent Tools (improved)

- **`run_shell` `cwd` parameter** — run commands in a specific directory without `cd &&` chaining; absolute or relative to current cwd
- **`run_shell` ANSI stripping** — ANSI escape codes from build output are stripped from the model context (keeps visible output colorized but feeds clean text to LLM)
- **`run_shell` smart truncation** — when output exceeds 8000 chars, keeps head + tail (not just head) so errors at end of long output aren't lost
- **`http_get` JSON pretty-printing** — JSON API responses are auto-formatted with indentation for better model comprehension
- **`--model` fuzzy match** — `--model gemma3` matches `gemma3:8b`; prefix matching against available model list

### CLI — New Commands

- **`tentaclaw commit [msg]`** — top-level commit command; stages everything and commits; if no message given, generates one with the LLM using `git diff --stat`
- **`tentaclaw explain <file>`** — reads a file and explains it (no-tools, streams directly)

### CLI — Slash Commands (new)

- **`/branch [name|-b name]`** — list branches, switch branch, or create new branch (`/branch -b feature/foo`)
- **`/compact tools`** — drop all tool result messages (keeps assistant analyses); frees the most context when model has already processed file reads

### CLI — Agent Quality

- **Improved nudge message** — Case B (premature stop) nudge now: (1) quotes the original task as a reminder, (2) explicitly says "call edit_file/write_file — do NOT call write_note or claim you've already done it"
- **`claimsAction` detection** — new nudge trigger: when model says "confirmed/replaced/made the change" without any `Edited:` tool result in context, it's hallucinating completion → nudge fires to make the actual change

---

## [2.7.0] — 2026-04-03

### CLI — Agent Tools (new)

- **`patch_file`** — apply multiple `{old_text, new_text}` patches to a file in one call; faster for 3+ edits; whitespace-tolerant fallback; detailed per-patch status
- **`http_get` POST support** — `method: "POST"` with `body`; auto Content-Type detection (JSON vs plain text); updated result includes status code
- **`run_shell` `max_output_lines`** — cap returned output to N lines keeping head + tail; useful for noisy builds

### CLI — Slash Commands (new)

- **`/run [script]`** — smart project runner: lists npm scripts, make targets, cargo/pytest shorthands; detects project type; falls back to raw shell command
- **`/edit <file>`** — opens file in `$EDITOR` (or `nano`/`notepad`) and returns to session when editor exits
- **`/note <text>`** — quick-write note to today's memory file without going through the agent; timestamped entry
- **`/load <url>`** — `/load` now accepts URLs as well as file paths; fetches, strips HTML, injects into context

### CLI — Agent Quality

- **Stalled-intention recovery (Wave 235)** — detects when model says "I will use [tool]" without calling it, nudges once; also detects short text responses after tool calls that look like premature stops ("The file contains…" → nudge to continue)
- **Invalid tool name recovery** — when model outputs JSON attempting to call a non-existent tool, asks it to answer directly instead
- **Git branch in `/status`** — shows current branch and dirty file count alongside other session info
- **`edit_file` smarter "not found" hint (Wave 234)** — shows a 5-line context window around nearest match candidates with exact `read_file` range hint
- **Daily memory note cap** — workspace loader truncates daily memory notes to 4000 chars (tail-first — keeps recent entries); prevents context bloat from large memory files
- **`autoApprove` persists from config** — `tentaclaw config set autoApprove true` now respected on startup
- **System prompt: direct-answer guidance** — instructs agent to answer knowledge questions without tools; prevents JSON-tool-call noise for simple queries

---

## [2.6.0] — 2026-04-03

### CLI — Agent Tools

- **`search_files` ripgrep acceleration** — uses `rg` if available (10-100x faster on large codebases); falls back to pure Node.js walker
- **`search_files` `context_lines`** — lines of context shown around each match (default 2); proper per-match context with separators between non-adjacent ranges
- **`search_files` match indicator** — matching line shown with `▶` marker; context lines with `:`
- **`glob_files` `sort`** — `"mtime"` (newest first), `"size"` (largest first), or `"name"` (default); mtime shows timestamp
- **`list_dir` `depth`** — recursive tree view (1–4 levels); uses Unicode box-drawing characters; skips heavy dirs
- **`read_file` line-range shorthand** — `path:100-200` parsed automatically (e.g. `src/index.ts:50-100`)
- **`read_file` binary detection** — detects binary files via null-byte scan; returns actionable error instead of garbled output
- **`run_shell` cwd display** — shows working directory in approval prompt and auto-approve banner
- **`run_shell` error pattern hints** — auto-detects common exit failures (command not found, EADDRINUSE, MODULE_NOT_FOUND, permission denied) and injects fix hints
- **`http_get` `timeout_secs`** — configurable request timeout (default 10, max 30)
- **`edit_file` whitespace-tolerant fallback** — when exact match fails, retries with normalized whitespace and applies if unique; significantly reduces model-side edit failures
- **`edit_file` diff with line numbers** — result shows `L42: - old` / `L42: + new` format so model can verify placement
- **`write_file` delta summary** — result includes line delta (`+3 lines`, `±0 lines`, etc.) for model verification

### CLI — Slash Commands (new)

- **`/diff [--staged|<file>]`** — upgraded: shows real colored unified diff output with `@@` hunks highlighted; `--staged` for staged changes
- **`/grep <pattern> [glob]`** — instant project search using ripgrep or Node.js walker; injects results into context
- **`/find <glob>`** — quick file finder without going through the LLM; shows file sizes
- **`/git [status|log|add|commit|stash]`** — quick git operations in REPL without leaving context
- **`/todo`** — scans project for TODO/FIXME/HACK/BUG comments; color-coded by severity
- **`/commit [msg]`** — smart commit: stages all changes and auto-generates commit message from changed files
- **`/compact summarize`** — LLM-powered context compression: summarizes full session into 300-word digest, replaces context

### CLI — Agent Quality

- **Changed files indicator** — after each agent response, shows modified files from `git diff --name-only` (when in a git repo)
- **Project layout injection** — system prompt auto-includes top-level directories + key files when no CLAUDE.md/AGENTS.md present
- **Token budget visual bar** — `/status` now shows `████░░░░░░ 42%` bar with color coding (green→yellow→red)
- **Session duration in `/status`** — shows time elapsed since session start
- **CWD shows `~` shorthand** — home dir abbreviated in status and run_shell prompt
- **`/compact summarize`** — replaces full message history with LLM-generated summary (preserves system prompt)

### CLI — Slash Commands (improved)

- **`/help` expanded** — now lists `/find`, `/grep`, `/git`, `/todo`, `/commit` with descriptions
- **`/compact` tip updated** — suggests `summarize` option in tip line

---

## [2.5.0] — 2026-04-02

### CLI — Agent Tools (15 tools total)

- **`write_note`** — new tool: append a timestamped note to daily memory file without touching code; supports optional tag
- **`write_file` append mode** — `mode:"append"` adds to file end
- **`edit_file` `replace_all`** — replaces all occurrences when true; error message suggests it when multiple matches found
- **`search_files` `case_sensitive`** — optional case-sensitive search
- **`search_files` `exclude`** — comma-separated extra dirs to skip
- **`glob_files` `skip_dirs`** — skip additional dirs beyond defaults; also skips node_modules/dist by default
- **`http_get` redirect following** — auto-follows up to 3 redirects; was returning `Redirect: <url>` before
- **`list_dir` summary** — `N directories, N files` footer line
- **`read_file` smarter truncation** — when truncating large files, shows exact line ranges to read next section, middle, and end
- **`write_note` summarizer** — tool arg display shows tag + first 60 chars

### CLI — Agent Quality

- **Loop detection** — same tool+args called twice in a row injects a corrective hint
- **`/ask <question>`** — quick question without tool calls or context growth (uses current messages as context)
- **`/inject <text>`** — inject text as assistant message for context steering
- **`/forget <text>`** — removes all messages containing matching text
- **`/checkpoint [msg]`** — on-demand git commit inside REPL
- **`/history [N]`** — show last N exchanges from context
- **`/models`** — list available cluster models; shows active marker
- **`/compact drop`** / **`/compact N`** — drop old exchanges entirely or keep last N
- **Context budget nudge** — inline warning at 75%/90% every 5 exchanges
- **Tool multi-call label** — shows `[1/3]` when multiple tools called in one round
- **Tool result colors** — errors red, write/edit success green, diff lines colored
- **Exit code display** — `✓ Exit 0` / `✗ Exit N` after each `run_shell`

### CLI — Session UX

- **Session auto-title** — first user message becomes session label
- **Session duration** — shown on `/quit` (e.g. `(12m 34s)`)
- **`sessions list`** — shows title column alongside model and message count
- **`sessions export <id>`** — Markdown export (or `--format jsonl`)
- **`sessions rename <id> <title>`** — rename session label
- **`--last`** — resume most recently updated session
- **Task mode summary** — shows exchange count, tool calls, tokens after `--task` completes
- **`/status`** — shows tool call count, session label, TTFT
- **Context budget** — `⚠ Context ~N% full` inline nudge every 5 exchanges

### CLI — Startup Banner

- **Git branch** — shows `[branch-name]` in startup line
- **Project stack** — detects Node.js/Rust/Go/Python/Java/etc. from project files
- **Workspace context size** — shows `(N.Nkb)` after workspace file list
- **Session ID** — shortened to 8 chars in banner for readability

### CLI — Flags

- **`--temp <value>`** — set initial agent temperature (0.0–2.0)
- **`--max-iter <N>`** — limit agent iterations (default 20, max 50)
- **`--no-tools`** — pure chat mode (no file/shell tools)
- **`--checkpoint`** — auto-git-commit after each write/edit

### CLI — Other

- **`tentaclaw benchmark`** — alias for `tentaclaw benchmarks`
- **`tentaclaw run` reads stdin** — `echo "task" | tentaclaw run` for scripting
- **Doctor check** — verifies git is installed and usable
- **Improved system prompt** — structured with headers, error recovery guide, per-tool tips

---

## [2.4.0] — 2026-04-02

### CLI — Agent Quality

- **Improved system prompt** — Act/don't-ask principle, tool strategy guide, error recovery instructions
- **Thinking indicator with elapsed time** — spinner now shows seconds while model thinks (e.g. `⠋ 2.3s`)
- **TTFT display** — time-to-first-token shown alongside tok/s after each response
- **Session auto-title** — first user message becomes session label (visible in `sessions list` and `/sessions`)
- **`--last` / `--continue`** — resume the most recently updated session without knowing the ID
- **`--temp <value>`** — set initial temperature from CLI flag (0.0–2.0)
- **`--no-tools`** — run code agent as pure chat (no file/shell tools)
- **`--checkpoint` in help** — documented in `tentaclaw help`

### CLI — Slash Commands

- **`/checkpoint [msg]`** — on-demand git commit inside the REPL; shows files committed
- **`/history [N]`** — show last N conversation exchanges from context
- **`/models`** — list available cluster models; shows active model with arrow
- **`/compact drop`** — drop old exchanges entirely (not just truncate); `/compact N` keeps last N
- **`/status`** — now shows session label if auto-title is set

### CLI — Tool Improvements

- **`summarizeToolArgs`** — per-tool readable summaries: `read_file` shows path:range, `run_shell` shows `$ cmd`, `edit_file` shows `"old…" → "new…"`, etc.
- **`http_get`** — HTML stripped automatically: `<script>`, `<style>`, tags removed for cleaner output
- **`read_file`** — header now includes file size and last-modified timestamp
- **`glob_files`** — results include file sizes (e.g. `src/index.ts (142.3kb)`)
- **`write_file` diff preview** — shows actual changed lines (red/green) not just line count delta
- **Approval prompt** — `[y/N]` now shows `y` in green for clarity

### CLI — Sessions

- **`sessions export <id>`** — export session as formatted Markdown (or `--format jsonl` for raw)
- **`sessions rename <id> <title>`** — rename a session label
- **`sessions list`** — shows session title column alongside model and message count
- **`/sessions`** — shows session label inline
- **`sessions export`** — added to usage hint

### CLI — New Commands

- **`tentaclaw benchmark`** — alias for `tentaclaw benchmarks`

### CLI — More Slash Commands

- **`/ask <question>`** — quick question without tool use or context growth
- **`/forget <text>`** — remove messages containing matching text from context
- **`/history [N]`** — show last N conversation exchanges

### CLI — More Tool Improvements

- **`write_file` append mode** — `mode:"append"` adds to file end instead of overwriting
- **`edit_file` `replace_all`** — replace all occurrences when set to true
- **`search_files` `case_sensitive`** — optional case-sensitive search parameter
- **`http_get` redirect following** — auto-follows up to 3 redirects
- **`list_dir` summary** — shows `N directories, N files` count at bottom
- **Tool result colors** — errors in red, write/edit successes in green, diff lines colored

### CLI — Agent Reliability

- **Loop detection** — detects when agent calls same tool twice with same args; injects corrective hint
- **Exit code display** — `run_shell` shows `✓ Exit 0` or `✗ Exit N` after each command
- **`--max-iter <N>`** — limit agent iterations (default 20, max 50)
- **`--temp <value>`** — set initial temperature
- **Git branch in banner** — shows `[branch-name]` in startup line
- **Stack detection** — detects project language (Node.js/Rust/Go/Python/etc.) in banner
- **Task mode summary** — shows exchange count, tool calls, tokens after `--task` completion
- **`/status` shows tool call count** — running session tool call total in status display

---

## [2.3.0] — 2026-04-02

### CLI — Code Agent Quality

- **`/plan <task>`** — ask agent to outline numbered steps before executing; keeps complex tasks on track
- **`/share [path]`** — export current session as formatted Markdown (user + TentaCLAW turns, tool previews)
- **`--checkpoint` / `--cp`** — auto-commit to git after every successful write/edit/delete tool call
- **`run_shell` streaming** — output now streams to terminal in real-time instead of buffering until done
- **`run_shell` timeout_secs** — configurable per-call timeout (default 60s, max 300s)
- **`write_file` diff preview** — when overwriting, shows old line count → new line count before approval
- **`read_file` line numbers** — every line prefixed with its number (`  1: ...`) so agent can target edits precisely
- **Multi-line input** — lines ending with `\` continue to the next line in the REPL; prompt changes to `. `
- **`.clawcode` parent walk** — searches cwd + 4 parent dirs for `.clawcode` / `CLAUDE.md` / `AGENTS.md`
- **HEARTBEAT.md injection** — non-empty tasks are injected into system prompt at session start

### CLI — New Commands

- **`tentaclaw run "<prompt>"`** — one-shot shorthand for `code --task "..." --yes`
- **`tentaclaw workspace [show|open|reset]`** — inspect workspace directory and file sizes
- **`tentaclaw memory [show|edit|clear|search]`** — view and manage MEMORY.md + daily notes
- **`tentaclaw ws`** — alias for `tentaclaw workspace`
- **`tentaclaw init`** — project init: creates `.clawcode` with detected stack/test/build info

### CLI — Tool Improvements

- **`list_dir`** — now shows file sizes (e.g. `script.sh  (4.2kb)`)
- **`search_files`** — improved: relative paths, context lines (1 before/after), 20-file / 10-hit limits
- **`glob_files`** — new: find files by glob pattern (e.g. `**/*.ts`)
- **`http_get`** — new: fetch a URL for docs/API lookups (truncated to 8000 chars)

### CLI — Doctor Expanded

- **MEMORY.md check** — reports how many facts are stored
- **Sessions disk usage** — warns if sessions directory exceeds 100MB; prompts `tentaclaw sessions clean`

---

## [2.2.0] — 2026-04-02

### CLI — MCP Integration

- **`tentaclaw mcp serve`** — run TentaCLAW as an MCP server (Model Context Protocol); exposes `cluster_status`, `list_nodes`, `list_models`, `list_alerts`, `chat_completion` tools to Claude Desktop and any MCP client
- **`tentaclaw mcp info`** — print Claude Desktop config snippet for one-step MCP integration

### CLI — New Tools for Code Agent (11 tools total)

- **`glob_files`** — find files by glob pattern (`**/*.ts`, `src/**/*.test.js`) — faster than recursive list_dir
- **`http_get`** — fetch a URL (docs, APIs, raw GitHub files) — agent can read documentation inline
- **`search_files` improved** — now returns relative paths, context lines (1 before/after), up to 20 files / 10 hits per file

### CLI — New Commands

- **`tentaclaw logs [--filter <str>]`** — stream live gateway SSE events to terminal; Ctrl+C to stop
- **`tentaclaw agents`** — list named agent workspaces with file counts and MEMORY.md size
- **`tentaclaw init`** — create `.clawcode` project config in current directory; auto-detects stack, test runner, build command
- **`sessions stats`** — aggregate session analytics: total messages, tokens, tool calls, top model
- **`sessions search`** improved — shows session date alongside matched content

### CLI — Agent Quality

- **`/workspace reload`** — reload workspace files into system prompt without restarting the session
- **`/think` wired up** — actually sets `temperature` in inference body (was display-only before)
- **`--headless`** flag — implies `--yes`, designed for scripting and CI use
- **Session summary on `/quit`** — prints exchange count, tool call count, tokens used, files touched
- **`edit_file` diff output** — tool result includes compact `- old / + new` line diff so agent can verify changes
- **`--agent <name>`** workspace override correctly applied before `ensureWorkspace()` call
- **System prompt** — updated to mention `glob_files`, `http_get`, and tool usage tips
- **TOOLS.md** workspace file — now includes tool reference table

### Help & UX

- **`help` expanded** — `SETUP`, `SESSIONS`, `AGENT`, and `CLUSTER` sections updated with all new commands
- **`code` flags documented** — `--agent`, `--task`, `--file`, `--resume`, `--headless` all shown in help

---

## [2.1.0] — 2026-04-02

### CLI — Quality of Life

- **`sessions clean [days]`** — delete sessions older than N days (default: 30), prints count removed
- **Session index auto-trim** — `sessions.json` capped at 500 entries (oldest pruned automatically)
- **Chat usage events** — `{ type: 'usage' }` event emitted after each chat turn; session meta updated per-turn (not just on quit)
- **`code --file <path>`** — load a file as the initial task; combines with `--task` if both given
- **Streaming tok/s** — output tokens/second displayed inline after each code agent response
- **Token budget warning** — `/status` shows yellow/red warning at 75%/90% of 128k context budget
- **Model-not-found hint** — HTTP 4xx in code agent loop shows `ollama pull <model>` suggestion
- **`doctor` expanded** — checks config dir writability and presence of `config.json.bak`
- **`setup` connection test** — verifies backend reachability immediately after saving config
- **`search_files` regex** — `use_regex: true` enables JavaScript regex patterns in `search_files` tool
- **`read_file` line range** — `start_line` / `end_line` params for windowed reads; BOM strip
- **`benchmark-multi.ps1`** — side-by-side model comparison benchmark with results table

### Docs

- `docs/WORKSPACE.md` — workspace system: files, memory write-back, BOOTSTRAP.md onboarding
- `docs/SESSIONS.md` — sessions system: event types, CLI commands, JSONL format, cleanup

### Tests

- `test-cli.ps1` — 92 assertions (up from 82): sessions clean, version alias, chat usage event, `--file` flag, doctor expanded, tok/s display

### Infra

- `.gitignore` — expanded: `dist/`, `*.bak`, `gateway/data/`, `test-proof/`, etc.

---

## [2.0.0] — 2026-04-02

### CLI — AI Coding Agent (major feature)

- **`tentaclaw code`** — full agentic code loop: reads files, writes files, edits files, runs shell commands, searches codebases, iterates until done
- **`edit_file` tool** — surgical `old_text → new_text` replacement, no full-file rewrites, with multiple-match detection and nearby-lines hints on failure
- **`create_directory`, `delete_file`, `move_file`, `copy_file`** — complete file management toolset (9 tools total)
- **`search_files`** — pure Node.js implementation, works on Windows/Linux/macOS without grep
- **Streaming chat** — `tentaclaw chat` now streams token-by-token via SSE, no more blank-screen wait
- **Shell shortcut** — prefix `! <cmd>` in the REPL to run directly without LLM
- **`/cd <path>` and `/cwd`** — directory navigation inside the REPL
- **`/usage`** — token counts + cost estimate (FREE for local Ollama, USD for cloud)
- **Workspace protocol** — `AGENTS.md` (operating protocol) and `TOOLS.md` (environment notes) added to the 4-file workspace system
- **`BOOTSTRAP.md`** — first-run onboarding: agent asks name, role, tech stack; deleted after first session
- **Token tracking** — `/status` shows real token counts parsed from SSE `usage` events
- **Graceful Ctrl+C** — saves `session_end` event cleanly, no JSONL corruption
- **Memory write-back** — system prompt instructs agent to update `MEMORY.md` with user preferences and project facts
- **Streaming error recovery** — partial response saved with `[stream interrupted]` marker on disconnect
- **Config backup** — `config.json.bak` written before every `config set`
- **Version check** — 5% of runs check GitHub releases API and show update notice (cached 24h)
- **Chat slash command parity** — `/usage`, `/sessions`, `/status`, `/save`, `/export` added to `tentaclaw chat`
- **Chat usage tracking** — `chatUsage` stats tracked per session in `tentaclaw chat`
- **Usage JSONL events** — `{ type: 'usage', ... }` event appended after each inference call

### Installers

- Block-letter TENTACLAW banner + octopus ASCII art in both `install-cli.sh` and `install-cli.ps1`
- Updated install URLs to `tentaclaw.io/install-cli` and `tentaclaw.io/install.ps1`
- PS 5.1 compatibility fixes throughout `install-cli.ps1`

### Website

- New CLI section: 3 feature cards, bash + PowerShell install one-liners, CLI Docs link
- All inline styles moved to named CSS classes

### Tests & CI

- `scripts/test-cli.ps1` — expanded from 61 to 82 assertions
- `scripts/test-cli.sh` — new Linux/macOS/Proxmox equivalent (82 assertions)
- `scripts/benchmark-cli.ps1` — Windows PowerShell 15-round coding benchmark
- `scripts/benchmark-cli.sh` — Linux/macOS 15-round coding benchmark
- `alexa-coder:latest` benchmark result: **15/15 (100%, Grade A)**
- CI `build-cli` job now verifies `dist/index.js` exists and reports version in job summary

### Docs

- `docs/CLI.md` — complete rewrite: TentaCLAW branding, all v2 features documented
- `CLAUDE.md` — CLI v2 section: workspace system, tools, slash commands, build/test commands

### Bug Fixes

- `child_process` import made static — fixes `!` shell shortcut race condition when stdin is piped
- `edit_file` strips UTF-8 BOM on read — fixes PowerShell `Out-File -Encoding utf8` compatibility
- `execSync` in `!` handler now uses `stdio: ['ignore', 'pipe', 'pipe']` — prevents stdin consumption

---

## [1.0.0] — 2026-03-15

### Gateway

- Hono-based REST API gateway with SQLite persistence
- Node registration + heartbeat system
- OpenAI-compatible `/v1/chat/completions` endpoint with smart routing
- Model alias resolution (map `gpt-4` → any local model)
- VRAM-aware model routing across nodes
- SSE event stream (`/api/v1/events`) for real-time dashboard updates
- API key auth (SHA-256 hashed, scoped read/write/admin)
- Rate limiting (configurable RPM)
- Prometheus metrics (`/metrics`)
- Flight sheets (declarative multi-node model deployment)
- Alert system (GPU temp, VRAM pressure, disk, node offline)
- Benchmark recording + leaderboard
- Cloud burst routing to OpenAI/OpenRouter fallback
- WebSocket shell (authenticated node terminal)

### Agent

- Periodic stats collection (GPU temp, VRAM, tok/s via Ollama API)
- Cluster secret authentication
- UDP broadcast discovery
- Config from `/etc/tentaclaw/rig.conf`
- Mock GPU mode (`TENTACLAW_MOCK=true`) for dev

### Dashboard

- React + Zustand SPA served from gateway `/dashboard`
- 8 themes (Teal, Purple, Red, Blue, Green, Amber, Rose, Monochrome)
- Tabs: Summary, GPUs, Models, Inference, Metrics, Terminal, Chat, Alerts, Flight Sheets, Settings
- SSE live updates for all cluster state
- Keybinds: `g s/g/m/i/c/a/t` tab switch, `Ctrl+B/J/K` panels

### CLI (v1)

- Cluster management: `status`, `nodes`, `health`, `alerts`, `benchmarks`, `doctor`
- Inference: `models`, `chat`, `deploy`, `backends`
- Model search: `search`, `info`, `recommend`, `estimate`
- Node tags: `tags list/add/nodes`
- Config wizard: `setup`, `config show/get/set/validate`
- Sessions: `sessions`, `sessions info`, `code --resume`
- Self-update: `update`
- Zero npm dependencies (pure Node.js + TypeScript types only)

### Infrastructure

- Dockerfiles for gateway + agent
- Multi-node `docker-compose.yml`
- Kubernetes manifests, Helm chart, Terraform, Ansible
- GitHub Actions CI/CD (lint, test, build, Docker push, website deploy)
- GitHub Pages website at `tentaclaw.io`
- MIT licensed

---

[2.5.0]: https://github.com/TentaCLAW-OS/tentaclaw-os/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/TentaCLAW-OS/tentaclaw-os/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/TentaCLAW-OS/tentaclaw-os/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/TentaCLAW-OS/tentaclaw-os/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/TentaCLAW-OS/tentaclaw-os/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/TentaCLAW-OS/tentaclaw-os/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/TentaCLAW-OS/tentaclaw-os/releases/tag/v1.0.0
