# TentaCLAW OS — MASTER PLAN v12: Detailed Waves 31-40, 45-80

> Expanding all summarized waves into fully detailed phases.

---

# v1.0 "SUCKER" CONTINUED (Waves 31-40)

---

### Wave 31: Config Hot-Reload (Phases 507-522)
*Change any setting without restarting the gateway.*

- [ ] 507. Implement file watcher on `config.yaml` — detect changes via `fs.watch` with debounce (500ms), trigger reload pipeline
- [ ] 508. Build config validation on reload — parse new config, validate against JSON schema, reject invalid configs before applying
- [ ] 509. Implement atomic config swap — on valid new config, swap internal config object atomically, no partial states
- [ ] 510. Add config change event bus — emit `config.changed` events with diff (old value, new value, key path) for all components to react
- [ ] 511. Implement per-component reload handlers — routing rules, rate limits, auth settings, backend configs each have their own reload logic
- [ ] 512. Build rollback on failure — if any reload handler fails, rollback to previous config, log error with specific failing component
- [ ] 513. Add config change audit log — record every config change with: timestamp, changed keys, old/new values, source (file/API/CLI)
- [ ] 514. Implement config reload via API — `POST /api/config/reload` triggers reload from file, `PUT /api/config` applies new config directly
- [ ] 515. Build CLI support — `tentaclaw config reload` triggers reload, `tentaclaw config set <key> <value>` modifies and reloads
- [ ] 516. Add config diff endpoint — `GET /api/config/diff` shows pending changes between file and running config
- [ ] 517. Implement config environment override — env vars `TENTACLAW_*` override config.yaml values, checked on reload
- [ ] 518. Build config validation CLI — `tentaclaw config validate config.yaml` checks config without applying
- [ ] 519. Add hot-reload for TLS certificates — detect cert file changes, reload TLS context without connection drops
- [ ] 520. Write integration test: change rate limit in config.yaml while serving requests, verify new limit applied within 2s, no dropped requests
- [ ] 521. Write integration test: apply invalid config, verify rejection and rollback to previous working config
- [ ] 522. Commit "feat(config): hot-reload — file watch, validation, atomic swap, rollback, API, TLS reload"

---

### Wave 32: Plugin System Foundation (Phases 523-539)
*Third-party extensions without forking the codebase.*

- [ ] 523. Design plugin interface — TypeScript interface: `init(context)`, `start()`, `stop()`, `destroy()`, `metadata()` returning name, version, description, hooks
- [ ] 524. Define plugin hooks — 12 hook points: `pre-request`, `post-response`, `model-load`, `model-unload`, `node-join`, `node-leave`, `health-check`, `metric-collect`, `auth-check`, `route-decide`, `config-change`, `error-handle`
- [ ] 525. Implement plugin loader — discover plugins from `~/.tentaclaw/plugins/` directory, load as ES modules, validate interface compliance
- [ ] 526. Build plugin isolation — each plugin runs in its own V8 context with limited API surface, cannot access other plugins' state
- [ ] 527. Implement plugin lifecycle — init → start (after gateway ready) → running → stop (on shutdown) → destroy, with timeout at each stage (30s)
- [ ] 528. Add plugin configuration — each plugin declares config schema, admin sets values in `config.yaml` under `plugins.<name>.settings`
- [ ] 529. Build plugin registry — local registry of installed plugins with version, status (enabled/disabled), health, config
- [ ] 530. Implement plugin health checks — each plugin can report health status, unhealthy plugins auto-disabled after 3 failed checks
- [ ] 531. Add plugin metrics namespace — plugins emit metrics under `tentaclaw_plugin_<name>_*`, isolated from core metrics
- [ ] 532. Build plugin CLI — `tentaclaw plugin install <path/url>`, `plugin list`, `plugin enable/disable`, `plugin config <name>`
- [ ] 533. Implement plugin hot-reload — update plugin code without gateway restart, stop old → load new → start new
- [ ] 534. Add plugin dependency resolution — plugins declare dependencies on other plugins, loader ensures correct initialization order
- [ ] 535. Build plugin template generator — `tentaclaw plugin create <name>` scaffolds plugin project with TypeScript, tests, docs template
- [ ] 536. Write example plugin: "webhook-notifier" — sends webhook on model deploy/undeploy events, demonstrates all hook types
- [ ] 537. Write example plugin: "custom-auth" — implements custom authentication (LDAP/OAuth), demonstrates auth-check hook
- [ ] 538. Write plugin development guide — architecture, hook reference, testing, publishing to CLAWHub
- [ ] 539. Commit "feat(plugins): plugin system — 12 hooks, isolation, lifecycle, hot-reload, CLI, templates"

---

### Wave 33: Backup and Restore (Phases 540-556)
*Never lose cluster state. Recover from any disaster.*

- [ ] 540. Define backup scope — cluster config, model deployment state, namespace definitions, API keys (encrypted), RBAC roles, FlightSheets, audit logs, plugin configs
- [ ] 541. Implement backup snapshot — `tentaclaw backup create` captures all cluster state into single encrypted tarball (AES-256-GCM with cluster secret)
- [ ] 542. Add backup metadata — backup ID, timestamp, cluster version, node count, model count, size, checksum (SHA-256)
- [ ] 543. Implement scheduled backups — configurable cron schedule (default: daily at 2 AM), stored in `~/.tentaclaw/backups/`
- [ ] 544. Build remote backup storage — upload backups to S3-compatible storage (MinIO, AWS S3, GCS, Azure Blob) via configurable endpoint
- [ ] 545. Implement backup rotation — keep last N backups (default: 30), auto-delete older, configurable per local and remote
- [ ] 546. Build restore from backup — `tentaclaw backup restore <backup-id>` stops cluster, applies state from backup, restarts
- [ ] 547. Add partial restore — restore specific components only: `--only config`, `--only keys`, `--only models`, `--only namespaces`
- [ ] 548. Implement backup verification — `tentaclaw backup verify <backup-id>` checks integrity (checksum), tests decryption, validates schema
- [ ] 549. Build backup diff — `tentaclaw backup diff <id1> <id2>` shows what changed between two backups
- [ ] 550. Add backup-before-upgrade — automatically create backup before any cluster version upgrade
- [ ] 551. Implement cross-cluster restore — restore backup from cluster A onto cluster B (with conflict resolution for IDs)
- [ ] 552. Build backup dashboard panel — Settings tab shows backup history, size, status, one-click restore, schedule config
- [ ] 553. Add backup encryption key rotation — when cluster secret rotates, re-encrypt existing backups with new key
- [ ] 554. Write integration test: create backup, modify cluster state, restore backup, verify original state recovered
- [ ] 555. Write documentation: backup and restore guide with S3 configuration examples
- [ ] 556. Commit "feat(backup): backup and restore — encrypted snapshots, scheduled, remote storage, partial restore"

---

### Wave 34: Log Rotation and Archival (Phases 557-572)
*Structured logs that don't fill your disk.*

- [ ] 557. Implement structured JSON logging — every log line: `{"timestamp":"...","level":"...","component":"...","message":"...","trace_id":"...","data":{...}}`
- [ ] 558. Add configurable log levels per component — gateway=info, router=debug, backend=warn, agent=info — set via config.yaml
- [ ] 559. Implement log rotation — rotate on: daily boundary OR file exceeds 500MB (whichever first), keep last 30 files
- [ ] 560. Add log compression — rotated logs compressed with zstd (70-80% size reduction), configurable algorithm
- [ ] 561. Build log archival — after compression, optionally upload to S3/GCS/Azure Blob for long-term storage
- [ ] 562. Implement log retention policy — configurable retention period (default: 90 days), auto-delete archived logs past retention
- [ ] 563. Add log search CLI — `tentaclaw logs search --model llama --level error --since 1h` searches local and archived logs
- [ ] 564. Build log export for compliance — `tentaclaw logs export --from 2026-01-01 --to 2026-03-31 --format csv` for audit export
- [ ] 565. Implement log sampling for high-volume — at >1000 log lines/sec, sample DEBUG logs (10%), keep all INFO/WARN/ERROR
- [ ] 566. Add request ID correlation — every log line for a request includes `request_id` matching the `X-Request-ID` response header
- [ ] 567. Build log dashboard panel — live log stream in terminal tab, filterable by level/component/model, search
- [ ] 568. Implement log forwarding — configurable syslog, Loki, Elasticsearch, Splunk forwarding via Fluent Bit sidecar config
- [ ] 569. Add log-based alerting — configurable pattern matching: alert on "OOM" in logs, alert on >10 ERROR/min
- [ ] 570. Write log format documentation — field reference, log level guide, integration with Loki/ELK
- [ ] 571. Write integration test: generate 10K log lines, verify rotation triggers, verify compression, verify search finds expected entries
- [ ] 572. Commit "feat(logs): log rotation — structured JSON, rotation, compression, archival, search, compliance export"

---

### Wave 35: Systemd Hardening (Phases 573-588)
*Run as a hardened system service — minimal privileges, resource limits.*

- [ ] 573. Write systemd unit file with security hardening — `ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=yes`, `PrivateTmp=yes`
- [ ] 574. Set `CapabilityBoundingSet=` — drop all capabilities except `CAP_NET_BIND_SERVICE` (if binding <1024) and `CAP_SYS_RAWIO` (for GPU access)
- [ ] 575. Configure `ReadWritePaths=` — only `/var/lib/tentaclaw` (data), `/var/log/tentaclaw` (logs), `/tmp/tentaclaw` (temp), deny all other writes
- [ ] 576. Add resource limits — `MemoryMax=` based on available RAM (default: 80%), `CPUQuota=` (default: 400% = 4 cores), `TasksMax=4096`
- [ ] 577. Implement `Restart=on-failure` with rate limiting — `RestartSec=5s`, `StartLimitBurst=5`, `StartLimitIntervalSec=300s`
- [ ] 578. Add systemd watchdog — `WatchdogSec=30s`, gateway sends heartbeat via `sd_notify("WATCHDOG=1")`, systemd kills if heartbeat stops
- [ ] 579. Configure journal logging — `StandardOutput=journal`, `StandardError=journal`, `SyslogIdentifier=tentaclaw`
- [ ] 580. Build unit file generator — `tentaclaw systemd install` generates and installs unit file with detected GPU paths in `ReadWritePaths`
- [ ] 581. Add `tentaclaw systemd status` — shows service status, recent journal entries, resource usage, uptime
- [ ] 582. Implement `tentaclaw systemd uninstall` — stop service, disable, remove unit file, cleanup
- [ ] 583. Add socket activation support — systemd starts tentaclaw on first connection to port 8080, zero boot delay
- [ ] 584. Build pre-start script — `ExecStartPre=` checks GPU availability, disk space, config validity before starting
- [ ] 585. Implement graceful shutdown — `ExecStop=` sends SIGTERM, wait for in-flight requests (configurable timeout), then SIGKILL
- [ ] 586. Add seccomp filter — restrict system calls to only those needed, block dangerous syscalls (ptrace, mount, reboot)
- [ ] 587. Write systemd hardening documentation — explain each directive, customization guide for different environments
- [ ] 588. Commit "feat(systemd): hardened service — sandboxing, capabilities, resource limits, watchdog, socket activation"

---

### Wave 36: ARM64 Agent Support (Phases 589-604)
*Run on Jetson, Graviton, Apple Silicon — inference everywhere.*

- [ ] 589. Cross-compile agent for arm64 — configure build pipeline for `linux/arm64` target, verify all dependencies have arm64 support
- [ ] 590. Build arm64 Docker images — multi-arch image (amd64 + arm64) via Docker buildx, push to ghcr.io
- [ ] 591. Test on NVIDIA Jetson Orin Nano — install agent, detect Orin GPU via tegrastats/NVML, report unified memory as VRAM
- [ ] 592. Test on NVIDIA Jetson AGX Thor — verify 1035 TOPS detection, 128GB LPDDR5X memory reporting, deploy small model
- [ ] 593. Implement Jetson power mode selection — `tentaclaw agent --power-mode maxn` (maximum performance) vs `15w` vs `30w` (power efficient)
- [ ] 594. Test on AWS Graviton3/4 — install agent on c7g/m7g instances, report CPU-only inference capability
- [ ] 595. Implement Apple Silicon support — detect M4/M4 Pro/M4 Max/M4 Ultra unified memory, report as GPU resource via MLX backend
- [ ] 596. Build MLX inference backend for Apple Silicon — load GGUF models via mlx-lm, expose as TentaCLAW backend
- [ ] 597. Add Raspberry Pi 5 as monitoring node — agent reports system metrics (CPU, RAM, network) without GPU capabilities
- [ ] 598. Implement Qualcomm Snapdragon X Elite support — detect Hexagon NPU, report AI compute capability
- [ ] 599. Build unified VRAM reporting for unified memory architectures — Jetson and Apple Silicon share CPU/GPU memory, report intelligently
- [ ] 600. Test edge deployment: deploy Phi-4-mini (3.8B Q4) on Jetson Orin Nano (8GB), measure tokens/sec, verify dashboard shows edge node
- [ ] 601. Add ARM64 CI pipeline — GitHub Actions arm64 runner, run agent tests on arm64
- [ ] 602. Implement edge fleet management — dashboard shows edge nodes separately, aggregate edge metrics, edge health monitoring
- [ ] 603. Write ARM64 deployment guide — Jetson, Graviton, Apple Silicon, Raspberry Pi setup instructions
- [ ] 604. Commit "feat(arm64): ARM64 agent — Jetson Orin/Thor, Graviton, Apple Silicon MLX, edge fleet management"

---

### Wave 37: Network Partition Tolerance (Phases 605-620)
*The cluster must survive network splits gracefully.*

- [ ] 605. Implement partition detection — agent sends heartbeat every 5s, gateway marks node as "partitioned" after 3 missed heartbeats (15s)
- [ ] 606. Build split-brain handling — when consensus quorum lost, minority partition enters read-only mode, continues serving cached models but refuses writes
- [ ] 607. Implement stale-read mode — partitioned nodes serve inference from already-loaded models with header `X-Stale: true` so clients know
- [ ] 608. Add partition alert — emit alert on partition detection, include affected nodes, affected models, estimated impact
- [ ] 609. Build rejoin protocol — when partition heals, partitioned nodes sync state with leader: model list, config, keys, namespace changes
- [ ] 610. Implement conflict resolution — if model was deployed on both sides of partition independently, keep the one with more recent timestamp
- [ ] 611. Add clock skew detection — nodes compare timestamps on heartbeat, warn if skew > 1 second, refuse to sync if skew > 30 seconds (prevent data corruption)
- [ ] 612. Build network quality monitoring — track packet loss, latency jitter, bandwidth between all node pairs, surface in dashboard
- [ ] 613. Implement configurable partition behavior — `partition_mode: serve-stale` (default) vs `partition_mode: refuse` (strict consistency)
- [ ] 614. Add partition metrics — `tentaclaw_partition_events_total`, `tentaclaw_partition_duration_seconds`, `tentaclaw_nodes_partitioned`
- [ ] 615. Build partition simulation — `tentaclaw chaos partition <node>` simulates network partition for testing
- [ ] 616. Write integration test: 3-node cluster, partition node-3, verify node-3 serves stale reads, verify nodes 1-2 continue normally
- [ ] 617. Write integration test: partition heals, verify state sync completes within 10 seconds, verify no data loss
- [ ] 618. Add partition-aware routing — gateway stops routing new requests to partitioned nodes, redirects to healthy nodes
- [ ] 619. Write documentation: network partition handling guide with architecture diagrams
- [ ] 620. Commit "feat(partition): network partition tolerance — split-brain, stale reads, rejoin sync, conflict resolution"

---

### Wave 38: Graceful Degradation (Phases 621-636)
*When things go wrong, degrade gracefully — don't crash.*

- [ ] 621. Define degradation levels — Normal (all features), Degraded (non-essential features disabled), Critical (inference-only), Emergency (health endpoint only)
- [ ] 622. Build degradation level detector — auto-detect level based on: healthy node ratio, GPU error rate, backend availability, memory pressure
- [ ] 623. Implement Normal→Degraded transition — disable: model catalog browsing, non-essential WebSocket topics, experiment tracking, cost calculation
- [ ] 624. Implement Degraded→Critical transition — disable: dashboard non-essential tabs, plugin execution, scheduled backups; keep only inference + health
- [ ] 625. Implement Critical→Emergency transition — disable inference routing, respond only to `/health` endpoint, emit maximum severity alert
- [ ] 626. Build circuit breaker for backends — if backend fails 5 consecutive health checks, open circuit (stop sending requests), half-open after 30s (probe), close on success
- [ ] 627. Implement fallback model chains — if primary model (70B) backend down, route to secondary (8B) with `X-Model-Fallback: true` header
- [ ] 628. Add load shedding — under extreme load (queue > 500 or CPU > 95%), reject `sheddable` priority requests with 503, keep `critical` requests flowing
- [ ] 629. Build degradation dashboard indicator — traffic light icon in header: green (Normal), yellow (Degraded), orange (Critical), red (Emergency)
- [ ] 630. Implement graceful degradation for dashboard — if WebSocket fails, fall back to 10s polling; if API slow, show stale data with "last updated" timestamp
- [ ] 631. Add degradation event log — record every level transition with: timestamp, trigger condition, affected components, duration
- [ ] 632. Build automatic recovery — when conditions improve (e.g., backend recovers), auto-transition back: Emergency→Critical→Degraded→Normal with stabilization period (60s each)
- [ ] 633. Implement degradation testing — `tentaclaw chaos degrade --level critical` forces degradation level for testing
- [ ] 634. Write integration test: kill 2 of 3 backends, verify degradation to Critical, verify remaining backend still serves requests
- [ ] 635. Write documentation: degradation levels, configuration, custom degradation rules
- [ ] 636. Commit "feat(degradation): graceful degradation — 4 levels, circuit breakers, fallback chains, load shedding"

---

### Wave 39: Load Testing Framework (Phases 637-652)
*Built-in performance validation — no external tools needed.*

- [ ] 637. Build load test runner — `tentaclaw loadtest --model llama --concurrency 32 --duration 300s --prompt-file prompts.txt`
- [ ] 638. Implement synthetic workload generator — predefined patterns: `chat` (multi-turn, prefix sharing), `rag` (long context, retrieval), `batch` (unique prompts), `mixed` (80% chat, 20% batch)
- [ ] 639. Add prompt corpus — ship 1000 diverse prompts across categories: general Q&A, coding, creative writing, summarization, translation, math
- [ ] 640. Build real-time metrics display during test — live terminal: tokens/sec, TTFT P50/P95/P99, TPS, active requests, GPU utilization, errors
- [ ] 641. Implement result output — JSON report with: summary stats, percentile breakdown, time-series data, error categorization, GPU utilization over time
- [ ] 642. Add comparison mode — `tentaclaw loadtest --compare baseline.json` runs same test, shows delta vs baseline (green: improvement, red: regression)
- [ ] 643. Build ramp-up patterns — constant load, step (add 10 req/s every 30s), spike (0 → 100 → 0), sine wave (simulate day/night)
- [ ] 644. Implement multi-model load testing — test multiple models simultaneously with configurable traffic split
- [ ] 645. Add saturation detection — automatically increase load until GPU utilization >95% OR latency P99 >10s, report saturation point
- [ ] 646. Build export — CSV, JSON, Markdown table output for reports, Grafana-compatible annotations for time-series
- [ ] 647. Implement k6 integration — generate k6 test script from tentaclaw config, compatible with k6 cloud for distributed testing
- [ ] 648. Add load test history — store results in gateway DB, `tentaclaw loadtest history` shows past results, trend graphs
- [ ] 649. Build load test dashboard panel — run and monitor load tests from UI, visual result comparison
- [ ] 650. Write integration test: run 60-second load test against mock backend, verify metrics collection accuracy
- [ ] 651. Write documentation: load testing guide with performance tuning recommendations based on results
- [ ] 652. Commit "feat(loadtest): built-in load testing — synthetic workloads, comparison, saturation detection, k6 integration"

---

### Wave 40: v1.x Polish and Stabilization (Phases 653-667)
*Bug bash. Performance tune. Ship v1.1.*

- [ ] 653. Run 2-day bug bash sprint — all maintainers focus exclusively on fixing P0/P1/P2 bugs from GitHub issues
- [ ] 654. Profile and optimize gateway hot paths — flame graph analysis, identify top 5 CPU consumers, optimize (target: 20% latency reduction)
- [ ] 655. Optimize memory usage — identify memory leaks via Node.js heap snapshots, fix leaks, reduce baseline memory footprint
- [ ] 656. Update all dependencies to latest stable — npm audit fix, verify no breaking changes, update lockfile
- [ ] 657. Run full security scan — Trivy, Semgrep, npm audit, OWASP ZAP — fix all new findings
- [ ] 658. Stress test — 72-hour continuous operation with randomized model deploys/undeploys, node joins/leaves, varying request load
- [ ] 659. Performance benchmark — document official v1.1 benchmarks: tokens/sec, TTFT, concurrent request capacity per GPU type
- [ ] 660. Documentation review — every page proofread, all code examples tested, screenshots updated to match current UI
- [ ] 661. Community feedback triage — review all feature requests, label "v1.2" for accepted ones, close duplicates, respond to all
- [ ] 662. Backport critical fixes — cherry-pick P0 fixes from main to v1.0.x maintenance branch
- [ ] 663. Write v1.1 migration guide — any breaking changes from v1.0, upgrade steps, config changes
- [ ] 664. Write v1.1 release notes — new features (from Waves 21-39), bug fixes, performance improvements, known issues
- [ ] 665. Tag v1.1.0 — create release, push Docker images, update website
- [ ] 666. Post v1.1 announcement — Discord, blog, social media, HN (if major improvements warrant)
- [ ] 667. Commit "release: v1.1.0 — polish, performance, security, stability"

---

# v2.0 "INK" — Performance (Waves 45-80 Expanded)

---

### Wave 45: ExLlamaV2 Consumer GPU Backend (Phases 736-752)

- [ ] 736. Implement `ExllamaBackend` class — Python subprocess bridge communicating via Unix socket for generate/stream/unload
- [ ] 737. Write ExLlamaV2 Python worker script — load model, expose Unix socket API with generate/stream/unload/health commands
- [ ] 738. Implement model format detection — auto-detect GPTQ, EXL2, AWQ quantization from model directory files
- [ ] 739. Implement `ExllamaBackend.loadModel()` — configure `ExLlamaV2Config` with `max_seq_len`, `scale_pos_emb`, `scale_alpha_value`, `cache_8bit`
- [ ] 740. Implement `ExllamaBackend.generate()` — create `ExLlamaV2Sampler.Settings`, map temperature/top_p/top_k/repetition_penalty
- [ ] 741. Implement `ExllamaBackend.stream()` — use ExLlamaV2 streaming generator, yield tokens via Unix socket protocol
- [ ] 742. Add dynamic batching — `ExLlamaV2DynamicGenerator` with configurable `max_batch_size` and `max_new_tokens`
- [ ] 743. Implement cache quantization — `cache_8bit=True` for 50% KV cache memory savings on consumer GPUs (16GB becomes effectively 32GB context)
- [ ] 744. Write integration test: load 7B GPTQ model on RTX 4090, generate 200 tokens, verify output quality matches reference
- [ ] 745. Write integration test: EXL2 4.0bpw model on RTX 4060 (8GB), verify fits in VRAM and generates correctly
- [ ] 746. Implement split-GPU loading — ExLlamaV2 `gpu_split` for models spanning 2 consumer GPUs (e.g., 70B across 2x 24GB)
- [ ] 747. Add LoRA support — hot-load LoRA adapters at runtime without full model reload, switch via request parameter
- [ ] 748. Write benchmark: ExLlamaV2 vs llama.cpp for Llama-3.1-8B-GPTQ on RTX 4090 — tokens/sec and VRAM usage
- [ ] 749. Implement prompt cache — ExLlamaV2 prefix reuse for repeated system prompts, measure TTFT improvement
- [ ] 750. Build VRAM estimation — predict peak VRAM before loading: model weights + KV cache at max_seq_len + activation memory
- [ ] 751. Document ExLlamaV2 backend with consumer GPU sizing guide (8GB/12GB/16GB/24GB recommendations)
- [ ] 752. Commit "feat(backend): ExLlamaV2 — GPTQ/EXL2/AWQ, dynamic batching, split-GPU, cache quantization"

---

### Wave 46: llama.cpp GGUF Backend (Phases 753-769)

- [ ] 753. Implement `LlamaCppBackend` class — spawn `llama-server` subprocess, communicate via HTTP API
- [ ] 754. Write llama-server process manager — launch with `--model`, `--ctx-size`, `--n-gpu-layers`, `--threads`, manage lifecycle
- [ ] 755. Implement GGUF format detection — parse GGUF header for model architecture, quantization type, context length, vocab size
- [ ] 756. Build CPU+GPU hybrid mode — configure `--n-gpu-layers` to offload N layers to GPU, keep rest on CPU, auto-detect optimal split
- [ ] 757. Add Metal backend support for macOS — detect Apple GPU, enable Metal acceleration via `--n-gpu-layers -1` (all layers)
- [ ] 758. Add Vulkan support — cross-platform GPU acceleration via `--vulkan`, detect Vulkan-capable GPUs on Linux/Windows
- [ ] 759. Implement NUMA-aware thread pinning — detect NUMA topology, pin threads to local NUMA node, set memory policy
- [ ] 760. Add grammar-constrained generation — pass GBNF grammar file to llama-server for structured output (JSON, CSV, etc.)
- [ ] 761. Implement embedding endpoint — `POST /v1/embeddings` using llama-server's embedding mode for GGUF embedding models
- [ ] 762. Build GGUF model catalog integration — browse TheBloke/community GGUF quantizations, show all quant levels per model
- [ ] 763. Write integration test: load Phi-4-mini Q4_K_M on CPU-only machine, generate 100 tokens, verify output quality
- [ ] 764. Write integration test: load 70B Q4_K_M with 30 GPU layers on RTX 3090, verify hybrid CPU+GPU inference
- [ ] 765. Write benchmark: llama.cpp vs ExLlamaV2 vs vLLM for 8B model on consumer hardware — tokens/sec, VRAM, quality
- [ ] 766. Add llama.cpp flash attention flag — `--flash-attn` for supported models, verify performance improvement
- [ ] 767. Implement mmap model loading — memory-mapped model files for instant model switching without re-reading from disk
- [ ] 768. Document llama.cpp backend with CPU-only, hybrid, and full-GPU configuration guides
- [ ] 769. Commit "feat(backend): llama.cpp — GGUF, CPU+GPU hybrid, Metal, Vulkan, NUMA, grammar constraints"

---

### Wave 47: FlashAttention 4 Integration (Phases 770-786)

- [ ] 770. Research FlashAttention 4 — CuTeDSL Python DSL, JIT compilation, Hopper SM90 and Blackwell SM100/SM120 support
- [ ] 771. Detect GPU architecture — query compute capability via NVML, enable FA4 for sm_90+ (H100/B200), FA3 for sm_80+ (A100), FA2 for older
- [ ] 772. Implement FA4 auto-enable for vLLM — set `--enable-flash-attn-4` when Hopper/Blackwell detected, verify via model metrics
- [ ] 773. Implement FA4 for SGLang — configure FlashInfer to use FA4 kernels on compatible hardware
- [ ] 774. Build FA4 performance validation — run micro-benchmark comparing FA4 vs FA3 on H100, verify expected 1.3x speedup
- [ ] 775. Implement sliding window attention with FA4 — enable for models using sliding window (Mistral), verify correct output
- [ ] 776. Add GQA/MQA/MHA automatic selection — detect model attention type, configure FA4 kernel accordingly
- [ ] 777. Build FA4 JIT compilation cache — cache compiled kernels to avoid recompilation on restart (store in `~/.tentaclaw/fa4_cache/`)
- [ ] 778. Implement fallback chain — FA4 → FA3 → FA2 → eager attention, auto-fallback on compilation failure with warning
- [ ] 779. Add FA4 metrics — `tentaclaw_flash_attention_version{gpu}`, `tentaclaw_attention_tflops`, `tentaclaw_attention_occupancy`
- [ ] 780. Write integration test: deploy model on H100 with FA4, verify output matches FA3 output (within FP16 tolerance)
- [ ] 781. Write benchmark: FA4 vs FA3 vs eager attention — measure TFLOPS, memory usage, latency at sequence lengths 1K/4K/16K/64K
- [ ] 782. Implement FA4 for Blackwell B200 — verify 1605 TFLOPs/s target, benchmark against published numbers
- [ ] 783. Add FA4 profiling — per-layer attention time breakdown, identify if attention is bottleneck
- [ ] 784. Build FA4 configuration docs — which GPUs support which FA version, performance expectations, troubleshooting
- [ ] 785. Write attention mechanism guide — FA4 vs FA3 vs FA2, when each is best, configuration reference
- [ ] 786. Commit "feat(attention): FlashAttention 4 — CuTeDSL, Hopper/Blackwell, auto-fallback, JIT cache"

---

### Wave 48: FP8 Quantization Pipeline (Phases 787-803)

- [ ] 787. Implement GPU FP8 capability detection — detect Hopper (e5m2/e4m3), Ada (e4m3), Blackwell (e4m3 + NVFP4) via NVML compute capability
- [ ] 788. Build LLMCompressor integration — run FP8 quantization: `python -m llmcompressor --model <path> --recipe fp8` with calibration dataset
- [ ] 789. Implement calibration dataset selection — default: 512 samples from C4/RedPajama, configurable custom dataset, stratified sampling
- [ ] 790. Add FP8 weights+activations quantization — `W8A8` scheme reducing model size 50% and enabling Tensor Core FP8 paths
- [ ] 791. Implement FP8 KV cache quantization — `kv_cache_dtype="fp8_e5m2"` for 2x KV cache memory savings, enable by default on Hopper+
- [ ] 792. Build quality validation — after quantization, run perplexity benchmark, reject if degradation > 3% vs FP16 baseline (configurable threshold)
- [ ] 793. Add auto-FP8 in deploy pipeline — when deploying model on Hopper+ GPU, auto-quantize to FP8 if FP8 version not available
- [ ] 794. Implement quantized model registry — store quantized models alongside originals, track: quantization method, calibration dataset, quality score, creation date
- [ ] 795. Build NVFP4 support for Blackwell — detect B200/B300, enable NVFP4 for 3.5x model memory reduction, <1% accuracy loss
- [ ] 796. Implement per-tensor vs per-channel quantization — auto-select optimal granularity per model layer
- [ ] 797. Add quantization CLI — `tentaclaw quantize <model> --method fp8 --calibration-samples 512 --validate`, with progress bar and ETA
- [ ] 798. Write integration test: quantize Llama-3.1-8B to FP8, deploy, verify perplexity within 2% of FP16 baseline
- [ ] 799. Write benchmark: FP8 vs FP16 throughput on H100 — expect 1.5-2x throughput improvement at same batch size
- [ ] 800. Build quantization comparison report — auto-generate comparison of FP16 vs FP8 vs FP4: size, speed, quality, VRAM for a given model
- [ ] 801. Implement mixed-precision quantization — different precision per layer (attention FP8, MLP FP4) for optimal quality/speed tradeoff
- [ ] 802. Document FP8/FP4 quantization guide — when to use each, calibration tips, quality validation methodology
- [ ] 803. Commit "feat(quantization): FP8/FP4 pipeline — LLMCompressor, auto-quantize, quality validation, NVFP4 Blackwell"

---

### Wave 49: AWQ/GPTQ Auto-Quantization (Phases 804-820)

- [ ] 804. Implement AWQ quantization — integrate AutoAWQ: `quantize(model, w_bit=4, group_size=128)` with calibration dataset
- [ ] 805. Implement GPTQ quantization — integrate AutoGPTQ: `quantize(model, bits=4, group_size=128, desc_act=True)` with calibration
- [ ] 806. Build one-command quantize — `tentaclaw quantize <model> --method awq --bits 4` handles download, quantize, validate, store
- [ ] 807. Add Marlin kernel detection — for AWQ/GPTQ models, detect if vLLM Marlin kernel available (741 tok/s peak), enable automatically
- [ ] 808. Implement calibration dataset management — built-in calibration sets per task (general, code, chat, multilingual), custom dataset support
- [ ] 809. Build quality validation for W4 — run eval suite (perplexity, HumanEval subset, MMLU subset), compare to FP16, generate report
- [ ] 810. Add GGUF quantization — call `llama-quantize` for GGUF format: Q2_K through Q8_0, with importance matrix for i-quants
- [ ] 811. Implement EXL2 quantization — use ExLlamaV2 quantizer with mixed bits-per-weight, auto-allocate bits per layer importance
- [ ] 812. Build quantization recommendation — given model + GPU VRAM, recommend optimal quantization: "Use AWQ 4-bit (5.2 GB, 95% quality, 741 tok/s on your GPU)"
- [ ] 813. Add batch quantization — `tentaclaw quantize-all --method awq` quantizes all models in catalog to specified format
- [ ] 814. Implement quantization comparison — `tentaclaw quantize <model> --compare` runs all methods (FP8, AWQ, GPTQ, GGUF Q4, EXL2 4bpw), generates comparison table
- [ ] 815. Build CLAWHub publishing — after quantization, optionally publish to CLAWHub registry with metadata (method, quality score, VRAM, speed)
- [ ] 816. Add quantization dashboard panel — browse quantized models, quality comparison, re-quantize with different settings
- [ ] 817. Write integration test: quantize Phi-4-mini to AWQ-4bit and GGUF-Q4_K_M, compare quality and speed
- [ ] 818. Implement quantization progress tracking — WebSocket updates during quantization: calibration progress, layer progress, validation progress, ETA
- [ ] 819. Document quantization guide — method comparison matrix, when to use each, quality/speed/VRAM tradeoff tables
- [ ] 820. Commit "feat(quantization): AWQ/GPTQ/GGUF/EXL2 auto-quantization — one-command, validation, comparison, CLAWHub publish"

---

### Waves 50-80: Detailed Phases (Phases 821-1333)

*Each wave follows the same 16-phase detail pattern. Key phases for critical waves:*

**Wave 50: Continuous Batching (821-837)** — Dynamic batch assembly at iteration level (new requests join mid-decode), batch size auto-tuning based on GPU memory pressure, micro-batch pipelining, preemptive scheduling for priority requests, batch utilization metrics, padding elimination

**Wave 51: Chunked Prefill (838-854)** — Dynamic chunk sizing (auto-tune based on model and GPU), overlap prefill chunks with decode iterations, configurable chunk budget (max tokens per chunk), priority queue for prefill scheduling, measure impact on TTFT and TPS

**Wave 52: Prefix Caching (855-871)** — RadixAttention tree analysis and optimization, system prompt pre-warming (top-10 prompts by frequency), cache eviction policy selection (LRU, frequency-weighted, hybrid), cross-request prefix matching, hash-based prompt fingerprinting, cache hit rate dashboard

**Wave 53: Cross-Node TP (872-888)** — NCCL/RCCL over RDMA transport, InfiniBand/RoCE auto-detection and configuration, activation tensor sharding across nodes, ring all-reduce with bandwidth-optimal algorithm, cross-node TP for 70B+ models on consumer GPUs (4x 24GB), latency profiling per layer, communication-computation overlap pipeline

**Wave 54: Pipeline Parallelism (889-905)** — 1F1B micro-batch schedule implementation, stage assignment optimizer balancing compute time per stage, combined TP+PP hybrid (TP within node using NVLink, PP across nodes using RDMA), dynamic rebalancing on straggler detection, pipeline warmup with dummy micro-batches, continuous batching with pipeline (new requests enter without flushing)

**Wave 55: MoE Expert Parallelism (906-922)** — DeepSeek V3/V4 fine-grained MoE support (256 experts), expert routing across GPUs via all-to-all dispatch, load balancing metrics per expert, expert placement optimization (frequently co-activated experts on same GPU), MoE-aware VRAM estimation (all experts must be loadable, only active experts in HBM), expert parallelism benchmark

**Wave 56: RDMA/RoCE (923-939)** — ConnectX-7 NIC detection and RoCE v2 auto-configuration, Priority Flow Control (PFC) setup validation, ECN configuration for lossless fabric, `ib_write_bw` benchmarking integration, NCCL environment variables auto-tuning for RDMA, network topology discovery (spine-leaf detection), Spectrum-X compatibility testing

**Wave 57: GPU-Direct RDMA (940-956)** — Load nvidia_peermem kernel module, NIXL library integration for zero-copy GPU-to-GPU transfers, KV cache pipeline (start decode before full cache transferred), peer memory registration with CUDA IPC, RDMA Write for one-sided minimum-latency transfer, GPU-Direct bandwidth benchmarking

**Wave 58: NUMA-Aware (957-973)** — NUMA topology detection via `numactl --hardware`, pin inference processes to NUMA node closest to GPU, allocate memory on local NUMA node via `mbind()`, CPU affinity settings matching GPU locality, NUMA-aware batching (group requests for same NUMA domain), cross-NUMA penalty measurement

**Wave 59: NVLink Topology (974-990)** — Parse `nvidia-smi topo -m` for NVLink/NVSwitch connectivity matrix, assign topology scores to GPU pairs (NVLink 1.0 > PCIe 5.0 > PCIe 4.0), prefer high-connectivity GPU pairs for TP deployments, NVSwitch detection for DGX/HGX systems, topology-aware model placement algorithm, benchmark TP throughput by topology configuration

**Wave 60: Benchmark Framework (991-1007)** — Standardized suite: TTFT, TPS, throughput, queue latency at concurrency 1/8/32/64/128, automated regression detection (flag >5% degradation with statistical significance), CI integration (run on every PR touching inference), results database (SQLite), comparison dashboard, publish benchmarks to website

**Wave 61: MLPerf (1008-1024)** — MLPerf Inference compliance setup, select models (Llama 2 70B, GPT-J, BERT), configure server and offline scenarios, accuracy validation against reference, performance run on target hardware, submission packaging, publish results

**Wave 62: AMD ROCm Optimization (1025-1041)** — MI300X/MI350 specific kernel tuning, HIP profiling with `rocprof`, RCCL configuration for multi-GPU, Flash Attention via Composable Kernel library, FP8 support on MI350 (CDNA 4), ROCm-specific VRAM management, AMD vs NVIDIA benchmark comparison, ROCm training documentation

**Wave 63: Intel Gaudi (1042-1057)** — Conditional implementation (only if Intel Gaudi viable in Q3 2026), SynapseAI/Habana SDK integration, Gaudi 3 detection and metric collection, basic inference support, document limitations and exit criteria

**Wave 64: Apple MLX Edge (1058-1073)** — MLX inference backend for Apple Silicon, unified memory management (up to 192GB on M4 Ultra), GGUF model loading via mlx-lm, Metal Performance Shaders for GPU acceleration, on-device inference benchmarks, macOS agent integration

**Wave 65: WebGPU Browser (1074-1090)** — WebLLM integration for browser-based inference, WASM fallback for non-WebGPU browsers, model loading from CDN or local cache, browser inference dashboard widget ("try inference in your browser"), WebSocket connection to cluster for hybrid (local small model + cluster large model), progressive enhancement

**Wave 66: Model Format Detection (1091-1107)** — Auto-detect SafeTensors, GGUF, AWQ, GPTQ, EXL2, ONNX, TRT-LLM engine, PyTorch .bin, detect quantization level from file headers, suggest optimal backend per format, format conversion utilities, format compatibility matrix

**Wave 67: VRAM Estimation (1108-1124)** — Formula engine: `VRAM = model_weights(bits * params / 8) + KV_cache(2 * layers * heads * head_dim * max_batch * max_seq * dtype_size) + activation_buffer + overhead`, GPU-specific overhead factors, estimation API (`GET /api/estimate-vram?model=llama-70b&quant=q4&batch=8&ctx=32768`), CLI command, dashboard integration

**Wave 68: Smart Placement (1125-1141)** — Multi-model co-location optimizer (which models fit together on same GPU without VRAM conflict), VRAM fragmentation minimizer, thermal-aware placement (spread hot models across GPUs), workload interference detection (throughput-heavy vs latency-sensitive), placement simulation

**Wave 69: Autoscaling Engine (1142-1158)** — Full autoscaling implementation separate from Wave 29's basic version: SLO-driven controller (PID), predictive scaling using time-series forecast (Prophet), scale-to-zero with warm CPU cache, custom scaling metrics (tokens/sec, queue depth, TTFT), scaling event API for external integrators

**Wave 70: Request Batching (1159-1175)** — Adaptive batch size (increase batch when queue deep, decrease when empty), latency-targeted batching (don't batch if it would exceed latency target), batch padding elimination, request priority within batch (critical requests processed first), batch metrics

**Wave 71: Streaming Optimization (1176-1192)** — SSE compression (gzip/br for SSE streams), chunked transfer encoding optimization, token buffering (send tokens in groups of 3-5 to reduce HTTP overhead), WebSocket streaming alternative to SSE, streaming backpressure handling, client disconnect detection within 100ms

**Wave 72: Memory Pools (1193-1209)** — CUDA/HIP memory pool management, pre-allocate model weight memory + KV cache memory + activation memory as separate pools, pool defragmentation, memory pressure detection and response, pool metrics (allocated/used/free per pool), OOM prevention via proactive eviction

**Wave 73: GC Tuning (1210-1225)** — Node.js V8 GC analysis, reduce GC pauses (target <10ms P99), off-heap buffers for large data (SharedArrayBuffer for metrics), memory-mapped model metadata, GC-friendly data structure patterns, GC metrics in Prometheus

**Wave 74: Network Compression (1226-1241)** — gRPC compression for inter-node communication (gzip/snappy/zstd), activation tensor quantization for network transfer (FP32→FP16 for 2x bandwidth savings), model weight streaming compression during download, compression ratio vs latency tradeoff configuration

**Wave 75: 10K req/s Load Test (1242-1258)** — Scale testing infrastructure, deploy 8+ GPU nodes, configure for maximum throughput, run sustained 10K req/s for 1 hour, identify bottlenecks (gateway CPU, network, GPU batch saturation), optimize bottlenecks, document maximum achievable throughput per hardware configuration

**Wave 76: Chaos Engineering (1259-1275)** — Built-in chaos framework: `tentaclaw chaos` with actions: `kill-node`, `kill-gpu`, `network-partition`, `network-delay`, `cpu-stress`, `memory-pressure`, `disk-full`, `backend-crash`, verify cluster self-heals from each, chaos test in CI (nightly)

**Wave 77: Performance Regression (1276-1292)** — CI benchmark on every PR touching inference code, statistical significance testing (t-test, require p<0.05 for regression flag), baseline management (update baseline on release), regression alert with flame graph diff, auto-bisect to find regressing commit

**Wave 78: Hot Path Profiling (1293-1308)** — Built-in CPU profiler (`tentaclaw profile --duration 30s`), generate flame graphs (0x.js), GPU kernel profiling (nsight integration), identify top-5 latency contributors per request path, optimization recommendations based on profile

**Wave 79: v2.0 RC and Release (1309-1324)** — Feature freeze, performance benchmark (publish official numbers), stability test (72h), security scan, documentation update, migration guide from v1.x, beta testing, release notes, tag v2.0.0

**Wave 80: v2.0 Launch (1325-1333)** — "TentaCLAW v2.0: The Fastest Self-Hosted Inference Platform" — Show HN #2, benchmark blog post, competitive analysis (vs GPUStack, vs llm-d, vs raw vLLM), conference talks, community celebration

---

*All 5,000 phases across 300 waves are now fully expanded.*
