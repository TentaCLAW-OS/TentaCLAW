#!/usr/bin/env python3
"""
TentaCLAW Tetris Benchmark
Uses the TentaCLAW gateway /v1/chat/completions with X-Node-Id header
to pin each request to a specific cluster node, benchmarking inference speed.
Each node is asked to generate a complete Tetris game via the chat API.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

# Force UTF-8 output on Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

GATEWAY = os.environ.get("TENTACLAW_GATEWAY", "http://192.168.1.69:8080")

# Best code-gen model preference per node IP (in priority order)
NODE_MODEL_PREFS = {
    "192.168.1.69":  ["qwen2.5-coder:7b", "llama3.1:8b", "dolphin-mistral:latest"],
    "192.168.1.16":  ["qwen2.5-coder:7b", "deepseek-coder-v2:16b", "llama3.1:8b"],
    "192.168.1.177": ["qwen2.5-coder:7b-instruct", "codellama:13b", "mistral:7b-instruct-v0.3-q8_0"],
    "192.168.1.222": ["qwen2.5:7b", "hermes3:8b", "dolphin-mistral:latest"],
}

PROMPT = """You are an expert JavaScript developer. Generate a complete, self-contained, single-file HTML Tetris game.

Requirements:
- Pure HTML + CSS + JavaScript in ONE <html> file, zero external dependencies
- Classic Tetris: 7 tetrominoes (I, O, T, S, Z, J, L) each a different color
- Gravity, line clearing, score system, level progression (speed increases)
- Keyboard: arrow keys move/rotate, Down = soft drop, Space = hard drop, P = pause
- Display score, level, and next piece preview
- GAME OVER screen when board fills, press Enter to restart
- Clean working code, no placeholders, no TODOs

Output ONLY the raw HTML file content starting with <!DOCTYPE html>. No explanation. No markdown. No code fences."""

OUTDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tetris-benchmark")
os.makedirs(OUTDIR, exist_ok=True)

CY = "\033[36m"
GR = "\033[32m"
YE = "\033[33m"
RE = "\033[31m"
DI = "\033[2m"
RS = "\033[0m"
BLD = "\033[1m"


def api_get(path: str) -> dict:
    url = GATEWAY.rstrip("/") + path
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def get_cluster_nodes() -> list:
    """Fetch all registered nodes from gateway (online and offline)."""
    try:
        data = api_get("/api/v1/nodes")
        nodes = data.get("nodes", [])
        # Return all — offline nodes still have IP/backend info for direct routing
        return nodes
    except Exception as e:
        print(f"{RE}Failed to fetch nodes from gateway: {e}{RS}")
        return []


def pick_model_for_node(node: dict) -> str:
    """Pick best coder model for this node.
    First tries to match prefs against loaded_models from stats.
    Falls back to first pref in NODE_MODEL_PREFS (known available from direct Ollama query).
    """
    ip = node.get("ip_address", "")
    prefs = NODE_MODEL_PREFS.get(ip, [])
    stats = node.get("latest_stats") or {}
    loaded = stats.get("inference", {}).get("loaded_models", [])

    if loaded:
        for pref in prefs:
            if any(m == pref or m.startswith(pref.split(":")[0]) for m in loaded):
                return pref
        return loaded[0]

    # No stats from agent — use hardcoded best model for this IP
    return prefs[0] if prefs else "llama3.1:8b"


def generate_via_gateway(node_id: str, model: str) -> dict:
    """POST to gateway /v1/chat/completions with X-Node-Id pinning. Uses streaming."""
    url = GATEWAY.rstrip("/") + "/v1/chat/completions"
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": PROMPT}],
        "stream": True,
        "options": {"temperature": 0.2, "num_predict": 5000},
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-node-id": node_id,
        },
        method="POST",
    )

    content_parts = []
    token_count = 0
    t_start = time.monotonic()
    last_dot = t_start

    print(f"  Generating ", end="", flush=True)

    try:
        with urllib.request.urlopen(req, timeout=360) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8").strip()
                if not line or not line.startswith("data: "):
                    continue
                raw = line[6:].strip()
                if raw == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                if delta:
                    content_parts.append(delta)
                    token_count += 1

                now = time.monotonic()
                if now - last_dot >= 3:
                    print(".", end="", flush=True)
                    last_dot = now

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"\n  {RE}HTTP {e.code}: {body[:200]}{RS}")
        return {"ok": False, "error": f"HTTP {e.code}"}
    except urllib.error.URLError as e:
        print(f"\n  {RE}Request failed: {e}{RS}")
        return {"ok": False, "error": str(e)}
    except TimeoutError:
        print(f"\n  {RE}Timed out (360s){RS}")
        return {"ok": False, "error": "timeout"}

    elapsed = time.monotonic() - t_start
    toks_per_sec = round(token_count / elapsed, 1) if elapsed > 0 else 0.0

    html = "".join(content_parts).strip()
    lines = html.split("\n")
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    html = "\n".join(lines).strip()

    valid = "<!DOCTYPE html>" in html or "<html" in html

    print(f"\n  {GR}Done{RS} {toks_per_sec} tok/s  {token_count} tokens  {round(elapsed,1)}s  {len(html)} chars{' ' + YE + '[?HTML]' + RS if not valid else ''}")

    return {
        "ok": True,
        "html": html,
        "valid_html": valid,
        "toks_per_sec": toks_per_sec,
        "token_count": token_count,
        "elapsed_s": round(elapsed, 1),
        "html_len": len(html),
    }


def validate_html(html: str) -> dict:
    checks = {
        "DOCTYPE": "<!DOCTYPE html>" in html,
        "canvas": "canvas" in html.lower(),
        "tetrominoes": any(x in html for x in ["tetromino", "TETROMINOS", "pieces", "Tetromino", "SHAPES", "shapes"]),
        "score": "score" in html.lower(),
        "keydown": "keydown" in html.lower(),
        "animation": "requestAnimationFrame" in html or "setInterval" in html,
        "game_over": any(x in html.lower() for x in ["game over", "gameover", "game_over"]),
    }
    return checks


def main():
    print()
    print(f"{CY}{'━'*64}{RS}")
    print(f"  {BLD}TentaCLAW Tetris Benchmark{RS}  —  via gateway {GATEWAY}")
    print(f"{CY}{'━'*64}{RS}")
    print()

    print(f"  Fetching cluster nodes from gateway...")
    nodes = get_cluster_nodes()
    if not nodes:
        print(f"  {RE}No online nodes found. Is the gateway running?{RS}")
        sys.exit(1)

    online = sum(1 for n in nodes if n.get("status") == "online")
    print(f"  {GR}{online} online{RS} / {len(nodes)} registered  (testing all)")
    print()

    results = []

    for node in nodes:
        node_id = node["id"]
        hostname = node.get("hostname", node_id)
        ip = node.get("ip_address", "?")
        soul_name = (node.get("latest_stats") or {}).get("soul", {}).get("name")
        display = soul_name or hostname
        model = pick_model_for_node(node)
        outfile = os.path.join(OUTDIR, f"tetris-{hostname}.html")

        print(f"  {DI}{'─'*62}{RS}")
        print(f"  Node   {CY}{display}{RS}{(' (' + hostname + ')') if soul_name and soul_name != hostname else ''}")
        print(f"  ID     {DI}{node_id}{RS}")
        print(f"  IP     {ip}")
        print(f"  Model  {YE}{model}{RS}")
        print()

        result = generate_via_gateway(node_id, model)
        result["node_id"] = node_id
        result["hostname"] = hostname
        result["display"] = display
        result["model"] = model
        result["ip"] = ip
        result["outfile"] = outfile

        if result.get("ok") and result.get("html"):
            checks = validate_html(result["html"])
            result["checks"] = checks
            passed = sum(checks.values())
            result["checks_passed"] = passed
            print(f"  Checks {passed}/7: {' '.join(k for k,v in checks.items() if v)}")
            with open(outfile, "w", encoding="utf-8") as f:
                f.write(result["html"])
            print(f"  Saved  {DI}{outfile}{RS}")

        results.append(result)
        print()

    # Summary
    print()
    print(f"{CY}{'━'*64}{RS}")
    print(f"  {BLD}BENCHMARK RESULTS{RS}")
    print(f"{CY}{'━'*64}{RS}")
    print(f"  {'Node':<22} {'Model':<30} {'Tok/s':>7} {'Tokens':>7} {'Time':>6} {'HTML':>5}")
    print(f"  {DI}{'─'*62}{RS}")

    ok_results = []
    for r in results:
        if r.get("ok"):
            chk = r.get("checks_passed", "?")
            print(f"  {r['display']:<22} {r['model']:<30} {r['toks_per_sec']:>7} {r['token_count']:>7} {r['elapsed_s']:>5}s {str(chk)+'/7':>5}")
            ok_results.append(r)
        else:
            err = r.get("error", "failed")
            print(f"  {r['display']:<22} {'—':<30} {'FAIL':>7}   ({err})")

    print()
    valid = [r for r in ok_results if r.get("checks_passed", 0) >= 6]
    print(f"  {GR}{len(valid)}/{len(results)}{RS} nodes produced valid Tetris")

    if ok_results:
        best = max(ok_results, key=lambda r: r["toks_per_sec"])
        worst = min(ok_results, key=lambda r: r["toks_per_sec"])
        avg = round(sum(r["toks_per_sec"] for r in ok_results) / len(ok_results), 1)
        print(f"  Fastest: {CY}{best['display']}{RS} — {best['toks_per_sec']} tok/s")
        print(f"  Slowest: {DI}{worst['display']}{RS} — {worst['toks_per_sec']} tok/s")
        print(f"  Average: {avg} tok/s across {len(ok_results)} nodes")
        print(f"  Files:   {DI}{OUTDIR}/{RS}")
    print()


if __name__ == "__main__":
    main()
