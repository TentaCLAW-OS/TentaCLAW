/* ============================================================
   TentaCLAW HiveMind Dashboard — app.js
   Vanilla JS, no frameworks, no SaaS, no mercy.
   ============================================================ */

(function () {
  'use strict';

  // ---- State ----
  const state = {
    nodes: [],
    summary: {},
    flightSheets: [],
    events: [],
    sseConnected: false,
    commandTarget: null, // { nodeId, hostname }
  };

  const MAX_LOG_ENTRIES = 50;
  const MAX_TERMINAL_LINES = 200;
  const POLL_INTERVAL = 5000;

  // ---- Terminal state ----
  var terminalLines = [];
  var terminalPaused = false;
  var terminalFilter = 'all';
  var terminalCommandHistory = [];
  var terminalHistoryIdx = -1;

  // ---- CLAWtopus quotes ----
  const QUOTES = [
    '"I have eight arms and zero patience for your YAML."',
    '"SaaS? I barely know her. And I don\'t want to."',
    '"My tentacles reach every GPU in this cluster."',
    '"Latency is just distance measured in disappointment."',
    '"One does not simply \'scale horizontally\' without me."',
    '"I eat tokens for breakfast. Thousands per second."',
    '"Your models are safe with me. All eight arms on deck."',
    '"Cloud? I am the cloud. A local, self-hosted cloud."',
    '"I run inference like I run my life: parallel and fast."',
    '"404 SaaS not found. You\'re welcome."',
    '"Uptime is a lifestyle, not a metric."',
    '"Tentacles > microservices. Fight me."',
    '"I don\'t phone home. Home phones me."',
    '"Open source or open the door. Your choice."',
    '"Every GPU deserves a good squeeze."',
    '"My inference pipeline is longer than my tentacles."',
    '"Keep calm and run local."',
  ];

  let quoteIndex = 0;

  // ---- DOM refs ----
  const $ = function (sel) { return document.querySelector(sel); };

  const dom = {
    healthBadge:    $('#health-badge'),
    quote:          $('#claw-quote'),
    sumNodes:       $('#sum-nodes'),
    sumOnline:      $('#sum-online'),
    sumGpus:        $('#sum-gpus'),
    sumVram:        $('#sum-vram'),
    sumToks:        $('#sum-toks'),
    sumRequests:    $('#sum-requests'),
    nodeGrid:       $('#node-grid'),
    emptyState:     $('#empty-state'),
    flightPanel:    $('#flight-panel'),
    btnToggleFlight:$('#btn-toggle-flight'),
    btnCloseFlight: $('#btn-close-flight'),
    fsName:         $('#fs-name'),
    fsDesc:         $('#fs-desc'),
    fsTargets:      $('#fs-targets'),
    btnAddTarget:   $('#btn-add-target'),
    btnCreateFs:    $('#btn-create-fs'),
    fsList:         $('#fs-list'),
    cmdModal:       $('#cmd-modal'),
    cmdNodeName:    $('#cmd-node-name'),
    cmdAction:      $('#cmd-action'),
    cmdModel:       $('#cmd-model'),
    cmdGpu:         $('#cmd-gpu'),
    btnCloseCmd:    $('#btn-close-cmd'),
    btnCancelCmd:   $('#btn-cancel-cmd'),
    btnSendCmd:     $('#btn-send-cmd'),
    logEntries:     $('#log-entries'),
    btnClearLog:    $('#btn-clear-log'),
    // Terminal
    terminalOutput:     $('#terminal-output'),
    terminalInput:      $('#terminal-input'),
    terminalFilter:     $('#terminal-filter'),
    btnTerminalPause:   $('#btn-terminal-pause'),
    btnTerminalClear:   $('#btn-terminal-clear'),
    terminalHealthScore:$('#terminal-health-score'),
  };

  // ---- Helpers ----
  function formatBytes(mb) {
    if (mb == null) return '--';
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return Math.round(mb) + ' MB';
  }

  function formatBytesNetwork(bytes) {
    if (bytes == null) return '--';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }

  function formatUptime(secs) {
    if (secs == null) return '--';
    var d = Math.floor(secs / 86400);
    var h = Math.floor((secs % 86400) / 3600);
    var m = Math.floor((secs % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function pct(used, total) {
    if (!total) return 0;
    return Math.min(100, Math.max(0, (used / total) * 100));
  }

  function tempClass(c) {
    if (c >= 80) return 'temp-hot';
    if (c >= 60) return 'temp-warm';
    return 'temp-cool';
  }

  function barColorClass(p) {
    if (p >= 90) return 'red';
    if (p >= 75) return 'yellow';
    if (p >= 50) return 'teal';
    return 'cyan';
  }

  function timestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
  }

  /** Create a text span with given class and content */
  function mkSpan(cls, text) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }

  /** Create a labeled stat like: "Label: <val>value</val>" */
  function mkStatSpan(label, value, valClass) {
    var s = document.createElement('span');
    s.appendChild(document.createTextNode(label + ': '));
    s.appendChild(mkSpan(valClass || 'val', value));
    return s;
  }

  // ---- API ----
  async function api(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch(path, opts);
    if (!res.ok) {
      var text = await res.text().catch(function () { return ''; });
      throw new Error('API ' + method + ' ' + path + ' failed: ' + res.status + ' ' + text);
    }
    return res.json();
  }

  // ---- Health check ----
  async function checkHealth() {
    try {
      await fetch('/health');
      dom.healthBadge.textContent = 'ONLINE';
      dom.healthBadge.className = 'health-badge ok';
    } catch (e) {
      dom.healthBadge.textContent = 'OFFLINE';
      dom.healthBadge.className = 'health-badge err';
    }
  }

  // ---- Fetch data ----
  async function fetchNodes() {
    try {
      var data = await api('GET', '/api/v1/nodes');
      state.nodes = Array.isArray(data) ? data : (data.nodes || data.data || []);
      renderNodes();
      updateNodeSelectors();
    } catch (e) {
      logEvent('system', 'Failed to fetch nodes: ' + e.message);
    }
  }

  async function fetchSummary() {
    try {
      var data = await api('GET', '/api/v1/summary');
      state.summary = data;
      renderSummary();
    } catch (e) {
      computeSummaryFromNodes();
    }
  }

  function computeSummaryFromNodes() {
    var nodes = state.nodes;
    var totalGpus = 0, totalVramMb = 0, usedVramMb = 0, totalToks = 0, totalRequests = 0;
    var onlineCount = 0;

    nodes.forEach(function (n) {
      var isOnline = n.status === 'online' || n.is_online || n.online;
      if (isOnline) onlineCount++;
      totalGpus += n.gpu_count || (n.gpus ? n.gpus.length : 0);
      if (n.gpus) {
        n.gpus.forEach(function (g) {
          totalVramMb += g.vramTotalMb || 0;
          usedVramMb += g.vramUsedMb || 0;
        });
      }
      totalToks += n.toks_per_sec || 0;
      totalRequests += n.requests_completed || 0;
    });

    state.summary = {
      total_nodes: nodes.length,
      online_nodes: onlineCount,
      total_gpus: totalGpus,
      total_vram_mb: totalVramMb,
      used_vram_mb: usedVramMb,
      total_toks_per_sec: totalToks,
      total_requests: totalRequests,
    };
    renderSummary();
  }

  async function fetchFlightSheets() {
    try {
      var data = await api('GET', '/api/v1/flight-sheets');
      state.flightSheets = Array.isArray(data) ? data : (data.flight_sheets || data.data || []);
      renderFlightSheets();
    } catch (e) {
      logEvent('system', 'Failed to fetch flight sheets: ' + e.message);
    }
  }

  // ---- SSE ----
  function connectSSE() {
    var evtSource = new EventSource('/api/v1/events');

    evtSource.onopen = function () {
      state.sseConnected = true;
      logEvent('system', 'SSE connected. Real-time updates active.');
    };

    evtSource.onmessage = function (event) {
      handleSSEMessage(event);
    };

    ['stats_update', 'node_online', 'node_offline', 'command_sent', 'alert', 'benchmark_complete'].forEach(function (evtType) {
      evtSource.addEventListener(evtType, function (event) {
        handleSSEEvent(evtType, event);
      });
    });

    evtSource.onerror = function () {
      state.sseConnected = false;
      logEvent('system', 'SSE disconnected. Reconnecting...');
    };
  }

  function handleSSEMessage(event) {
    try {
      var data = JSON.parse(event.data);
      var type = data.type || data.event || 'unknown';
      handleSSEEvent(type, { data: event.data });
    } catch (e) {
      logEvent('info', event.data);
    }
  }

  function handleSSEEvent(type, event) {
    var data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      data = { raw: event.data };
    }

    switch (type) {
      case 'stats_update':
        if (data.node_id) {
          updateNodeInState(data);
        }
        var statsMsg = 'Stats update from ' + (data.hostname || data.node_id || 'unknown');
        logEvent(type, statsMsg);
        addTerminalLine('stats_update', statsMsg);
        break;
      case 'node_online':
        var onMsg = 'Node online: ' + (data.hostname || data.node_id || 'unknown');
        logEvent(type, onMsg);
        addTerminalLine('node_online', onMsg);
        fetchNodes();
        fetchSummary();
        break;
      case 'node_offline':
        var offMsg = 'Node offline: ' + (data.hostname || data.node_id || 'unknown');
        logEvent(type, offMsg);
        addTerminalLine('node_offline', offMsg);
        fetchNodes();
        fetchSummary();
        break;
      case 'command_sent':
        var cmdMsg = 'Command sent: ' + (data.action || 'unknown') + ' -> ' + (data.hostname || data.node_id || 'unknown');
        logEvent(type, cmdMsg);
        addTerminalLine('command_sent', cmdMsg);
        break;
      case 'alert':
        var alertMsg = 'ALERT: ' + (data.message || data.alert || data.description || JSON.stringify(data).substring(0, 100));
        logEvent(type, alertMsg);
        addTerminalLine('alert', alertMsg);
        break;
      case 'benchmark_complete':
        var benchMsg = 'Benchmark complete: ' + (data.model || 'unknown') + ' — ' + (data.result || data.toks_per_sec || JSON.stringify(data).substring(0, 80));
        logEvent(type, benchMsg);
        addTerminalLine('benchmark_complete', benchMsg);
        break;
      default:
        var defaultMsg = type + ': ' + JSON.stringify(data).substring(0, 120);
        logEvent('info', defaultMsg);
        addTerminalLine('info', defaultMsg);
    }
  }

  function updateNodeInState(payload) {
    var idx = state.nodes.findIndex(function (n) { return n.node_id === payload.node_id; });
    if (idx >= 0) {
      Object.assign(state.nodes[idx], payload);
    } else {
      state.nodes.push(payload);
    }
    renderNodes();
    computeSummaryFromNodes();
  }

  // ---- Render: Summary ----
  function renderSummary() {
    var s = state.summary;
    dom.sumNodes.textContent = s.total_nodes != null ? s.total_nodes : state.nodes.length;
    dom.sumOnline.textContent = s.online_nodes != null ? s.online_nodes : '--';
    dom.sumGpus.textContent = s.total_gpus != null ? s.total_gpus : '--';

    if (s.total_vram_mb != null) {
      var used = s.used_vram_mb || 0;
      dom.sumVram.textContent = formatBytes(used) + ' / ' + formatBytes(s.total_vram_mb);
    } else {
      dom.sumVram.textContent = '--';
    }

    dom.sumToks.textContent = s.total_toks_per_sec != null ? s.total_toks_per_sec.toFixed(1) : '--';
    dom.sumRequests.textContent = s.total_requests != null ? s.total_requests.toLocaleString() : '--';
  }

  // ---- Render: Nodes ----
  function renderNodes() {
    dom.nodeGrid.querySelectorAll('.node-card').forEach(function (el) { el.remove(); });

    if (state.nodes.length === 0) {
      if (dom.emptyState) dom.emptyState.style.display = '';
      return;
    }

    if (dom.emptyState) dom.emptyState.style.display = 'none';

    state.nodes.forEach(function (node) {
      var card = buildNodeCard(node);
      dom.nodeGrid.appendChild(card);
    });
  }

  function buildNodeCard(node) {
    var isOnline = node.status === 'online' || node.is_online || node.online !== false;
    var card = document.createElement('div');
    card.className = 'node-card' + (isOnline ? '' : ' offline');
    card.dataset.nodeId = node.node_id || '';

    // Header
    var header = document.createElement('div');
    header.className = 'node-header';

    var left = document.createElement('div');
    var hostname = document.createElement('span');
    hostname.className = 'node-hostname';
    hostname.textContent = node.hostname || node.node_id || 'Unknown';
    left.appendChild(hostname);

    var badge = document.createElement('span');
    badge.className = 'status-badge ' + (isOnline ? 'online' : 'offline');
    var dot = document.createElement('span');
    dot.className = 'status-dot';
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(isOnline ? 'online' : 'offline'));

    var actions = document.createElement('div');
    actions.className = 'node-actions';

    var cmdBtn = document.createElement('button');
    cmdBtn.className = 'btn btn-small';
    cmdBtn.textContent = 'CMD';
    cmdBtn.title = 'Send command';
    cmdBtn.addEventListener('click', function () {
      openCommandModal(node.node_id, node.hostname || node.node_id);
    });
    actions.appendChild(cmdBtn);

    left.appendChild(badge);
    header.appendChild(left);
    header.appendChild(actions);
    card.appendChild(header);

    // Node ID + uptime
    var meta = document.createElement('div');
    meta.style.display = 'flex';
    meta.style.justifyContent = 'space-between';
    meta.style.alignItems = 'center';

    var nodeIdEl = document.createElement('span');
    nodeIdEl.className = 'node-id';
    nodeIdEl.textContent = node.node_id ? 'ID: ' + node.node_id.substring(0, 12) + '...' : '';
    meta.appendChild(nodeIdEl);

    var uptimeEl = document.createElement('span');
    uptimeEl.className = 'node-uptime';
    uptimeEl.textContent = 'up ' + formatUptime(node.uptime_secs);
    meta.appendChild(uptimeEl);

    card.appendChild(meta);

    // GPUs
    if (node.gpus && node.gpus.length > 0) {
      var gpuList = document.createElement('div');
      gpuList.className = 'gpu-list';

      node.gpus.forEach(function (gpu, i) {
        var gc = document.createElement('div');
        gc.className = 'gpu-card';

        var gcHeader = document.createElement('div');
        gcHeader.className = 'gpu-card-header';

        var gpuName = document.createElement('span');
        gpuName.className = 'gpu-name';
        gpuName.textContent = '#' + i + ' ' + (gpu.name || 'GPU ' + i);
        gpuName.title = gpu.name || '';
        gcHeader.appendChild(gpuName);

        var gpuStats = document.createElement('div');
        gpuStats.className = 'gpu-stats';

        // Temperature
        var tempC = gpu.temperatureC != null ? gpu.temperatureC : '--';
        var tempStat = document.createElement('span');
        tempStat.className = 'gpu-stat';
        tempStat.appendChild(mkSpan('val ' + tempClass(tempC), String(tempC)));
        tempStat.appendChild(mkSpan('unit', '\u00B0C'));
        gpuStats.appendChild(tempStat);

        // Power
        var pwrStat = document.createElement('span');
        pwrStat.className = 'gpu-stat';
        pwrStat.appendChild(mkSpan('val', gpu.powerDrawW != null ? Math.round(gpu.powerDrawW) + '' : '--'));
        pwrStat.appendChild(mkSpan('unit', 'W'));
        gpuStats.appendChild(pwrStat);

        // Fan
        var fanStat = document.createElement('span');
        fanStat.className = 'gpu-stat';
        fanStat.appendChild(mkSpan('val', gpu.fanSpeedPct != null ? Math.round(gpu.fanSpeedPct) + '' : '--'));
        fanStat.appendChild(mkSpan('unit', '%fan'));
        gpuStats.appendChild(fanStat);

        gcHeader.appendChild(gpuStats);
        gc.appendChild(gcHeader);

        // VRAM bar
        var vramPct = pct(gpu.vramUsedMb, gpu.vramTotalMb);
        gc.appendChild(buildProgressRow(
          'VRAM',
          vramPct,
          formatBytes(gpu.vramUsedMb) + ' / ' + formatBytes(gpu.vramTotalMb),
          'purple'
        ));

        // Utilization bar
        var utilPct = gpu.utilizationPct != null ? gpu.utilizationPct : 0;
        gc.appendChild(buildProgressRow(
          'UTIL',
          utilPct,
          utilPct.toFixed(0) + '%',
          'cyan'
        ));

        gpuList.appendChild(gc);
      });

      card.appendChild(gpuList);
    }

    // CPU bar
    if (node.cpu) {
      var cpuPct = node.cpu.usage_pct != null ? node.cpu.usage_pct : 0;
      var cpuLabel = cpuPct.toFixed(1) + '%' + (node.cpu.temp_c != null ? ' / ' + node.cpu.temp_c + '\u00B0C' : '');
      card.appendChild(buildProgressRow('CPU', cpuPct, cpuLabel, barColorClass(cpuPct)));
    }

    // RAM bar
    if (node.ram) {
      var ramPct = pct(node.ram.used_mb, node.ram.total_mb);
      card.appendChild(buildProgressRow(
        'RAM',
        ramPct,
        formatBytes(node.ram.used_mb) + ' / ' + formatBytes(node.ram.total_mb),
        barColorClass(ramPct)
      ));
    }

    // Disk bar
    if (node.disk) {
      var diskPct = pct(node.disk.used_gb, node.disk.total_gb);
      card.appendChild(buildProgressRow(
        'DISK',
        diskPct,
        node.disk.used_gb + ' / ' + node.disk.total_gb + ' GB',
        barColorClass(diskPct)
      ));
    }

    // Models
    if (node.inference) {
      var modelsSection = document.createElement('div');
      modelsSection.className = 'models-section';

      if (node.inference.loaded_models && node.inference.loaded_models.length > 0) {
        var label = document.createElement('div');
        label.className = 'models-label';
        label.textContent = 'Loaded Models';
        modelsSection.appendChild(label);

        var tagsDiv = document.createElement('div');
        node.inference.loaded_models.forEach(function (m) {
          var tag = document.createElement('span');
          tag.className = 'model-tag';
          tag.textContent = m;
          tagsDiv.appendChild(tag);
        });
        modelsSection.appendChild(tagsDiv);
      }

      // Inference stats
      var infStats = document.createElement('div');
      infStats.className = 'inference-stats';
      infStats.appendChild(mkStatSpan('In-flight', node.inference.in_flight_requests != null ? String(node.inference.in_flight_requests) : '--'));
      infStats.appendChild(mkStatSpan('Tokens', node.inference.tokens_generated != null ? node.inference.tokens_generated.toLocaleString() : '--'));
      infStats.appendChild(mkStatSpan('Latency', node.inference.avg_latency_ms != null ? node.inference.avg_latency_ms.toFixed(1) + 'ms' : '--'));
      modelsSection.appendChild(infStats);

      card.appendChild(modelsSection);
    }

    // tok/s and network at bottom
    var footer = document.createElement('div');
    footer.className = 'inference-stats';
    footer.style.borderTop = '1px solid var(--border)';
    footer.style.paddingTop = '6px';
    footer.style.marginTop = '2px';

    footer.appendChild(mkStatSpan('tok/s', node.toks_per_sec != null ? node.toks_per_sec.toFixed(1) : '--'));
    footer.appendChild(mkStatSpan('reqs', node.requests_completed != null ? node.requests_completed.toLocaleString() : '--'));

    if (node.network) {
      footer.appendChild(mkStatSpan('net in', formatBytesNetwork(node.network.bytes_in)));
      footer.appendChild(mkStatSpan('out', formatBytesNetwork(node.network.bytes_out)));
    }

    card.appendChild(footer);

    return card;
  }

  function buildProgressRow(label, percent, text, colorClass) {
    var row = document.createElement('div');
    row.className = 'progress-row';

    var lbl = document.createElement('span');
    lbl.className = 'progress-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    var bar = document.createElement('div');
    bar.className = 'progress-bar';

    var fill = document.createElement('div');
    fill.className = 'progress-fill ' + (colorClass || 'cyan');
    fill.style.width = Math.min(100, Math.max(0, percent)).toFixed(1) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);

    var txt = document.createElement('span');
    txt.className = 'progress-text';
    txt.textContent = text;
    row.appendChild(txt);

    return row;
  }

  // ---- Render: Flight Sheets ----
  function renderFlightSheets() {
    var container = dom.fsList;
    container.textContent = '';

    if (state.flightSheets.length === 0) {
      var p = document.createElement('p');
      p.className = 'dim';
      p.textContent = 'No flight sheets yet.';
      container.appendChild(p);
      return;
    }

    state.flightSheets.forEach(function (fs) {
      var card = document.createElement('div');
      card.className = 'fs-card';

      var header = document.createElement('div');
      header.className = 'fs-card-header';

      var name = document.createElement('span');
      name.className = 'fs-card-name';
      name.textContent = fs.name;
      header.appendChild(name);

      var applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-small btn-primary';
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', function () {
        applyFlightSheet(fs.id || fs._id);
      });
      header.appendChild(applyBtn);

      card.appendChild(header);

      if (fs.description) {
        var desc = document.createElement('div');
        desc.className = 'fs-card-desc';
        desc.textContent = fs.description;
        card.appendChild(desc);
      }

      if (fs.targets && fs.targets.length > 0) {
        var targets = document.createElement('div');
        targets.className = 'fs-card-targets';
        fs.targets.forEach(function (t, ti) {
          if (ti > 0) targets.appendChild(document.createTextNode(', '));
          var modelSpan = document.createElement('span');
          modelSpan.textContent = t.model || '?';
          targets.appendChild(modelSpan);
          targets.appendChild(document.createTextNode(' -> ' + (t.node_id ? t.node_id.substring(0, 8) : '?')));
        });
        card.appendChild(targets);
      }

      container.appendChild(card);
    });
  }

  async function applyFlightSheet(id) {
    try {
      await api('POST', '/api/v1/flight-sheets/' + id + '/apply');
      logEvent('command_sent', 'Flight sheet ' + id + ' applied.');
      fetchNodes();
    } catch (e) {
      logEvent('system', 'Failed to apply flight sheet: ' + e.message);
    }
  }

  async function createFlightSheet() {
    var name = dom.fsName.value.trim();
    var description = dom.fsDesc.value.trim();

    if (!name) {
      dom.fsName.style.borderColor = 'var(--red)';
      setTimeout(function () { dom.fsName.style.borderColor = ''; }, 1500);
      return;
    }

    var targets = [];
    dom.fsTargets.querySelectorAll('.fs-target-row').forEach(function (row) {
      var nodeSelect = row.querySelector('[data-field="node_id"]');
      var modelInput = row.querySelector('[data-field="model"]');
      var gpuInput = row.querySelector('[data-field="gpu"]');

      var nodeId = nodeSelect ? nodeSelect.value : '';
      var model = modelInput ? modelInput.value.trim() : '';

      if (nodeId && model) {
        var target = { node_id: nodeId, model: model };
        var gpuVal = gpuInput ? gpuInput.value.trim() : '';
        if (gpuVal !== '') target.gpu = parseInt(gpuVal, 10);
        targets.push(target);
      }
    });

    try {
      await api('POST', '/api/v1/flight-sheets', { name: name, description: description, targets: targets });
      logEvent('command_sent', 'Flight sheet "' + name + '" created.');
      dom.fsName.value = '';
      dom.fsDesc.value = '';
      resetFsTargets();
      fetchFlightSheets();
    } catch (e) {
      logEvent('system', 'Failed to create flight sheet: ' + e.message);
    }
  }

  function resetFsTargets() {
    dom.fsTargets.textContent = '';
    addFsTargetRow();
  }

  function addFsTargetRow() {
    var idx = dom.fsTargets.querySelectorAll('.fs-target-row').length;
    var row = document.createElement('div');
    row.className = 'fs-target-row';
    row.dataset.idx = idx;

    var nodeSelect = document.createElement('select');
    nodeSelect.className = 'input fs-node-select';
    nodeSelect.dataset.field = 'node_id';
    var defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- node --';
    nodeSelect.appendChild(defaultOpt);
    state.nodes.forEach(function (n) {
      var opt = document.createElement('option');
      opt.value = n.node_id;
      opt.textContent = n.hostname || n.node_id;
      nodeSelect.appendChild(opt);
    });
    row.appendChild(nodeSelect);

    var modelInput = document.createElement('input');
    modelInput.type = 'text';
    modelInput.className = 'input';
    modelInput.dataset.field = 'model';
    modelInput.placeholder = 'Model';
    row.appendChild(modelInput);

    var gpuInput = document.createElement('input');
    gpuInput.type = 'number';
    gpuInput.className = 'input input-sm';
    gpuInput.dataset.field = 'gpu';
    gpuInput.placeholder = 'GPU#';
    gpuInput.min = '0';
    row.appendChild(gpuInput);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'btn-icon btn-remove-target';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.addEventListener('click', function () {
      row.remove();
    });
    row.appendChild(removeBtn);

    dom.fsTargets.appendChild(row);
  }

  function updateNodeSelectors() {
    document.querySelectorAll('.fs-node-select').forEach(function (select) {
      var currentVal = select.value;
      var defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '-- node --';
      select.textContent = '';
      select.appendChild(defaultOpt);
      state.nodes.forEach(function (n) {
        var opt = document.createElement('option');
        opt.value = n.node_id;
        opt.textContent = n.hostname || n.node_id;
        if (n.node_id === currentVal) opt.selected = true;
        select.appendChild(opt);
      });
    });
  }

  // ---- Command Modal ----
  function openCommandModal(nodeId, hostname) {
    state.commandTarget = { nodeId: nodeId, hostname: hostname };
    dom.cmdNodeName.textContent = hostname || nodeId;
    dom.cmdAction.value = 'install_model';
    dom.cmdModel.value = '';
    dom.cmdGpu.value = '';
    dom.cmdModal.classList.remove('hidden');
  }

  function closeCommandModal() {
    dom.cmdModal.classList.add('hidden');
    state.commandTarget = null;
  }

  async function sendCommand() {
    if (!state.commandTarget) return;

    var action = dom.cmdAction.value;
    var payload = { action: action };

    var model = dom.cmdModel.value.trim();
    if (model) payload.model = model;

    var gpu = dom.cmdGpu.value.trim();
    if (gpu !== '') payload.gpu = parseInt(gpu, 10);

    try {
      await api('POST', '/api/v1/nodes/' + state.commandTarget.nodeId + '/commands', payload);
      logEvent('command_sent', action + ' -> ' + state.commandTarget.hostname);
      closeCommandModal();
    } catch (e) {
      logEvent('system', 'Command failed: ' + e.message);
    }
  }

  // ---- Activity Log ----
  function logEvent(type, message) {
    var entry = {
      type: type,
      message: message,
      time: timestamp(),
    };

    state.events.unshift(entry);
    if (state.events.length > MAX_LOG_ENTRIES) {
      state.events.length = MAX_LOG_ENTRIES;
    }

    var div = document.createElement('div');
    div.className = 'log-entry event-' + type;
    div.textContent = '[' + entry.time + '] [' + type + '] ' + message;

    dom.logEntries.insertBefore(div, dom.logEntries.firstChild);

    // Trim DOM entries
    while (dom.logEntries.children.length > MAX_LOG_ENTRIES) {
      dom.logEntries.removeChild(dom.logEntries.lastChild);
    }
  }

  function clearLog() {
    state.events = [];
    dom.logEntries.textContent = '';
    logEvent('system', 'Log cleared.');
  }

  // ---- Terminal ----
  function terminalTimestamp() {
    var d = new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  /**
   * Map SSE event types to terminal type categories for filtering.
   * Returns: 'alerts' | 'commands' | 'nodes' | 'other'
   */
  function terminalCategory(type) {
    if (type === 'alert') return 'alerts';
    if (type === 'command_sent' || type === 'command') return 'commands';
    if (type === 'node_online' || type === 'node_offline') return 'nodes';
    return 'other';
  }

  function addTerminalLine(type, message) {
    var ts = terminalTimestamp();
    var entry = { type: type, message: message, ts: ts, category: terminalCategory(type) };

    terminalLines.push(entry);
    if (terminalLines.length > MAX_TERMINAL_LINES) {
      terminalLines.shift();
    }

    renderTerminalLine(entry);
  }

  function renderTerminalLine(entry) {
    // Check filter
    if (terminalFilter !== 'all' && entry.category !== terminalFilter) return;

    var line = document.createElement('div');
    line.className = 'terminal-line term-' + entry.type;

    var tsSpan = document.createElement('span');
    tsSpan.className = 'term-timestamp';
    tsSpan.textContent = '[' + entry.ts + ']';
    line.appendChild(tsSpan);

    var typeSpan = document.createElement('span');
    typeSpan.className = 'term-type';
    typeSpan.textContent = '[' + entry.type.toUpperCase() + ']';
    line.appendChild(typeSpan);

    line.appendChild(document.createTextNode(' ' + entry.message));

    dom.terminalOutput.appendChild(line);

    // Trim DOM to max lines
    while (dom.terminalOutput.children.length > MAX_TERMINAL_LINES) {
      dom.terminalOutput.removeChild(dom.terminalOutput.firstChild);
    }

    // Auto-scroll unless paused
    if (!terminalPaused) {
      dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
    }
  }

  function rebuildTerminalOutput() {
    dom.terminalOutput.textContent = '';
    terminalLines.forEach(function (entry) {
      renderTerminalLine(entry);
    });
  }

  function clearTerminal() {
    terminalLines = [];
    dom.terminalOutput.textContent = '';
    addTerminalLine('system', 'Terminal cleared.');
  }

  function toggleTerminalPause() {
    terminalPaused = !terminalPaused;
    dom.btnTerminalPause.textContent = terminalPaused ? 'Resume' : 'Pause';
    dom.btnTerminalPause.style.borderColor = terminalPaused ? 'var(--yellow)' : '';
    dom.btnTerminalPause.style.color = terminalPaused ? 'var(--yellow)' : '';
    if (!terminalPaused) {
      dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
    }
  }

  function handleTerminalFilterChange() {
    terminalFilter = dom.terminalFilter.value;
    rebuildTerminalOutput();
  }

  async function handleTerminalCommand(raw) {
    var input = raw.trim();
    if (!input) return;

    // Store in history
    terminalCommandHistory.push(input);
    if (terminalCommandHistory.length > 50) terminalCommandHistory.shift();
    terminalHistoryIdx = terminalCommandHistory.length;

    addTerminalLine('command', '$ ' + input);

    var parts = input.split(/\s+/);
    var cmd = parts[0].toLowerCase();

    try {
      if (cmd === 'deploy') {
        var model = parts.slice(1).join(' ');
        if (!model) {
          addTerminalLine('error', 'Usage: deploy <model>');
          return;
        }
        addTerminalLine('info', 'Deploying model: ' + model + '...');
        var res = await api('POST', '/api/v1/deploy', { model: model });
        addTerminalLine('success', 'Deploy initiated: ' + (res.message || res.status || JSON.stringify(res)));
      } else if (cmd === 'status') {
        addTerminalLine('info', 'Fetching summary...');
        var summary = await api('GET', '/api/v1/summary');
        var lines = [
          'Nodes: ' + (summary.total_nodes || '--') + ' (online: ' + (summary.online_nodes || '--') + ')',
          'GPUs: ' + (summary.total_gpus || '--'),
          'VRAM: ' + formatBytes(summary.used_vram_mb) + ' / ' + formatBytes(summary.total_vram_mb),
          'tok/s: ' + (summary.total_toks_per_sec != null ? summary.total_toks_per_sec.toFixed(1) : '--'),
          'Requests: ' + (summary.total_requests != null ? summary.total_requests.toLocaleString() : '--'),
        ];
        lines.forEach(function (l) { addTerminalLine('info', '  ' + l); });
      } else if (cmd === 'nodes') {
        addTerminalLine('info', 'Fetching nodes...');
        var data = await api('GET', '/api/v1/nodes');
        var nodeList = Array.isArray(data) ? data : (data.nodes || data.data || []);
        if (nodeList.length === 0) {
          addTerminalLine('warning', 'No nodes found.');
        } else {
          nodeList.forEach(function (n) {
            var online = n.status === 'online' || n.is_online || n.online !== false;
            var name = n.hostname || n.node_id || 'unknown';
            var status = online ? 'ONLINE' : 'OFFLINE';
            var gpuCount = n.gpu_count || (n.gpus ? n.gpus.length : 0);
            addTerminalLine(online ? 'success' : 'error',
              '  ' + name + ' [' + status + '] GPUs: ' + gpuCount +
              ' tok/s: ' + (n.toks_per_sec != null ? n.toks_per_sec.toFixed(1) : '--'));
          });
        }
      } else if (cmd === 'alert' && parts[1] && parts[1].toLowerCase() === 'ack') {
        var alertId = parts[2];
        if (!alertId) {
          addTerminalLine('error', 'Usage: alert ack <id>');
          return;
        }
        addTerminalLine('info', 'Acknowledging alert ' + alertId + '...');
        var ackRes = await api('POST', '/api/v1/alerts/' + alertId + '/acknowledge');
        addTerminalLine('success', 'Alert ' + alertId + ' acknowledged. ' + (ackRes.message || ''));
      } else {
        addTerminalLine('warning', 'Unknown command: ' + cmd + '. Available: deploy, status, nodes, alert ack');
      }
    } catch (e) {
      addTerminalLine('error', 'Command failed: ' + e.message);
    }
  }

  async function fetchHealthScore() {
    try {
      var data = await api('GET', '/api/v1/health/score');
      var score = data.score != null ? data.score : data.health_score;
      if (score != null) {
        dom.terminalHealthScore.textContent = score + ' %';
        if (score >= 80) {
          dom.terminalHealthScore.style.color = 'var(--green)';
          dom.terminalHealthScore.style.borderColor = 'var(--green)';
        } else if (score >= 50) {
          dom.terminalHealthScore.style.color = 'var(--yellow)';
          dom.terminalHealthScore.style.borderColor = 'var(--yellow)';
        } else {
          dom.terminalHealthScore.style.color = 'var(--red)';
          dom.terminalHealthScore.style.borderColor = 'var(--red)';
        }
      }
    } catch (e) {
      dom.terminalHealthScore.textContent = '-- %';
    }
  }

  // ---- Quote rotation ----
  function rotateQuote() {
    quoteIndex = (quoteIndex + 1) % QUOTES.length;
    dom.quote.style.opacity = '0';
    setTimeout(function () {
      dom.quote.textContent = QUOTES[quoteIndex];
      dom.quote.style.opacity = '1';
    }, 300);
  }

  // ---- Event bindings ----
  function bindEvents() {
    dom.btnToggleFlight.addEventListener('click', function () {
      dom.flightPanel.classList.toggle('hidden');
      if (!dom.flightPanel.classList.contains('hidden')) {
        fetchFlightSheets();
      }
    });

    dom.btnCloseFlight.addEventListener('click', function () {
      dom.flightPanel.classList.add('hidden');
    });

    dom.btnAddTarget.addEventListener('click', addFsTargetRow);
    dom.btnCreateFs.addEventListener('click', createFlightSheet);

    dom.btnCloseCmd.addEventListener('click', closeCommandModal);
    dom.btnCancelCmd.addEventListener('click', closeCommandModal);
    dom.btnSendCmd.addEventListener('click', sendCommand);

    dom.cmdModal.addEventListener('click', function (e) {
      if (e.target === dom.cmdModal) closeCommandModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeCommandModal();
        dom.flightPanel.classList.add('hidden');
      }
    });

    dom.btnClearLog.addEventListener('click', clearLog);

    // Terminal bindings
    dom.btnTerminalClear.addEventListener('click', clearTerminal);
    dom.btnTerminalPause.addEventListener('click', toggleTerminalPause);
    dom.terminalFilter.addEventListener('change', handleTerminalFilterChange);

    dom.terminalInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var val = dom.terminalInput.value;
        dom.terminalInput.value = '';
        handleTerminalCommand(val);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (terminalCommandHistory.length > 0 && terminalHistoryIdx > 0) {
          terminalHistoryIdx--;
          dom.terminalInput.value = terminalCommandHistory[terminalHistoryIdx];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (terminalHistoryIdx < terminalCommandHistory.length - 1) {
          terminalHistoryIdx++;
          dom.terminalInput.value = terminalCommandHistory[terminalHistoryIdx];
        } else {
          terminalHistoryIdx = terminalCommandHistory.length;
          dom.terminalInput.value = '';
        }
      }
    });
  }

  // ---- Init ----
  function init() {
    bindEvents();

    quoteIndex = Math.floor(Math.random() * QUOTES.length);
    dom.quote.textContent = QUOTES[quoteIndex];
    dom.quote.style.transition = 'opacity 0.3s';

    checkHealth();

    fetchNodes();
    fetchSummary();
    fetchFlightSheets();

    connectSSE();
    fetchHealthScore();

    setInterval(function () {
      fetchNodes();
      fetchSummary();
      checkHealth();
      fetchHealthScore();
    }, POLL_INTERVAL);

    setInterval(rotateQuote, 10000);

    logEvent('system', 'Dashboard ready. CLAWtopus is watching.');
    addTerminalLine('system', 'CLAWtopus Terminal initialized. Type "status" for cluster summary.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
