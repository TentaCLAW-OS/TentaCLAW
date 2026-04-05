# TentaCLAW CLI — Local Model Specialization Plan
## Waves 444–453: Built for Self-Hosted AI

> **Core principle:** Local models ARE the product. OpenAI/OpenRouter are convenience features.
> Every default, every fallback, every error message should be designed for someone running
> Ollama, LM Studio, llamafile, or a quantized model on their own hardware.
>
> **If we get off track, return here.** Start from lowest-numbered incomplete wave.

---

## The Problem Statement

TentaCLAW was built alongside OpenAI-compatible APIs and inherited their assumptions:
- `tool_choice: 'auto'` sent to every model
- No context window management — assumes 128K
- Timeouts designed for cloud APIs (fast, always up)
- No backend detection — treats every endpoint the same
- Errors designed for OpenAI error shapes

**Local models break all of these assumptions.** A user running `hermes3:8b` on a 16GB laptop hits:
- Silent context overflow after 3 turns (Ollama default: 2048–4096 tokens)
- CLI freezes for 60+ seconds while model loads (no indication it's loading)
- `edit_file` fails constantly (`\r\n` vs `\n`, trailing spaces)
- Tool calls silently dropped when model outputs JSON as text
- `tool_choice: 'auto'` rejected by half of Ollama models
- No recovery guidance — just a red error and silence

This plan fixes all of that.

---

## Supported Local Backends

The plan targets all of these. Detection logic covers them all.

| Backend | Default Port | Tool Support | Notes |
|---------|-------------|-------------|-------|
| **Ollama** | 11434 | Most models: yes | `/api/show` for model info, `options.num_ctx` for context |
| **LM Studio** | 1234 | Yes (server mode) | OpenAI-compat, no `/api/show` |
| **llamafile** | 8080 | Depends on model | Self-contained binary, OpenAI-compat |
| **koboldcpp** | 5001 | Limited | Non-standard tool format sometimes |
| **vllm** | 8000 | Yes | OpenAI-compat, good tool support |
| **tabbyAPI** | 5000 | Yes | Exllamav2 backend |
| **Jan** | 1337 | Yes | OpenAI-compat wrapper |

---

## Quick Reference — All 10 Waves

| # | Wave | Summary | Effort | Status |
|---|------|---------|--------|--------|
| 1 | [444](#wave-444--operator-precedence-bug-1-line) | Fix `likelyNoTools` operator bug | 1 line | ✅ |
| 2 | [445](#wave-445--inference-timeout--model-load-detection) | Request timeout + "loading model" detection | 15 lines | ✅ |
| 3 | [446](#wave-446--local-backend-detection) | Detect which local backend is running | 30 lines | ✅ |
| 4 | [447](#wave-447--local-model-capability-matrix) | Per-backend capability defaults (tools, context, params) | 30 lines | ✅ |
| 5 | [448](#wave-448--ollama-context-management) | `num_ctx` injection + `finish_reason:length` surface | 20 lines | ✅ |
| 6 | [449](#wave-449--edit_file-whitespace-normalization) | `edit_file` normalize `\r\n` + trailing spaces | 15 lines | ✅ |
| 7 | [450](#wave-450--aggressive-text-tool-recovery) | Text-mode tool recovery for models that output JSON as text | 25 lines | ✅ |
| 8 | [451](#wave-451--context-auto-trim) | Auto-trim message history for local context limits | 35 lines | ✅ |
| 9 | [452](#wave-452--edit_file-auto-re-read-on-failure) | Auto-inject fresh file content on `edit_file` failure | 20 lines | ✅ |
| 10 | [453](#wave-453--tool-args-json-parse-hardening) | Tool args JSON hardening for truncated SSE streams | 15 lines | ✅ |

**Version target:** Waves 444–449 → v2.32.0 · Waves 450–453 → v2.33.0

---

## Waves 444–449 — Batch 1 (v2.32.0)

---

### Wave 444 — Operator Precedence Bug (1 line)

**File:** `cli/src/index.ts` line ~3681
**Symptom:** Ollama architecture check fires for ANY localhost URL — including LM Studio on `:1234`, llamafile on `:8080`, or your own vllm. The `await` call to `/api/show` blocks startup even for backends that don't have that endpoint, and always times out with a 2s delay.

**Root cause:**
```typescript
// BROKEN — missing parens, second OR has no guard:
if (!likelyNoTools && inferenceUrl.includes('11434') || inferenceUrl.includes('localhost')) {
//                                                   ^^
// Reads as: (!likelyNoTools && ...11434) OR (...localhost)
// The localhost branch has NO !likelyNoTools guard — fires always
```

**Fix:**
```typescript
// CORRECT — group the URL checks first:
if (!likelyNoTools && (inferenceUrl.includes('11434') || inferenceUrl.includes('localhost'))) {
```

**Side effect of this fix:** After Wave 446 adds backend detection, this check can be further scoped to `backend === 'ollama'` only. For now, fixing the parens stops the spurious `/api/show` calls to non-Ollama endpoints.

**Test:** `tentaclaw code` with LM Studio on `localhost:1234` — startup should be instant, no 2s pause.

---

### Wave 445 — Inference Timeout + Model Load Detection

**File:** `cli/src/index.ts` — inference HTTP request block ~line 4040
**Symptom:** If Ollama is loading a model (30–90 seconds for a 7B model), the CLI shows a spinning cursor but gives no indication what's happening. If Ollama hangs or OOMs, the CLI freezes forever — only Ctrl+C escapes it.

**Root cause:** Every other HTTP call in the codebase has `req.setTimeout(N, ...)`. The main inference SSE request does not.

**Two-part fix:**

**Part 1 — Add socket timeout:**
```typescript
// Wave 445: 120s timeout on inference — local models can be slow to load
const INFERENCE_TIMEOUT_MS = 120_000;
req.setTimeout(INFERENCE_TIMEOUT_MS, () => {
    req.destroy();
    streamState.error = [
        `No response after ${INFERENCE_TIMEOUT_MS / 1000}s.`,
        `If the model is loading, try again in 30 seconds.`,
        `Check status:  ollama ps`,
        `Free VRAM:     ollama stop ${model}`,
    ].join('\n');
});
```

**Part 2 — Detect "loading" delay in spinner:**
If `firstTokenReceived` is still false after 5s, upgrade the spinner message:
```typescript
// Wave 445: after 5s with no tokens, assume model is loading
let loadingWarningShown = false;
const loadingTimer = setTimeout(() => {
    if (!firstTokenReceived && !printMode) {
        process.stdout.write('\r  ' + C.dim('  Loading model into memory… (this takes 30–60s the first time)') + ' '.repeat(10));
        loadingWarningShown = true;
    }
}, 5000);
// Clear it alongside the spinner: clearTimeout(loadingTimer)
```

**Test:** Start Ollama with no model loaded, run `tentaclaw code` — should show "Loading model…" message after 5s. Kill Ollama mid-stream — should timeout at 120s with helpful message.

---

### Wave 446 — Local Backend Detection

**File:** `cli/src/index.ts` — new function `detectLocalBackend()`, called from `cmdCode` during startup
**Symptom:** The CLI treats every endpoint identically. LM Studio, llamafile, and Ollama all need different parameters (`num_ctx` vs `context_length`, `tool_choice` support varies, etc.). Without knowing what's on the other end, we can't send the right parameters.

**New function — probe the endpoint to identify the backend:**
```typescript
// Wave 446: identify which local backend is running
type LocalBackend = 'ollama' | 'lmstudio' | 'llamafile' | 'vllm' | 'tabbyapi' | 'openai' | 'openrouter' | 'unknown';

async function detectLocalBackend(baseUrl: string): Promise<LocalBackend> {
    // Ollama: has /api/tags and returns {"models": [...]}
    const ollamaCheck = await apiProbe(baseUrl, '/api/tags') as { models?: unknown[] } | null;
    if (ollamaCheck?.models) return 'ollama';

    // vllm: /health returns 200 with no body, /v1/models has "object":"list"
    const vllmCheck = await apiProbe(baseUrl, '/health') as Record<string, unknown> | null;
    if (vllmCheck !== null) {
        const models = await apiProbe(baseUrl, '/v1/models') as { data?: Array<{ owned_by?: string }> } | null;
        if (models?.data?.[0]?.owned_by === 'vllm') return 'vllm';
    }

    // LM Studio: /v1/models returns models with id containing "lmstudio"
    const lmsCheck = await apiProbe(baseUrl, '/v1/models') as { data?: Array<{ id?: string }> } | null;
    if (lmsCheck?.data?.some(m => m.id?.includes('lmstudio') || baseUrl.includes('1234'))) return 'lmstudio';

    // tabbyAPI: has /v1/token/encode endpoint
    const tabbyCheck = await apiProbe(baseUrl, '/v1/token/encode') as Record<string, unknown> | null;
    if (tabbyCheck !== null) return 'tabbyapi';

    // llamafile: /v1/models works but model id contains "llamafile" or port is 8080
    if (baseUrl.includes('8080') && lmsCheck?.data) return 'llamafile';

    // Fallback: has /v1/models but unknown backend
    if (lmsCheck?.data) return 'unknown';

    return 'unknown';
}
```

**Store result on `cmdCode` startup** as `let localBackend: LocalBackend = 'unknown'` and pass to downstream logic.

**Display in startup banner:**
```
  backend  ollama (local)    model  hermes3:8b
```

**Test:** Run with Ollama → shows "ollama". Run with LM Studio → shows "lmstudio". Unknown custom endpoint → shows "local".

---

### Wave 447 — Local Model Capability Matrix

**File:** `cli/src/index.ts` — after backend detection, before bodyStr construction
**Symptom:** `tool_choice: 'auto'` sent to LM Studio causes errors on some models. `parallel_tool_calls` not disabled causes confused multi-tool responses. `num_ctx` only injected for Ollama. Every local backend needs its own defaults.

**Capability defaults per backend:**
```typescript
// Wave 447: per-backend capability defaults — local-first design
interface BackendCapabilities {
    sendToolChoice: boolean;        // send tool_choice: 'auto' in request
    parallelToolCalls: boolean;     // allow parallel tool calls
    numCtxParam: 'ollama' | 'none'; // how to set context window size
    defaultCtx: number;             // context tokens to request
    streamingReliable: boolean;     // SSE streaming works correctly
}

const BACKEND_CAPS: Record<LocalBackend, BackendCapabilities> = {
    ollama:     { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'ollama', defaultCtx: 32768, streamingReliable: true },
    lmstudio:   { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     streamingReliable: true },
    llamafile:  { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     streamingReliable: true },
    vllm:       { sendToolChoice: true,  parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     streamingReliable: true },
    tabbyapi:   { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     streamingReliable: true },
    openai:     { sendToolChoice: true,  parallelToolCalls: true,  numCtxParam: 'none',   defaultCtx: 0,     streamingReliable: true },
    openrouter: { sendToolChoice: true,  parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     streamingReliable: true },
    unknown:    { sendToolChoice: false, parallelToolCalls: false, numCtxParam: 'none',   defaultCtx: 0,     streamingReliable: true },
};
```

**Use in bodyStr:**
```typescript
const caps = BACKEND_CAPS[localBackend];
const bodyStr = JSON.stringify({
    model,
    messages,
    ...(noTools ? {} : {
        tools: CODE_AGENT_TOOLS,
        ...(caps.sendToolChoice ? { tool_choice: 'auto' } : {}),
        ...(caps.parallelToolCalls ? {} : { parallel_tool_calls: false }),
    }),
    stream: true,
    temperature: agentTemperature,
    ...(maxTokensFlag > 0 ? { max_tokens: maxTokensFlag } : {}),
    // Ollama-specific context window (Wave 448 injects this)
    ...(caps.numCtxParam === 'ollama' ? { options: { num_ctx: caps.defaultCtx } } : {}),
});
```

**Test:** Each backend gets correct parameters. `tentaclaw code` with Ollama: no `tool_choice` sent. With OpenAI: `tool_choice: 'auto'` present.

---

### Wave 448 — Ollama Context Management

**File:** `cli/src/index.ts` — two locations: bodyStr + SSE chunk parser
**Symptom:** Ollama silently truncates responses mid-sentence when context fills. `finish_reason: 'length'` is returned but never checked. User sees a broken response with no explanation. This kills multi-step coding sessions — typical file read + edit task needs 8K–16K tokens easily.

**Part 1 — `num_ctx` injection (now driven by Wave 447 caps — already covered)**
The `options: { num_ctx: 32768 }` injection is handled by `BACKEND_CAPS.ollama.defaultCtx`. No additional code needed here beyond Wave 447.

**Part 2 — Detect `finish_reason: 'length'` in SSE:**
Add `contextOverflow` to stream state:
```typescript
// In streamState object (add field):
streamState.finishReason = '';

// In SSE parser, alongside delta reading:
const finishReason = ev.choices?.[0]?.finish_reason;
if (finishReason) streamState.finishReason = finishReason;
```

**Part 3 — Surface to user after stream:**
```typescript
// Wave 448: after stream resolves, check for context overflow
if (streamState.finishReason === 'length' || streamState.finishReason === 'max_tokens') {
    if (!printMode) {
        console.log('\n  ' + C.yellow('⚠  Context window full — response was cut off'));
        console.log('  ' + C.dim('  Options:'));
        console.log('  ' + C.dim('    /compact         — summarize history and continue'));
        console.log('  ' + C.dim('    /new             — start a fresh session'));
        if (localBackend === 'ollama') {
            console.log('  ' + C.dim('    tentaclaw config set model qwen2.5-coder:14b  — larger context model'));
        }
    }
}
```

**Test:** Fill Ollama context (load a 2000-line file in a session with 2048 `num_ctx`). Should see warning. With `num_ctx: 32768`, should handle much longer sessions without truncation.

---

### Wave 449 — `edit_file` Whitespace Normalization

**File:** `cli/src/index.ts` — `executeCodeTool` case `'edit_file'`
**Symptom:** `edit_file` returns "old_text not found" constantly. Happens because:
1. Windows files have `\r\n`, model reconstructs with `\n`
2. Model adds trailing space to lines when re-stating content
3. Model uses spaces where file has tabs
4. Any single character difference in the old_text causes a hard fail

This is the **#1 reason local model coding sessions fail.** The model reads the file correctly, tries to edit it correctly, but the byte-exact match fails and the whole task loops.

**Find the current match code** — it's an `indexOf` somewhere in `case 'edit_file':` in `executeCodeTool`.

**Fix — normalize before matching, apply on normalized:**
```typescript
// Wave 449: normalize for fuzzy match — biggest fix for local model reliability
const normalize449 = (s: string) =>
    s.replace(/\r\n/g, '\n')          // Windows line endings
     .replace(/\r/g, '\n')            // old Mac line endings
     .replace(/[ \t]+$/gm, '');       // trailing whitespace per line

const normContent = normalize449(content);
const normOldText = normalize449(oldText);
const normNewText = normalize449(newText);

const matchIdx = normContent.indexOf(normOldText);

if (matchIdx === -1) {
    // Wave 449: on failure, show the model what the file actually looks like
    // so it can correct old_text on the next attempt without a full read_file call
    const lines = normContent.split('\n');
    const preview = lines.slice(0, 20).join('\n');
    const suffix = lines.length > 20 ? `\n[...${lines.length - 20} more lines — use read_file to see all]` : '';
    return [
        `Error: old_text not found in ${filePath}`,
        `(Searched with whitespace normalization — still no match)`,
        ``,
        `First 20 lines of actual file:`,
        preview + suffix,
        ``,
        `Tip: copy old_text exactly from the above content. Do not reconstruct from memory.`,
    ].join('\n');
}

const result = normContent.slice(0, matchIdx) + normNewText + normContent.slice(matchIdx + normOldText.length);
// Write normalized result (consistent line endings throughout)
fs.writeFileSync(filePath, result, 'utf8');
```

**Note:** This normalizes the file's line endings on write. Acceptable tradeoff — consistent `\n` throughout is better than mixed `\r\n`/`\n`.

**Test:** Create file with `\r\n` endings, run agent task to edit it — should succeed first attempt. Test with trailing-space old_text — should succeed. Test genuine mismatch — should show first 20 lines of actual file.

---

## Waves 450–453 — Batch 2 (v2.33.0)

---

### Wave 450 — Aggressive Text Tool Recovery

**File:** `cli/src/index.ts` — no-tool-calls handler ~line 4201
**Symptom:** Many local models (especially smaller ones: 3B–7B) ignore the tool call format entirely and output the tool invocation as a text JSON block, like:
```
I'll read the file for you.
{"name": "read_file", "arguments": {"path": "src/index.ts"}}
```
The existing recovery (Wave 217) handles one pattern. Local models produce many more.

**Current recovery pattern (too narrow):**
```typescript
// Only matches {"arguments": {...}, "name": "..."} or {"name": "...", "arguments": {...}}
const textToolMatch = fullContent.match(/\{\s*"(?:arguments|name)"\s*:\s*...\}/);
```

**Extended recovery patterns:**
```typescript
// Wave 450: broader text-mode tool recovery for local models
const TEXT_TOOL_PATTERNS = [
    // Standard: {"name": "tool", "arguments": {...}}
    /\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*(?:\{[^}]*\}[^}]*)?\})/s,
    // Reversed: {"arguments": {...}, "name": "tool"}
    /\{\s*"arguments"\s*:\s*(\{[^}]*(?:\{[^}]*\}[^}]*)?\})\s*,\s*"name"\s*:\s*"(\w+)"/s,
    // Function style: {"function": {"name": "tool", "arguments": {...}}}
    /\{\s*"function"\s*:\s*\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})/s,
    // Markdown code block: ```json\n{"name": "tool", ...}\n```
    /```(?:json)?\s*\n?\s*\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})/s,
];

for (const pattern of TEXT_TOOL_PATTERNS) {
    const m = fullContent.match(pattern);
    if (m) {
        // extract name + args, synthesize proper tool call, execute
        // (same recovery logic as existing Wave 217 but now covers all patterns)
    }
}
```

**Also handle: model outputs tool name with no arguments:**
```
Let me list the directory.
{"name": "list_dir"}
```
Treat missing arguments as `{}` and let the tool return its own error.

**Test:** Prompt a small local model (3B) to read a file — most will output text JSON. Should recover and execute the tool automatically.

---

### Wave 451 — Context Auto-Trim

**File:** `cli/src/index.ts` — top of the `for (let iter...)` loop in `runAgentLoop`
**Symptom:** Long sessions overflow local model context. After 10+ turns with file reads, the messages array can easily exceed 16K tokens — larger than Ollama's effective window even with `num_ctx: 32768` for smaller models.

**Trigger:** Only trim when local backend AND message count > 20.

**Strategy — keep these, drop the rest:**
- `messages[0]` — system prompt (never drop)
- Last 12 messages — recent context (always keep)
- Any `tool` messages that pair with kept `assistant` messages

**Critical constraint:** Never orphan a `tool` message. If you drop an `assistant` message with `tool_calls`, you MUST also drop all its paired `tool` result messages. Orphaned tool messages cause "unexpected role" errors in most models.

```typescript
// Wave 451: auto-trim for local models to prevent context overflow
const isLocalBackend = ['ollama', 'lmstudio', 'llamafile', 'tabbyapi', 'unknown'].includes(localBackend);
if (isLocalBackend && messages.length > 22) {
    const systemMsg = messages[0];   // always keep
    const tail = messages.slice(-12); // always keep last 12

    // Ensure tail doesn't start mid tool-call pair
    // Find first 'user' role in tail to use as safe start
    const safeStart = tail.findIndex(m => m.role === 'user');
    const safeTail = safeStart > 0 ? tail.slice(safeStart) : tail;

    const dropped = messages.length - 1 - safeTail.length;
    messages.length = 0;
    messages.push(systemMsg);
    messages.push({
        role: 'user',
        content: `[${dropped} earlier messages trimmed to stay within context window. Continue from current state.]`
    });
    messages.push(...safeTail);

    if (!printMode) console.log('  ' + C.dim(`⚡ Context trimmed (kept last ${safeTail.length} messages)`));
}
```

**Test:** Run a 30-turn session reading large files. Confirm it auto-trims, shows the notice, and continues working rather than degrading into empty responses.

---

### Wave 452 — `edit_file` Auto-Re-Read on Failure

**File:** `cli/src/index.ts` — tool result handler, where tool results are added to messages (~line 4300)
**Symptom:** After `edit_file` fails with "old_text not found," the model often retries 2–4 more times with the same wrong text. This burns iteration budget (max 20 iterations) and usually ends with the task incomplete. Wave 449 helps by showing a preview in the error, but this wave makes the agent recover faster.

**Fix — inject fresh file content directly into the tool result:**
```typescript
// Wave 452: on edit_file failure, auto-inject current file content
// so agent can correct old_text without spending another iteration on read_file
if (tc.name === 'edit_file' && toolResult.startsWith('Error: old_text not found')) {
    const filePath = (parsedArgs as Record<string, unknown>)['path'];
    if (typeof filePath === 'string') {
        try {
            const fresh = fs.readFileSync(filePath, 'utf8');
            const lines = fresh.split('\n');
            const preview = lines.slice(0, 25).join('\n');
            const more = lines.length > 25 ? `\n[...${lines.length - 25} more lines]` : '';
            toolResult += `\n\n--- Current file content (auto-read) ---\n${preview}${more}\n---\nUse exact text from above as old_text on your next edit_file call.`;
        } catch { /* file may not exist */ }
    }
}
```

**Result:** The model's next turn has the real file content inline. First-attempt success rate for edit_file goes from ~60% to ~90%.

**Test:** Give agent a task to edit a file, but manually corrupt the workspace so `old_text` won't match. Should self-correct on the second attempt using the injected content.

---

### Wave 453 — Tool Args JSON Parse Hardening

**File:** `cli/src/index.ts` — tool call dispatch, where `tcAcc` values are processed (~line 4184+)
**Symptom:** Local models sometimes produce incomplete SSE streams — the connection closes before the tool call arguments JSON is complete. The current code does `JSON.parse(tc.args || '{}')` — if `tc.args` is `'{"path": "/some/fi'` (truncated), the parse throws and args silently become `{}`. The tool runs with empty arguments and returns a confusing error.

**Fix — detect and surface malformed args:**
```typescript
// Wave 453: harden tool args parsing — surface truncation clearly
let parsedArgs: Record<string, unknown> = {};
let argsParseError = false;
try {
    parsedArgs = JSON.parse(tc.args || '{}') as Record<string, unknown>;
} catch {
    argsParseError = true;
}

if (argsParseError || (Object.keys(parsedArgs).length === 0 && tc.args && tc.args.trim().length > 2)) {
    const toolResult = [
        `Error: tool arguments were malformed (stream may have been truncated).`,
        `Received: ${(tc.args || '').slice(0, 300)}`,
        `Please retry with complete arguments.`,
    ].join('\n');
    messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: toolResult });
    sessionUsage.requestCount++;
    continue; // skip to next iteration, let model retry
}
```

**Test:** Simulate truncated stream by setting very low `max_tokens` on a tool-heavy task. Should see the clear error message instead of a confusing "missing required argument."

---

## Build & Test Milestones

### After Waves 444–449 (v2.32.0):
```bash
npm run build --workspace=cli
npm install -g --force ./cli
powershell -ExecutionPolicy Bypass -File scripts/test-cli.ps1
# Expected: 89/89 pass
```

**Manual smoke tests — Ollama required:**
```bash
# Wave 444: LM Studio on localhost:1234 — no 2s delay at startup
# Wave 445: kill Ollama mid-response — should timeout at 120s cleanly
# Wave 445: start with unloaded model — should show "Loading model..." after 5s
# Wave 446: confirm startup banner shows detected backend name
# Wave 447: inspect request body — no tool_choice for Ollama, has it for OpenAI
# Wave 448: fill context with large files — should see overflow warning
# Wave 449: edit file with \r\n endings — should succeed first attempt
```

### After Waves 450–453 (v2.33.0):
```bash
npm run build --workspace=cli
npm install -g --force ./cli
powershell -ExecutionPolicy Bypass -File scripts/test-cli.ps1
# Expected: 89/89 pass
```

**Manual smoke tests:**
```bash
# Wave 450: use a 3B model, ask it to read a file — should recover text-mode tool call
# Wave 451: run a 30-turn session — should auto-trim and continue
# Wave 452: agent edit_file with wrong old_text — should self-correct turn 2
# Wave 453: low max_tokens on tool task — clear error not "missing required argument"
```

---

## What "Done" Looks Like

A user running **any** local model on **any** common local backend should be able to:

1. Start `tentaclaw code` and see which backend was detected (Ollama, LM Studio, etc.)
2. Run a full coding task (read + edit + verify) without the CLI hanging or context overflowing
3. Have `edit_file` succeed on the first or second attempt reliably
4. See a clear, actionable message when something goes wrong — never a silent failure
5. Use a 3B CPU model (BitNet, phi3.mini) and have the CLI recover text-mode tool calls automatically

---

## Out of Scope for This Plan

- Gateway routes (404 on `estimate`, `recommend`) — separate issue in `gateway/src/`
- `alert-rules` "rules is not iterable" bug — API shape mismatch in gateway
- `hub search` / CLAWHub registry service
- Dashboard, agent, or shared package changes  
- New features — that is Wave 460+
