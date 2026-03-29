/* ============================================================
   TentaCLAW OS Dashboard — app.js
   Professional GPU cluster management UI.
   Pure vanilla JS, no frameworks, no dependencies.
   ============================================================ */

(function () {
  'use strict';

  // ===================== STATE =====================
  const state = {
    nodes: [],
    summary: {},
    healthScore: null,
    flightSheets: [],
    alerts: [],
    benchmarks: [],
    leaderboard: [],
    power: {},
    sseConnected: false,
    commandTarget: null,
    activeView: 'nodes',
    expandedNodes: new Set(),
    sparklineCache: {},
    initialLoad: true,
    lastEmptyComedyAt: 0,
  };

  const MAX_TERMINAL_LINES = 300;
  const POLL_INTERVAL = 5000;

  // Terminal state
  let terminalLines = [];
  let terminalPaused = false;
  let terminalFilter = 'all';
  let terminalHistory = [];
  let terminalHistIdx = -1;

  // ===================== DOM REFS =====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    sidebar:        $('#sidebar'),
    sidebarToggle:  $('#sidebar-toggle'),
    mainWrapper:    $('.main-wrapper'),
    farmHash:       $('#farm-hash'),
    // Top bar stats
    statNodesOnline: $('#stat-nodes-online'),
    statNodesTotal:  $('#stat-nodes-total'),
    statGpus:        $('#stat-gpus'),
    statVramBar:     $('#stat-vram-bar'),
    statVramText:    $('#stat-vram-text'),
    statToks:        $('#stat-toks'),
    statPower:       $('#stat-power'),
    statHealth:      $('#stat-health'),
    statCost:        $('#stat-cost'),
    // Nav badges
    navBadgeNodes:   $('#nav-badge-nodes'),
    navBadgeAlerts:  $('#nav-badge-alerts'),
    // Nodes
    nodesTbody:      $('#nodes-tbody'),
    emptyState:      $('#empty-state'),
    nodeSearch:      $('#node-search'),
    btnRefreshNodes: $('#btn-refresh-nodes'),
    // Flight sheets
    btnNewFs:        $('#btn-new-fs'),
    fsCreateForm:    $('#fs-create-form'),
    fsName:          $('#fs-name'),
    fsDesc:          $('#fs-desc'),
    fsTargets:       $('#fs-targets'),
    btnAddTarget:    $('#btn-add-target'),
    btnCreateFs:     $('#btn-create-fs'),
    btnCancelFs:     $('#btn-cancel-fs'),
    fsList:          $('#fs-list'),
    // Models
    modelsTbody:     $('#models-tbody'),
    // Alerts
    alertsList:      $('#alerts-list'),
    alertFilter:     $('#alert-filter'),
    // Benchmarks
    benchmarksTbody: $('#benchmarks-tbody'),
    // Power
    powerGrid:       $('#power-grid'),
    // Settings
    settingsFarmHash:  $('#settings-farm-hash'),
    settingsSseStatus: $('#settings-sse-status'),
    // Terminal
    terminalPanel:   $('#terminal-panel'),
    terminalOutput:  $('#terminal-output'),
    terminalInput:   $('#terminal-input'),
    terminalFilter:  $('#terminal-filter'),
    btnTermPause:    $('#btn-terminal-pause'),
    btnTermClear:    $('#btn-terminal-clear'),
    btnTermToggle:   $('#btn-terminal-toggle'),
    termSseDot:      $('#terminal-sse-dot'),
    // Modal
    cmdModal:        $('#cmd-modal'),
    cmdNodeName:     $('#cmd-node-name'),
    cmdAction:       $('#cmd-action'),
    cmdModel:        $('#cmd-model'),
    cmdGpu:          $('#cmd-gpu'),
    btnCloseCmd:     $('#btn-close-cmd'),
    btnCancelCmd:    $('#btn-cancel-cmd'),
    btnSendCmd:      $('#btn-send-cmd'),
    // Action dropdown
    actionDropdown:  $('#action-dropdown'),
    // Playground
    playgroundModel:    $('#playground-model'),
    playgroundMessages: $('#playground-messages'),
    playgroundInput:    $('#playground-input'),
    btnPlaygroundSend:  $('#btn-playground-send'),
    playgroundStatus:   $('#playground-status'),
  };

  // ===================== HELPERS =====================
  function formatBytes(mb) {
    if (mb == null) return '--';
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return Math.round(mb) + ' MB';
  }

  function formatBytesNet(bytes) {
    if (bytes == null) return '--';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }

  function formatUptime(secs) {
    if (secs == null) return '--';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function pct(used, total) {
    if (!total) return 0;
    return Math.min(100, Math.max(0, (used / total) * 100));
  }

  function tempColorClass(c) {
    if (c == null) return 'temp-cool';
    if (c >= 85) return 'temp-crit';
    if (c >= 75) return 'temp-hot';
    if (c >= 60) return 'temp-warm';
    return 'temp-cool';
  }

  function barColor(p) {
    if (p >= 90) return 'red';
    if (p >= 75) return 'orange';
    if (p >= 50) return 'yellow';
    return 'cyan';
  }

  function ts() {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
  }

  function isOnline(node) {
    return node.status === 'online' || node.is_online === true || node.online !== false;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function totalNodePower(node) {
    let w = 0;
    if (node.gpus) node.gpus.forEach(g => { w += (g.powerDrawW || 0); });
    return w;
  }

  function totalNodeVram(node) {
    let used = 0, total = 0;
    if (node.gpus) node.gpus.forEach(g => {
      used += (g.vramUsedMb || 0);
      total += (g.vramTotalMb || 0);
    });
    return { used, total };
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.textContent;
  }

  // ===================== API =====================
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(res.status + ' ' + text);
    }
    return res.json();
  }

  const COMEDY_TTL_MS = 15000;
  const EMPTY_COMEDY_TTL_MS = 30000;
  const comedyCache = {};
  let playgroundComedyToken = 0;
  let playgroundComedyTimer = null;
  function comedyCacheKey(params) {
    return JSON.stringify(params || {});
  }
  function formatComedyStatus(pack, fallback) {
    if (!pack) return fallback;
    if (pack.secondary) return pack.primary + ' ' + pack.secondary;
    return pack.primary || fallback;
  }
  async function fetchComedyWait(params, fallback) {
    const key = comedyCacheKey(params);
    const now = Date.now();
    const cached = comedyCache[key];
    if (cached && (now - cached.at) < COMEDY_TTL_MS) return cached.value;
    try {
      const query = new URLSearchParams();
      Object.keys(params || {}).forEach((k) => {
        const value = params[k];
        if (value != null && value !== '') query.set(k, String(value));
      });
      const pack = await api('GET', '/api/v1/comedy/wait-line?' + query.toString());
      comedyCache[key] = { at: now, value: pack };
      return pack;
    } catch (e) {
      return {
        primary: fallback,
        secondary: '',
        fact: '',
        mechanic: 'fallback',
        source: 'template',
        safe: true,
      };
    }
  }
  async function refreshEmptyStateComedy(force) {
    const emptySub = dom.emptyState ? dom.emptyState.querySelector('.empty-sub') : null;
    if (!emptySub || !dom.emptyState || !dom.emptyState.classList.contains('visible')) return;
    const now = Date.now();
    if (!force && (now - state.lastEmptyComedyAt) < EMPTY_COMEDY_TTL_MS) return;
    state.lastEmptyComedyAt = now;
    const pack = await fetchComedyWait({
      state: 'empty',
      detail: 'workers to register with the gateway',
      audience: 'dashboard',
      allow_model: '1',
    }, 'Waiting for agents to register with the gateway.');
    emptySub.textContent = formatComedyStatus(pack, 'Waiting for agents to register with the gateway.');
  }
  async function updatePlaygroundComedyStatus(model, token, elapsedMs) {
    const pack = await fetchComedyWait({
      state: elapsedMs > 5000 ? 'processing' : 'thinking',
      detail: 'response generation',
      model: model,
      audience: 'playground',
      duration_ms: elapsedMs,
      allow_model: '1',
    }, 'Sending to ' + model + '...');
    if (token !== playgroundComedyToken || !dom.playgroundStatus) return;
    dom.playgroundStatus.textContent = formatComedyStatus(pack, 'Sending to ' + model + '...');
  }
  function startPlaygroundComedy(model) {
    playgroundComedyToken += 1;
    const token = playgroundComedyToken;
    const startedAt = Date.now();
    if (playgroundComedyTimer) {
      clearInterval(playgroundComedyTimer);
      playgroundComedyTimer = null;
    }
    updatePlaygroundComedyStatus(model, token, 0);
    playgroundComedyTimer = setInterval(() => {
      updatePlaygroundComedyStatus(model, token, Date.now() - startedAt);
    }, 3500);
    return token;
  }
  function stopPlaygroundComedy(token) {
    if (token !== playgroundComedyToken) return;
    if (playgroundComedyTimer) {
      clearInterval(playgroundComedyTimer);
      playgroundComedyTimer = null;
    }
  }  // ===================== DATA FETCHING =====================
  async function fetchNodes() {
    try {
      const data = await api('GET', '/api/v1/nodes');
      const raw = Array.isArray(data) ? data : (data.nodes || data.data || []);
      // Flatten latest_stats into node object for easier access in render functions
      state.nodes = raw.map(n => {
        const s = n.latest_stats || {};
        return {
          ...n,
          gpus: s.gpus || n.gpus || [],
          cpu: s.cpu || n.cpu || {},
          ram: s.ram || n.ram || {},
          disk: s.disk || n.disk || {},
          network: s.network || n.network || {},
          inference: s.inference || n.inference || {},
          toks_per_sec: s.toks_per_sec != null ? s.toks_per_sec : (n.toks_per_sec || 0),
          uptime_secs: s.uptime_secs != null ? s.uptime_secs : (n.uptime_secs || 0),
          requests_completed: s.requests_completed || n.requests_completed || 0,
          gpu_count: n.gpu_count || s.gpu_count || (s.gpus ? s.gpus.length : 0),
        };
      });
      state.initialLoad = false;
      renderNodes();
      computeSummary();
    } catch (e) {
      state.initialLoad = false;
      addTermLine('error', 'Failed to fetch nodes: ' + e.message);
    }
  }

  async function fetchSummary() {
    try {
      const data = await api('GET', '/api/v1/summary');
      state.summary = data;
      renderTopBar();
    } catch (e) {
      computeSummary();
    }
  }

  function computeSummary() {
    let totalGpus = 0, totalVram = 0, usedVram = 0, totalToks = 0, totalPwr = 0, online = 0;
    state.nodes.forEach(n => {
      if (isOnline(n)) online++;
      totalGpus += n.gpu_count || (n.gpus ? n.gpus.length : 0);
      if (n.gpus) n.gpus.forEach(g => {
        totalVram += (g.vramTotalMb || 0);
        usedVram += (g.vramUsedMb || 0);
        totalPwr += (g.powerDrawW || 0);
      });
      totalToks += (n.toks_per_sec || 0);
    });
    state.summary = {
      total_nodes: state.nodes.length,
      online_nodes: online,
      total_gpus: totalGpus,
      total_vram_mb: totalVram,
      used_vram_mb: usedVram,
      total_toks_per_sec: totalToks,
      total_power_w: totalPwr,
    };
    renderTopBar();
  }

  async function fetchHealthScore() {
    try {
      const data = await api('GET', '/api/v1/health/score');
      state.healthScore = data.score != null ? data.score : data.health_score;
      renderHealthScore();
    } catch (e) {
      state.healthScore = null;
      renderHealthScore();
    }
  }

  async function fetchPower() {
    try {
      state.power = await api('GET', '/api/v1/power');
      renderPower();
    } catch (e) { /* silent */ }
  }

  async function fetchFlightSheets() {
    try {
      const data = await api('GET', '/api/v1/flight-sheets');
      state.flightSheets = Array.isArray(data) ? data : (data.flight_sheets || data.data || []);
      renderFlightSheets();
    } catch (e) {
      addTermLine('error', 'Flight sheets: ' + e.message);
    }
  }

  async function fetchAlerts() {
    try {
      const data = await api('GET', '/api/v1/alerts');
      state.alerts = Array.isArray(data) ? data : (data.alerts || data.data || []);
      renderAlerts();
      updateAlertBadge();
    } catch (e) { /* silent */ }
  }

  async function fetchBenchmarks() {
    try {
      const data = await api('GET', '/api/v1/benchmarks');
      state.benchmarks = Array.isArray(data) ? data : (data.benchmarks || data.data || []);
      renderBenchmarks();
    } catch (e) { /* silent */ }
  }

  async function fetchLeaderboard() {
    try {
      const data = await api('GET', '/api/v1/leaderboard');
      state.leaderboard = Array.isArray(data) ? data : (data.leaderboard || data.models || data.data || []);
      renderModels();
    } catch (e) { /* silent */ }
  }

  // ===================== SPARKLINE DATA =====================
  const SPARKLINE_TTL = 15000;

  async function fetchSparkline(nodeId) {
    const cached = state.sparklineCache[nodeId];
    if (cached && (Date.now() - cached.fetchedAt) < SPARKLINE_TTL) return cached;
    try {
      const data = await api('GET', '/api/v1/nodes/' + nodeId + '/sparkline');
      const entry = {
        timestamps: data.timestamps || [],
        avg_temp: data.avg_temp || [],
        avg_util: data.avg_util || [],
        toks_per_sec: data.toks_per_sec || [],
        fetchedAt: Date.now(),
      };
      state.sparklineCache[nodeId] = entry;
      return entry;
    } catch (e) {
      return null;
    }
  }

  function buildSparklineSVG(values, color, width, height) {
    if (!values || values.length < 2) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'sparkline-svg');

    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = max - min || 1;
    const padY = 2;
    const usableH = height - padY * 2;

    const points = values.map(function (v, i) {
      const x = (i / (values.length - 1)) * width;
      const y = padY + usableH - ((v - min) / range) * usableH;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    // Gradient fill under the line
    const defs = document.createElementNS(ns, 'defs');
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', 'spark-grad-' + Math.random().toString(36).substring(2, 8));
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0');
    grad.setAttribute('y2', '1');
    const stop1 = document.createElementNS(ns, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', color);
    stop1.setAttribute('stop-opacity', '0.25');
    const stop2 = document.createElementNS(ns, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', color);
    stop2.setAttribute('stop-opacity', '0.02');
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Area fill
    var firstPt = values.length > 0 ? (padY + usableH - ((values[0] - min) / range) * usableH) : height;
    var lastPt = values.length > 0 ? (padY + usableH - ((values[values.length - 1] - min) / range) * usableH) : height;
    var areaPoints = '0,' + height + ' 0,' + firstPt.toFixed(1) + ' ' + points + ' ' + width + ',' + lastPt.toFixed(1) + ' ' + width + ',' + height;
    var polygon = document.createElementNS(ns, 'polygon');
    polygon.setAttribute('points', areaPoints);
    polygon.setAttribute('fill', 'url(#' + grad.getAttribute('id') + ')');
    svg.appendChild(polygon);

    // Line
    const polyline = document.createElementNS(ns, 'polyline');
    polyline.setAttribute('points', points);
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', color);
    polyline.setAttribute('stroke-width', '1.2');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(polyline);

    // End dot
    if (values.length > 0) {
      var lastVal = values[values.length - 1];
      var lastX = width;
      var lastY = padY + usableH - ((lastVal - min) / range) * usableH;
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', lastX.toFixed(1));
      dot.setAttribute('cy', lastY.toFixed(1));
      dot.setAttribute('r', '1.5');
      dot.setAttribute('fill', color);
      svg.appendChild(dot);
    }

    return svg;
  }

  function renderSparklineCell(td, nodeId) {
    fetchSparkline(nodeId).then(function (data) {
      td.textContent = '';
      if (!data || !data.avg_temp || data.avg_temp.length < 2) {
        td.textContent = '--';
        td.classList.add('text-muted');
        return;
      }
      var wrapper = el('div', 'sparkline-cell');
      var svg = buildSparklineSVG(data.avg_temp, '#22d3ee', 70, 18);
      if (svg) {
        wrapper.appendChild(svg);
        var latest = data.avg_temp[data.avg_temp.length - 1];
        var tempLabel = el('span', 'sparkline-value ' + tempColorClass(latest), Math.round(latest) + '\u00B0');
        wrapper.appendChild(tempLabel);
      }
      td.appendChild(wrapper);
    });
  }

  // ===================== OVERCLOCK PROFILES =====================
  var OVERCLOCK_PROFILES = [
    { id: 'stock',     label: 'Stock',     desc: 'Default clocks' },
    { id: 'gaming',    label: 'Gaming',    desc: 'Balanced OC' },
    { id: 'mining',    label: 'Mining',    desc: 'Low power, high mem' },
    { id: 'inference', label: 'Inference', desc: 'Optimized for LLM' },
  ];

  async function applyOverclockProfile(nodeId, profileId, hostname) {
    try {
      addTermLine('info', 'Applying overclock "' + profileId + '" to ' + (hostname || nodeId) + '...');
      await api('POST', '/api/v1/nodes/' + nodeId + '/command', {
        action: 'overclock',
        payload: { profile: profileId }
      });
      addTermLine('success', 'Overclock "' + profileId + '" applied to ' + (hostname || nodeId));
    } catch (e) {
      addTermLine('error', 'Overclock failed: ' + e.message);
    }
  }

  // ===================== SSE =====================
  function connectSSE() {
    const evtSource = new EventSource('/api/v1/events');

    evtSource.onopen = () => {
      state.sseConnected = true;
      dom.termSseDot.classList.add('connected');
      if (dom.settingsSseStatus) dom.settingsSseStatus.textContent = 'Connected';
      addTermLine('system', 'SSE connected -- real-time updates active.');
    };

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleSSE(data.type || data.event || 'info', data);
      } catch (e) {
        addTermLine('info', event.data);
      }
    };

    ['stats_update', 'node_online', 'node_offline', 'command_sent', 'alert', 'benchmark_complete']
      .forEach(t => {
        evtSource.addEventListener(t, (event) => {
          try { handleSSE(t, JSON.parse(event.data)); }
          catch (e) { handleSSE(t, { raw: event.data }); }
        });
      });

    evtSource.onerror = () => {
      state.sseConnected = false;
      dom.termSseDot.classList.remove('connected');
      if (dom.settingsSseStatus) dom.settingsSseStatus.textContent = 'Reconnecting...';
      addTermLine('warning', 'SSE disconnected. Reconnecting...');
    };
  }

  function handleSSE(type, data) {
    switch (type) {
      case 'stats_update':
        if (data.node_id) updateNodeInState(data);
        addTermLine('stats_update', 'Stats: ' + (data.hostname || data.node_id || 'unknown'));
        break;
      case 'node_online':
        addTermLine('node_online', 'Node online: ' + (data.hostname || data.node_id));
        fetchNodes(); fetchSummary();
        break;
      case 'node_offline':
        addTermLine('node_offline', 'Node offline: ' + (data.hostname || data.node_id));
        fetchNodes(); fetchSummary();
        break;
      case 'command_sent':
        addTermLine('command_sent', 'Command: ' + (data.action || '?') + ' -> ' + (data.hostname || data.node_id));
        break;
      case 'alert':
        addTermLine('alert', 'ALERT: ' + (data.message || data.description || JSON.stringify(data).substring(0, 100)));
        fetchAlerts();
        break;
      case 'benchmark_complete':
        addTermLine('benchmark_complete', 'Benchmark: ' + (data.model || '?') + ' -- ' + (data.toks_per_sec || JSON.stringify(data).substring(0, 80)));
        fetchBenchmarks();
        break;
      default:
        addTermLine('info', type + ': ' + JSON.stringify(data).substring(0, 120));
    }
  }

  function updateNodeInState(payload) {
    const idx = state.nodes.findIndex(n => n.node_id === payload.node_id);
    if (idx >= 0) Object.assign(state.nodes[idx], payload);
    else state.nodes.push(payload);
    renderNodes();
    computeSummary();
  }

  // ===================== RENDER: TOP BAR =====================
  function renderTopBar() {
    const s = state.summary;
    dom.statNodesOnline.textContent = s.online_nodes != null ? s.online_nodes : '--';
    dom.statNodesTotal.textContent = s.total_nodes != null ? s.total_nodes : state.nodes.length;
    dom.statGpus.textContent = s.total_gpus != null ? s.total_gpus : '--';

    if (s.total_vram_mb) {
      const p = pct(s.used_vram_mb || 0, s.total_vram_mb);
      dom.statVramBar.style.width = p.toFixed(1) + '%';
      dom.statVramText.textContent = formatBytes(s.used_vram_mb) + '/' + formatBytes(s.total_vram_mb);
    } else {
      dom.statVramBar.style.width = '0%';
      dom.statVramText.textContent = '--';
    }

    dom.statToks.textContent = s.total_toks_per_sec != null ? s.total_toks_per_sec.toFixed(1) : '--';
    dom.statPower.textContent = s.total_power_w != null ? Math.round(s.total_power_w) : '--';

    // Farm hash
    if (s.farm_hash) {
      dom.farmHash.textContent = s.farm_hash;
      dom.farmHash.title = s.farm_hash;
      if (dom.settingsFarmHash) dom.settingsFarmHash.textContent = s.farm_hash;
    }

    // Nav badge
    dom.navBadgeNodes.textContent = (s.online_nodes != null ? s.online_nodes : '--') + '/' + (s.total_nodes != null ? s.total_nodes : state.nodes.length);

    // Cost estimate: assume $0.10/kWh
    if (s.total_power_w) {
      const daily = ((s.total_power_w / 1000) * 24 * 0.10).toFixed(2);
      dom.statCost.textContent = daily;
    }
  }

  function renderHealthScore() {
    const score = state.healthScore;
    if (score == null) {
      dom.statHealth.textContent = '--';
      dom.statHealth.className = 'stat-pill-value health-score';
      return;
    }
    dom.statHealth.textContent = score + '%';
    dom.statHealth.className = 'stat-pill-value health-score ' +
      (score >= 80 ? 'health-good' : score >= 50 ? 'health-warn' : 'health-bad');
  }

  // ===================== RENDER: NODES TABLE =====================
  function renderNodes() {
    const tbody = dom.nodesTbody;
    const searchTerm = (dom.nodeSearch.value || '').toLowerCase();

    // Preserve scroll position
    const wrapper = tbody.parentElement ? tbody.parentElement.parentElement : null;
    const scrollTop = wrapper ? wrapper.scrollTop : 0;

    tbody.textContent = '';

    let filtered = state.nodes;
    if (searchTerm) {
      filtered = state.nodes.filter(n =>
        (n.hostname || '').toLowerCase().includes(searchTerm) ||
        (n.node_id || '').toLowerCase().includes(searchTerm)
      );
    }

    if (filtered.length === 0) {
      dom.emptyState.classList.add('visible');
      if (!searchTerm) refreshEmptyStateComedy(false);
      return;
    }
    dom.emptyState.classList.remove('visible');

    filtered.forEach(node => {
      const online = isOnline(node);
      const nodeId = node.node_id || '';
      const expanded = state.expandedNodes.has(nodeId);

      // Main row
      const row = el('tr', 'node-row' + (online ? '' : ' offline'));
      row.dataset.nodeId = nodeId;

      // 1. Status dot
      const tdStatus = el('td');
      const dot = el('span', 'status-dot ' + (online ? 'online' : 'offline'));
      tdStatus.appendChild(dot);
      row.appendChild(tdStatus);

      // 2. Hostname
      const tdHost = el('td');
      const hostSpan = el('div', 'node-hostname', node.hostname || node.node_id || 'Unknown');
      tdHost.appendChild(hostSpan);
      const idSub = el('div', 'node-id-sub', nodeId ? nodeId.substring(0, 12) : '');
      tdHost.appendChild(idSub);
      row.appendChild(tdHost);

      // 3. GPU strip — compact pills with temp
      const tdGpus = el('td');
      const strip = el('div', 'gpu-strip');
      if (node.gpus && node.gpus.length > 0) {
        node.gpus.forEach((gpu, i) => {
          const chip = el('div', 'gpu-chip');
          const bar = el('div', 'gpu-chip-bar ' + tempColorClass(gpu.temperatureC));
          bar.textContent = gpu.temperatureC != null ? Math.round(gpu.temperatureC) + '\u00B0' : '?';
          chip.appendChild(bar);

          // Tooltip
          const tip = el('div', 'gpu-chip-tooltip');
          const tipTitle = el('b', null, '#' + i + ' ' + (gpu.name || 'GPU'));
          tip.appendChild(tipTitle);
          tip.appendChild(document.createElement('br'));
          tip.appendChild(document.createTextNode('Temp: ' + (gpu.temperatureC != null ? gpu.temperatureC + '\u00B0C' : '--')));
          tip.appendChild(document.createElement('br'));
          tip.appendChild(document.createTextNode('Util: ' + (gpu.utilizationPct != null ? gpu.utilizationPct + '%' : '--')));
          tip.appendChild(document.createElement('br'));
          tip.appendChild(document.createTextNode('Power: ' + (gpu.powerDrawW != null ? Math.round(gpu.powerDrawW) + 'W' : '--')));
          tip.appendChild(document.createElement('br'));
          tip.appendChild(document.createTextNode('VRAM: ' + formatBytes(gpu.vramUsedMb) + '/' + formatBytes(gpu.vramTotalMb)));
          chip.appendChild(tip);

          strip.appendChild(chip);
        });
      } else {
        const count = node.gpu_count || 0;
        if (count > 0) {
          for (let i = 0; i < count; i++) {
            const chip = el('div', 'gpu-chip');
            const bar = el('div', 'gpu-chip-bar temp-cool', '?');
            chip.appendChild(bar);
            strip.appendChild(chip);
          }
        } else {
          tdGpus.textContent = '--';
        }
      }
      tdGpus.appendChild(strip);
      row.appendChild(tdGpus);

      // 4. VRAM bar
      const tdVram = el('td');
      const vram = totalNodeVram(node);
      const vramDiv = el('div', 'vram-bar-cell');
      const vramOuter = el('div', 'vram-bar-outer');
      const vramInner = el('div', 'vram-bar-inner');
      vramInner.style.width = pct(vram.used, vram.total).toFixed(1) + '%';
      vramOuter.appendChild(vramInner);
      vramDiv.appendChild(vramOuter);
      const vramText = el('div', 'vram-bar-text', formatBytes(vram.used) + '/' + formatBytes(vram.total));
      vramDiv.appendChild(vramText);
      tdVram.appendChild(vramDiv);
      row.appendChild(tdVram);

      // 5. Models
      const tdModels = el('td');
      const tagsDiv = el('div', 'model-tags');
      if (node.inference && node.inference.loaded_models && node.inference.loaded_models.length > 0) {
        node.inference.loaded_models.forEach(m => {
          tagsDiv.appendChild(el('span', 'model-tag', m));
        });
      } else {
        tdModels.classList.add('text-muted');
        tdModels.textContent = 'none';
      }
      tdModels.appendChild(tagsDiv);
      row.appendChild(tdModels);

      // 6. tok/s
      const tdToks = el('td');
      tdToks.style.textAlign = 'right';
      const toksVal = el('span', 'toks-value', node.toks_per_sec != null ? node.toks_per_sec.toFixed(1) : '--');
      tdToks.appendChild(toksVal);
      row.appendChild(tdToks);

      // 7. Sparkline (temp history)
      const tdSpark = el('td', 'td-sparkline');
      tdSpark.textContent = '...';
      tdSpark.classList.add('text-muted');
      if (nodeId && online) {
        renderSparklineCell(tdSpark, nodeId);
      } else {
        tdSpark.textContent = '--';
      }
      row.appendChild(tdSpark);

      // 8. Uptime
      const tdUp = el('td');
      tdUp.appendChild(el('span', 'uptime-text', formatUptime(node.uptime_secs)));
      row.appendChild(tdUp);

      // 9. Power
      const tdPwr = el('td');
      tdPwr.style.textAlign = 'right';
      const pwr = totalNodePower(node);
      const pwrSpan = el('span', 'power-value');
      pwrSpan.textContent = pwr > 0 ? Math.round(pwr) : '--';
      tdPwr.appendChild(pwrSpan);
      if (pwr > 0) tdPwr.appendChild(el('span', 'power-unit', 'W'));
      row.appendChild(tdPwr);

      // 10. Actions
      const tdAct = el('td');
      const actBtn = el('button', 'actions-btn', '\u22EE');
      actBtn.title = 'Actions';
      actBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showActionDropdown(e, nodeId, node.hostname || node.node_id);
      });
      tdAct.appendChild(actBtn);
      row.appendChild(tdAct);

      // Click to expand
      row.addEventListener('click', () => {
        toggleNodeExpand(nodeId);
      });

      tbody.appendChild(row);

      // Detail row (always present, hidden by default)
      const detailRow = el('tr', 'node-detail-row');
      detailRow.dataset.nodeId = nodeId + '-detail';
      const detailTd = document.createElement('td');
      detailTd.colSpan = 10;
      const detailInner = el('div', 'node-detail-inner' + (expanded ? ' expanded' : ''));
      buildNodeDetailDOM(detailInner, node);
      detailTd.appendChild(detailInner);
      detailRow.appendChild(detailTd);
      tbody.appendChild(detailRow);
    });

    // Restore scroll
    if (wrapper) wrapper.scrollTop = scrollTop;
  }

  function toggleNodeExpand(nodeId) {
    if (state.expandedNodes.has(nodeId)) {
      state.expandedNodes.delete(nodeId);
    } else {
      state.expandedNodes.add(nodeId);
    }
    // Toggle the detail panel for this node
    const detailRow = dom.nodesTbody.querySelector('tr[data-node-id="' + nodeId + '-detail"]');
    if (detailRow) {
      const inner = detailRow.querySelector('.node-detail-inner');
      if (inner) inner.classList.toggle('expanded');
    }
  }

  /** Build the expanded detail for a node using safe DOM methods */
  function buildNodeDetailDOM(container, node) {
    const nid = node.node_id || '';

    // GPUs detail
    if (node.gpus && node.gpus.length > 0) {
      container.appendChild(el('div', 'detail-section-title', 'GPU Details'));
      const gpuGrid = el('div', 'detail-gpu-grid');

      node.gpus.forEach((gpu, i) => {
        const vp = pct(gpu.vramUsedMb, gpu.vramTotalMb);
        const up = gpu.utilizationPct != null ? gpu.utilizationPct : 0;

        const card = el('div', 'detail-gpu-card');

        // Header
        const header = el('div', 'detail-gpu-header');
        header.appendChild(el('span', 'detail-gpu-name', '#' + i + ' ' + (gpu.name || 'GPU ' + i)));
        header.appendChild(el('span', 'detail-gpu-bus', gpu.busId || ''));
        card.appendChild(header);

        // Stats grid
        const statsGrid = el('div', 'detail-gpu-stats');

        const tempStat = el('div', 'detail-stat');
        tempStat.appendChild(el('span', 'detail-stat-label', 'Temp'));
        const tempCls = gpu.temperatureC >= 80 ? 'detail-stat-value text-red' :
                        gpu.temperatureC >= 60 ? 'detail-stat-value text-yellow' :
                        'detail-stat-value text-green';
        tempStat.appendChild(el('span', tempCls, gpu.temperatureC != null ? gpu.temperatureC + '\u00B0C' : '--'));
        statsGrid.appendChild(tempStat);

        const pwrStat = el('div', 'detail-stat');
        pwrStat.appendChild(el('span', 'detail-stat-label', 'Power'));
        pwrStat.appendChild(el('span', 'detail-stat-value', gpu.powerDrawW != null ? Math.round(gpu.powerDrawW) + 'W' : '--'));
        statsGrid.appendChild(pwrStat);

        const fanStat = el('div', 'detail-stat');
        fanStat.appendChild(el('span', 'detail-stat-label', 'Fan'));
        fanStat.appendChild(el('span', 'detail-stat-value', gpu.fanSpeedPct != null ? Math.round(gpu.fanSpeedPct) + '%' : '--'));
        statsGrid.appendChild(fanStat);

        const clkStat = el('div', 'detail-stat');
        clkStat.appendChild(el('span', 'detail-stat-label', 'Clock'));
        clkStat.appendChild(el('span', 'detail-stat-value', gpu.clockSmMhz != null ? gpu.clockSmMhz + ' MHz' : '--'));
        statsGrid.appendChild(clkStat);

        card.appendChild(statsGrid);

        // VRAM bar
        card.appendChild(buildDetailBar('VRAM', vp, formatBytes(gpu.vramUsedMb) + '/' + formatBytes(gpu.vramTotalMb), 'purple'));

        // Util bar
        card.appendChild(buildDetailBar('Util', up, up.toFixed(0) + '%', 'cyan'));

        gpuGrid.appendChild(card);
      });

      container.appendChild(gpuGrid);
    }

    // System info
    container.appendChild(el('div', 'detail-section-title', 'System'));
    const sysGrid = el('div', 'detail-system-grid');

    if (node.cpu) {
      const cp = node.cpu.usage_pct || 0;
      const cpuDiv = el('div');
      cpuDiv.appendChild(buildDetailBar('CPU', cp, cp.toFixed(1) + '%' + (node.cpu.temp_c != null ? ' ' + node.cpu.temp_c + '\u00B0C' : ''), barColor(cp)));
      sysGrid.appendChild(cpuDiv);
    }

    if (node.ram) {
      const rp = pct(node.ram.used_mb, node.ram.total_mb);
      const ramDiv = el('div');
      ramDiv.appendChild(buildDetailBar('RAM', rp, formatBytes(node.ram.used_mb) + '/' + formatBytes(node.ram.total_mb), barColor(rp)));
      sysGrid.appendChild(ramDiv);
    }

    if (node.disk) {
      const dp = pct(node.disk.used_gb, node.disk.total_gb);
      const diskDiv = el('div');
      diskDiv.appendChild(buildDetailBar('Disk', dp, (node.disk.used_gb || 0) + '/' + (node.disk.total_gb || 0) + ' GB', barColor(dp)));
      sysGrid.appendChild(diskDiv);
    }

    if (node.network) {
      const netDiv = el('div');
      netDiv.style.padding = '4px 0';
      netDiv.style.fontSize = '0.7rem';
      netDiv.style.color = 'var(--text-secondary)';
      const netIn = el('span', 'text-cyan', formatBytesNet(node.network.bytes_in));
      const netOut = el('span', 'text-cyan', formatBytesNet(node.network.bytes_out));
      netDiv.appendChild(document.createTextNode('Net In: '));
      netDiv.appendChild(netIn);
      netDiv.appendChild(document.createTextNode(' | Out: '));
      netDiv.appendChild(netOut);
      sysGrid.appendChild(netDiv);
    }

    container.appendChild(sysGrid);

    // Loaded models with remove buttons
    if (node.inference && node.inference.loaded_models && node.inference.loaded_models.length > 0) {
      container.appendChild(el('div', 'detail-section-title', 'Loaded Models'));
      const modelsDiv = el('div', 'detail-models');

      node.inference.loaded_models.forEach(m => {
        const tag = el('span', 'detail-model-tag', m + ' ');
        const removeBtn = el('button', 'detail-model-remove', '\u00D7');
        removeBtn.title = 'Unload';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          api('POST', '/api/v1/nodes/' + nid + '/commands', { action: 'unload_model', model: m })
            .then(() => addTermLine('success', 'Unloading ' + m + ' from ' + nid))
            .catch(err => addTermLine('error', 'Unload failed: ' + err.message));
        });
        tag.appendChild(removeBtn);
        modelsDiv.appendChild(tag);
      });

      container.appendChild(modelsDiv);
    }

    // Quick deploy
    container.appendChild(el('div', 'detail-section-title', 'Quick Deploy'));
    const deployDiv = el('div', 'detail-deploy');
    const deployInput = document.createElement('input');
    deployInput.type = 'text';
    deployInput.placeholder = 'e.g. llama3:70b';
    deployDiv.appendChild(deployInput);
    const deployBtn = el('button', 'btn btn-primary btn-sm', 'Deploy');
    deployBtn.addEventListener('click', () => {
      const model = deployInput.value.trim();
      if (model) {
        deployToNode(nid, model);
        deployInput.value = '';
      }
    });
    deployInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        deployBtn.click();
      }
    });
    deployDiv.appendChild(deployBtn);
    container.appendChild(deployDiv);

    // Overclock profiles
    container.appendChild(el('div', 'detail-section-title', 'Overclock Profile'));
    const ocDiv = el('div', 'detail-overclock');

    OVERCLOCK_PROFILES.forEach(function (profile) {
      const btn = el('button', 'oc-profile-btn', profile.label);
      btn.title = profile.desc;
      btn.dataset.profile = profile.id;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        ocDiv.querySelectorAll('.oc-profile-btn').forEach(function (b) {
          b.classList.remove('oc-active');
        });
        btn.classList.add('oc-active');
        applyOverclockProfile(nid, profile.id, node.hostname || node.node_id);
      });
      ocDiv.appendChild(btn);
    });

    container.appendChild(ocDiv);
  }

  function buildDetailBar(label, percent, text, colorClass) {
    const bar = el('div', 'detail-bar');
    bar.appendChild(el('span', 'detail-bar-label', label));
    const track = el('div', 'detail-bar-track');
    const fill = el('div', 'detail-bar-fill ' + (colorClass || 'cyan'));
    fill.style.width = Math.min(100, Math.max(0, percent)).toFixed(1) + '%';
    track.appendChild(fill);
    bar.appendChild(track);
    bar.appendChild(el('span', 'detail-bar-text', text));
    return bar;
  }

  async function deployToNode(nodeId, model) {
    try {
      addTermLine('info', 'Deploying ' + model + ' to ' + nodeId + '...');
      await api('POST', '/api/v1/nodes/' + nodeId + '/commands', { action: 'install_model', model });
      addTermLine('success', 'Deploy command sent: ' + model + ' -> ' + nodeId);
    } catch (e) {
      addTermLine('error', 'Deploy failed: ' + e.message);
    }
  }

  // ===================== ACTION DROPDOWN =====================
  let dropdownTarget = null;

  function showActionDropdown(e, nodeId, hostname) {
    dropdownTarget = { nodeId, hostname };
    const dd = dom.actionDropdown;
    dd.classList.remove('hidden');

    const rect = e.target.getBoundingClientRect();
    dd.style.top = (rect.bottom + 4) + 'px';
    dd.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
  }

  function hideActionDropdown() {
    dom.actionDropdown.classList.add('hidden');
    dropdownTarget = null;
  }

  // ===================== RENDER: FLIGHT SHEETS =====================
  function renderFlightSheets() {
    const container = dom.fsList;
    container.textContent = '';

    if (state.flightSheets.length === 0) {
      container.appendChild(el('div', 'text-muted', 'No flight sheets created yet.'));
      return;
    }

    state.flightSheets.forEach(fs => {
      const card = el('div', 'fs-card');

      const info = el('div', 'fs-card-info');
      info.appendChild(el('div', 'fs-card-name', fs.name));
      if (fs.description) info.appendChild(el('div', 'fs-card-desc', fs.description));
      const meta = el('div', 'fs-card-meta');
      const targets = fs.targets || [];
      const models = [...new Set(targets.map(t => t.model).filter(Boolean))].join(', ');
      meta.appendChild(document.createTextNode('Targets: '));
      meta.appendChild(el('span', null, String(targets.length)));
      meta.appendChild(document.createTextNode(' | Models: '));
      meta.appendChild(el('span', null, models || 'none'));
      info.appendChild(meta);
      card.appendChild(info);

      const actions = el('div', 'fs-card-actions');
      const applyBtn = el('button', 'btn btn-primary btn-sm', 'Apply');
      applyBtn.addEventListener('click', () => applyFlightSheet(fs.id || fs._id));
      actions.appendChild(applyBtn);

      const delBtn = el('button', 'btn btn-danger btn-sm', 'Delete');
      delBtn.addEventListener('click', () => deleteFlightSheet(fs.id || fs._id));
      actions.appendChild(delBtn);

      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  async function applyFlightSheet(id) {
    try {
      await api('POST', '/api/v1/flight-sheets/' + id + '/apply');
      addTermLine('success', 'Flight sheet ' + id + ' applied.');
      fetchNodes();
    } catch (e) {
      addTermLine('error', 'Apply failed: ' + e.message);
    }
  }

  async function deleteFlightSheet(id) {
    try {
      await api('DELETE', '/api/v1/flight-sheets/' + id);
      addTermLine('success', 'Flight sheet ' + id + ' deleted.');
      fetchFlightSheets();
    } catch (e) {
      addTermLine('error', 'Delete failed: ' + e.message);
    }
  }

  async function createFlightSheet() {
    const name = dom.fsName.value.trim();
    const description = dom.fsDesc.value.trim();
    if (!name) {
      dom.fsName.style.borderColor = 'var(--red)';
      setTimeout(() => dom.fsName.style.borderColor = '', 1500);
      return;
    }

    const targets = [];
    dom.fsTargets.querySelectorAll('.fs-target-row').forEach(row => {
      const nodeSelect = row.querySelector('[data-field="node_id"]');
      const modelInput = row.querySelector('[data-field="model"]');
      const gpuInput = row.querySelector('[data-field="gpu"]');
      const nodeId = nodeSelect ? nodeSelect.value : '';
      const model = modelInput ? modelInput.value.trim() : '';
      if (nodeId && model) {
        const t = { node_id: nodeId, model: model };
        const gpuVal = gpuInput ? gpuInput.value.trim() : '';
        if (gpuVal !== '') t.gpu = parseInt(gpuVal, 10);
        targets.push(t);
      }
    });

    try {
      await api('POST', '/api/v1/flight-sheets', { name, description, targets });
      addTermLine('success', 'Flight sheet "' + name + '" created.');
      dom.fsName.value = '';
      dom.fsDesc.value = '';
      dom.fsTargets.textContent = '';
      addFsTargetRow();
      dom.fsCreateForm.classList.add('hidden');
      fetchFlightSheets();
    } catch (e) {
      addTermLine('error', 'Create flight sheet failed: ' + e.message);
    }
  }

  function addFsTargetRow() {
    const row = el('div', 'fs-target-row');

    const sel = document.createElement('select');
    sel.className = 'form-select';
    sel.dataset.field = 'node_id';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- node --';
    sel.appendChild(defaultOpt);
    state.nodes.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.node_id;
      opt.textContent = n.hostname || n.node_id;
      sel.appendChild(opt);
    });
    row.appendChild(sel);

    const modelIn = document.createElement('input');
    modelIn.type = 'text';
    modelIn.className = 'form-input';
    modelIn.dataset.field = 'model';
    modelIn.placeholder = 'Model name';
    row.appendChild(modelIn);

    const gpuIn = document.createElement('input');
    gpuIn.type = 'number';
    gpuIn.className = 'form-input';
    gpuIn.dataset.field = 'gpu';
    gpuIn.placeholder = 'GPU#';
    gpuIn.min = '0';
    gpuIn.style.width = '56px';
    gpuIn.style.flex = '0 0 56px';
    row.appendChild(gpuIn);

    const removeBtn = el('button', 'fs-target-remove', '\u00D7');
    removeBtn.addEventListener('click', () => row.remove());
    row.appendChild(removeBtn);

    dom.fsTargets.appendChild(row);
  }

  // ===================== RENDER: MODELS =====================
  function renderModels() {
    const tbody = dom.modelsTbody;
    tbody.textContent = '';

    let models = state.leaderboard;

    // If no leaderboard from API, compute from nodes
    if (models.length === 0) {
      const modelMap = {};
      state.nodes.forEach(n => {
        if (n.inference && n.inference.loaded_models) {
          n.inference.loaded_models.forEach(m => {
            if (!modelMap[m]) modelMap[m] = { model: m, nodes: [], totalToks: 0, totalTokens: 0, totalLatency: 0, count: 0 };
            modelMap[m].nodes.push(n.hostname || n.node_id);
            modelMap[m].totalToks += (n.toks_per_sec || 0);
            if (n.inference.tokens_generated) modelMap[m].totalTokens += n.inference.tokens_generated;
            if (n.inference.avg_latency_ms) { modelMap[m].totalLatency += n.inference.avg_latency_ms; modelMap[m].count++; }
          });
        }
      });
      models = Object.values(modelMap).sort((a, b) => b.totalToks - a.totalToks);

      models.forEach((m, i) => {
        const tr = el('tr');
        tr.appendChild(el('td', null, String(i + 1)));
        const modelTd = el('td');
        modelTd.appendChild(el('span', 'text-purple', m.model));
        modelTd.querySelector('span').style.fontWeight = '600';
        modelTd.querySelector('span').style.fontFamily = 'var(--font-mono)';
        tr.appendChild(modelTd);
        tr.appendChild(el('td', null, String(m.nodes.length)));
        const avgTd = el('td', 'text-cyan');
        avgTd.style.fontFamily = 'var(--font-mono)';
        avgTd.style.fontWeight = '700';
        avgTd.textContent = (m.totalToks / Math.max(1, m.nodes.length)).toFixed(1);
        tr.appendChild(avgTd);
        tr.appendChild(el('td', null, m.totalTokens.toLocaleString()));
        tr.appendChild(el('td', null, m.count > 0 ? (m.totalLatency / m.count).toFixed(1) + ' ms' : '--'));
        tbody.appendChild(tr);
      });
    } else {
      models.forEach((m, i) => {
        const tr = el('tr');
        tr.appendChild(el('td', null, String(i + 1)));
        const modelTd = el('td');
        const mSpan = el('span', 'text-purple', m.model || m.name || '--');
        mSpan.style.fontWeight = '600';
        mSpan.style.fontFamily = 'var(--font-mono)';
        modelTd.appendChild(mSpan);
        tr.appendChild(modelTd);
        tr.appendChild(el('td', null, String(m.nodes_count || m.nodes || '--')));
        const avgTd = el('td', 'text-cyan');
        avgTd.style.fontFamily = 'var(--font-mono)';
        avgTd.style.fontWeight = '700';
        avgTd.textContent = m.avg_toks_per_sec != null ? m.avg_toks_per_sec.toFixed(1) : (m.toks_per_sec || '--');
        tr.appendChild(avgTd);
        tr.appendChild(el('td', null, m.total_tokens != null ? m.total_tokens.toLocaleString() : '--'));
        tr.appendChild(el('td', null, m.avg_latency_ms != null ? m.avg_latency_ms.toFixed(1) + ' ms' : '--'));
        tbody.appendChild(tr);
      });
    }
  }

  // ===================== RENDER: ALERTS =====================
  function renderAlerts() {
    const container = dom.alertsList;
    const filterVal = dom.alertFilter.value;
    container.textContent = '';

    let filtered = state.alerts;
    if (filterVal !== 'all') {
      filtered = state.alerts.filter(a => (a.severity || 'info') === filterVal);
    }

    if (filtered.length === 0) {
      container.appendChild(el('div', 'text-muted', 'No alerts.'));
      return;
    }

    filtered.forEach(alert => {
      const severity = (alert.severity || 'info').toLowerCase();
      const row = el('div', 'alert-row severity-' + severity);

      // SVG icon instead of emoji
      const icon = el('span', 'alert-severity-icon');
      if (severity === 'critical') {
        icon.innerHTML = '<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 1L15 13H1L8 1z" stroke="#ef4444" stroke-width="1.5"/><line x1="8" y1="6" x2="8" y2="9" stroke="#ef4444" stroke-width="1.5"/><circle cx="8" cy="11" r="0.7" fill="#ef4444"/></svg>';
      } else if (severity === 'warning') {
        icon.innerHTML = '<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 1L15 13H1L8 1z" stroke="#f0b429" stroke-width="1.5"/><line x1="8" y1="6" x2="8" y2="9" stroke="#f0b429" stroke-width="1.5"/><circle cx="8" cy="11" r="0.7" fill="#f0b429"/></svg>';
      } else {
        icon.innerHTML = '<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="6.5" stroke="#22d3ee" stroke-width="1.2"/><line x1="8" y1="5" x2="8" y2="9" stroke="#22d3ee" stroke-width="1.2"/><circle cx="8" cy="11.5" r="0.7" fill="#22d3ee"/></svg>';
      }
      row.appendChild(icon);

      const content = el('div', 'alert-content');
      content.appendChild(el('div', 'alert-message', alert.message || alert.description || '--'));
      const meta = el('div', 'alert-meta');
      meta.appendChild(document.createTextNode(alert.timestamp || alert.created_at || '--'));
      if (alert.node_id) {
        meta.appendChild(document.createTextNode(' -- '));
        meta.appendChild(el('span', 'alert-node', alert.hostname || alert.node_id));
      }
      content.appendChild(meta);
      row.appendChild(content);

      if (!alert.acknowledged) {
        const actions = el('div', 'alert-actions');
        const ackBtn = el('button', 'btn btn-sm', 'Acknowledge');
        ackBtn.addEventListener('click', () => ackAlert(alert.id || alert._id));
        actions.appendChild(ackBtn);
        row.appendChild(actions);
      }

      container.appendChild(row);
    });
  }

  async function ackAlert(id) {
    try {
      await api('POST', '/api/v1/alerts/' + id + '/acknowledge');
      addTermLine('success', 'Alert ' + id + ' acknowledged.');
      fetchAlerts();
    } catch (e) {
      addTermLine('error', 'Acknowledge failed: ' + e.message);
    }
  }

  function updateAlertBadge() {
    const unacked = state.alerts.filter(a => !a.acknowledged).length;
    if (unacked > 0) {
      dom.navBadgeAlerts.textContent = unacked;
      dom.navBadgeAlerts.classList.remove('hidden');
    } else {
      dom.navBadgeAlerts.classList.add('hidden');
    }
  }

  // ===================== RENDER: BENCHMARKS =====================
  function renderBenchmarks() {
    const tbody = dom.benchmarksTbody;
    tbody.textContent = '';

    if (state.benchmarks.length === 0) {
      const tr = el('tr');
      const td = el('td', 'text-muted', 'No benchmarks recorded yet.');
      td.colSpan = 6;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    state.benchmarks.forEach(b => {
      const tr = el('tr');
      tr.appendChild(el('td', null, b.hostname || b.node_id || '--'));
      const mTd = el('td', 'text-purple');
      mTd.style.fontFamily = 'var(--font-mono)';
      mTd.textContent = b.model || '--';
      tr.appendChild(mTd);
      const toksTd = el('td', 'text-cyan');
      toksTd.style.fontFamily = 'var(--font-mono)';
      toksTd.style.fontWeight = '700';
      toksTd.textContent = b.toks_per_sec != null ? b.toks_per_sec.toFixed(1) : '--';
      tr.appendChild(toksTd);
      tr.appendChild(el('td', null, b.avg_latency_ms != null ? b.avg_latency_ms.toFixed(1) : '--'));
      tr.appendChild(el('td', null, b.vram_used_mb != null ? String(b.vram_used_mb) : '--'));
      tr.appendChild(el('td', 'text-muted', b.timestamp || b.date || '--'));
      tbody.appendChild(tr);
    });
  }

  // ===================== RENDER: POWER =====================
  function renderPower() {
    const grid = dom.powerGrid;
    grid.textContent = '';

    const pw = state.power;
    const totalW = state.summary.total_power_w || pw.total_watts || 0;
    const costPerKwh = pw.cost_per_kwh || 0.10;
    const dailyCost = (totalW / 1000) * 24 * costPerKwh;
    const monthlyCost = dailyCost * 30;
    const efficiency = (totalW > 0 && state.summary.total_toks_per_sec > 0)
      ? (state.summary.total_toks_per_sec / (totalW / 1000)).toFixed(1) : '--';

    const cards = [
      { title: 'Total Power Draw', value: Math.round(totalW), unit: 'W', sub: (state.summary.total_gpus || 0) + ' GPUs across ' + (state.summary.online_nodes || 0) + ' workers' },
      { title: 'Daily Cost', value: '$' + dailyCost.toFixed(2), unit: '/day', sub: 'At $' + costPerKwh.toFixed(2) + '/kWh' },
      { title: 'Monthly Estimate', value: '$' + monthlyCost.toFixed(2), unit: '/month', sub: '30-day projection' },
      { title: 'Efficiency', value: efficiency, unit: 'tok/s/kW', sub: 'Inference per kilowatt' },
    ];

    cards.forEach(c => {
      const card = el('div', 'power-card');
      card.appendChild(el('div', 'power-card-title', c.title));
      const valDiv = el('div', 'power-card-value');
      valDiv.appendChild(document.createTextNode(String(c.value) + ' '));
      valDiv.appendChild(el('span', 'power-card-unit', c.unit));
      card.appendChild(valDiv);
      card.appendChild(el('div', 'power-card-sub', c.sub));
      grid.appendChild(card);
    });

    // Per-node power breakdown
    if (state.nodes.length > 0) {
      state.nodes.forEach(node => {
        const nodePwr = totalNodePower(node);
        if (nodePwr > 0) {
          const card = el('div', 'power-card');
          card.appendChild(el('div', 'power-card-title', node.hostname || node.node_id));
          const valDiv = el('div', 'power-card-value');
          valDiv.appendChild(document.createTextNode(Math.round(nodePwr) + ' '));
          valDiv.appendChild(el('span', 'power-card-unit', 'W'));
          card.appendChild(valDiv);
          const gpuCount = node.gpus ? node.gpus.length : 0;
          card.appendChild(el('div', 'power-card-sub', gpuCount + ' GPU' + (gpuCount !== 1 ? 's' : '')));
          grid.appendChild(card);
        }
      });
    }
  }

  // ===================== COMMAND MODAL =====================
  function openCommandModal(nodeId, hostname) {
    state.commandTarget = { nodeId, hostname };
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
    const payload = { action: dom.cmdAction.value };
    const model = dom.cmdModel.value.trim();
    if (model) payload.model = model;
    const gpu = dom.cmdGpu.value.trim();
    if (gpu !== '') payload.gpu = parseInt(gpu, 10);

    try {
      await api('POST', '/api/v1/nodes/' + state.commandTarget.nodeId + '/commands', payload);
      addTermLine('success', payload.action + ' -> ' + state.commandTarget.hostname);
      closeCommandModal();
    } catch (e) {
      addTermLine('error', 'Command failed: ' + e.message);
    }
  }

  // ===================== TERMINAL =====================
  function termCategory(type) {
    if (type === 'alert') return 'alerts';
    if (type === 'command_sent' || type === 'command') return 'commands';
    if (type === 'node_online' || type === 'node_offline') return 'nodes';
    return 'other';
  }

  function addTermLine(type, message) {
    const now = ts();
    const entry = { type, message, ts: now, cat: termCategory(type) };
    terminalLines.push(entry);
    if (terminalLines.length > MAX_TERMINAL_LINES) terminalLines.shift();
    renderTermLine(entry);
  }

  function renderTermLine(entry) {
    if (terminalFilter !== 'all' && entry.cat !== terminalFilter) return;

    const line = el('div', 'terminal-line t-' + entry.type);

    const tsSpan = el('span', 'term-ts', '[' + entry.ts + ']');
    line.appendChild(tsSpan);

    const typeSpan = el('span', 'term-type', '[' + entry.type.toUpperCase() + ']');
    line.appendChild(typeSpan);

    line.appendChild(document.createTextNode(' ' + entry.message));

    dom.terminalOutput.appendChild(line);

    while (dom.terminalOutput.children.length > MAX_TERMINAL_LINES) {
      dom.terminalOutput.removeChild(dom.terminalOutput.firstChild);
    }

    if (!terminalPaused) {
      dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
    }
  }

  function rebuildTerminal() {
    dom.terminalOutput.textContent = '';
    terminalLines.forEach(e => renderTermLine(e));
  }

  async function handleTermCommand(raw) {
    const input = raw.trim();
    if (!input) return;

    terminalHistory.push(input);
    if (terminalHistory.length > 50) terminalHistory.shift();
    terminalHistIdx = terminalHistory.length;

    addTermLine('command', '$ ' + input);

    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    try {
      if (cmd === 'deploy') {
        const model = parts.slice(1).join(' ');
        if (!model) { addTermLine('error', 'Usage: deploy <model>'); return; }
        addTermLine('info', 'Deploying ' + model + '...');
        const res = await api('POST', '/api/v1/deploy', { model });
        addTermLine('success', 'Deploy: ' + (res.message || res.status || JSON.stringify(res)));
      } else if (cmd === 'status') {
        addTermLine('info', 'Fetching summary...');
        const s = await api('GET', '/api/v1/summary');
        addTermLine('info', '  Nodes: ' + (s.total_nodes || '--') + ' (online: ' + (s.online_nodes || '--') + ')');
        addTermLine('info', '  GPUs: ' + (s.total_gpus || '--'));
        addTermLine('info', '  VRAM: ' + formatBytes(s.used_vram_mb) + '/' + formatBytes(s.total_vram_mb));
        addTermLine('info', '  tok/s: ' + (s.total_toks_per_sec != null ? s.total_toks_per_sec.toFixed(1) : '--'));
      } else if (cmd === 'nodes') {
        addTermLine('info', 'Fetching nodes...');
        const data = await api('GET', '/api/v1/nodes');
        const list = Array.isArray(data) ? data : (data.nodes || data.data || []);
        if (list.length === 0) { addTermLine('warning', 'No nodes found.'); return; }
        list.forEach(n => {
          const s = n.latest_stats || {};
          const on = isOnline(n);
          const gpuCount = n.gpu_count || s.gpu_count || (s.gpus ? s.gpus.length : 0);
          const toks = s.toks_per_sec != null ? s.toks_per_sec : (n.toks_per_sec || 0);
          const models = s.inference ? s.inference.loaded_models.length : 0;
          addTermLine(on ? 'success' : 'error',
            '  ' + (n.hostname || n.node_id) + ' [' + (on ? 'ONLINE' : 'OFFLINE') + '] ' + gpuCount + ' GPUs, ' + models + ' models' + (toks > 0 ? ', ' + toks.toFixed(1) + ' tok/s' : ''));
        });
      } else if (cmd === 'alert' && parts[1] && parts[1].toLowerCase() === 'ack') {
        const alertId = parts[2];
        if (!alertId) { addTermLine('error', 'Usage: alert ack <id>'); return; }
        addTermLine('info', 'Acknowledging alert ' + alertId + '...');
        await api('POST', '/api/v1/alerts/' + alertId + '/acknowledge');
        addTermLine('success', 'Alert ' + alertId + ' acknowledged.');
        fetchAlerts();
      } else if (cmd === 'doctor' || cmd === 'fix') {
        addTermLine('info', 'Running diagnostics...');
        const doc = await api('GET', '/api/v1/doctor?autofix=true');
        addTermLine(doc.status === 'healthy' ? 'success' : 'warning',
          doc.status.toUpperCase() + ' -- ' + doc.summary.ok + '/' + doc.summary.total_checks + ' ok' +
          (doc.summary.auto_fixed > 0 ? ', ' + doc.summary.auto_fixed + ' fixed' : ''));
        doc.results.filter(r => r.status !== 'ok').forEach(r => {
          addTermLine(r.status === 'fixed' ? 'success' : 'warning', '  ' + r.check + ': ' + r.message);
        });
      } else if (cmd === 'health') {
        const h = await api('GET', '/api/v1/health/score');
        addTermLine(h.score >= 80 ? 'success' : 'warning', 'Health: ' + h.score + '/100 (' + h.grade + ')');
      } else if (cmd === 'power' || cmd === 'cost') {
        const p = await api('GET', '/api/v1/power');
        addTermLine('info', 'Power: ' + p.total_watts + 'W | Daily: $' + (p.daily_cost || p.daily_cost_usd || 0).toFixed(2) + ' | Monthly: $' + (p.monthly_cost || p.monthly_cost_usd || 0).toFixed(2));
      } else if (cmd === 'models') {
        const m = await api('GET', '/api/v1/models');
        const models = m.models || [];
        if (models.length === 0) { addTermLine('warning', 'No models loaded.'); return; }
        models.forEach(mod => {
          addTermLine('info', '  ' + mod.model + ' (' + mod.node_count + ' node' + (mod.node_count !== 1 ? 's' : '') + ')');
        });
      } else if (cmd === 'help') {
        addTermLine('info', 'Commands: status, nodes, models, deploy <model>, health, doctor, power, alert ack <id>, help');
      } else {
        addTermLine('warning', 'Unknown command: ' + cmd + '. Type "help" for available commands.');
      }
    } catch (e) {
      addTermLine('error', 'Failed: ' + e.message);
    }
  }

  // ===================== NAVIGATION =====================
  function switchView(viewName) {
    state.activeView = viewName;

    // Update nav
    $$('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Show/hide views
    $$('.view-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === 'view-' + viewName);
    });

    // Lazy load data for view
    switch (viewName) {
      case 'flight-sheets': fetchFlightSheets(); break;
      case 'models': fetchLeaderboard(); renderModels(); break;
      case 'alerts': fetchAlerts(); break;
      case 'benchmarks': fetchBenchmarks(); break;
      case 'power': fetchPower(); renderPower(); break;
      case 'playground': populatePlaygroundModels(); break;
    }
  }

  // ===================== EVENTS =====================
  function bindEvents() {
    // Sidebar nav
    $$('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        switchView(item.dataset.view);
        // On mobile, close sidebar
        if (window.innerWidth <= 1100) {
          dom.sidebar.classList.remove('open');
        }
      });
    });

    // Sidebar toggle (mobile)
    dom.sidebarToggle.addEventListener('click', () => {
      dom.sidebar.classList.toggle('open');
    });

    // Close sidebar on outside click (mobile)
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 1100 && dom.sidebar.classList.contains('open')) {
        if (!dom.sidebar.contains(e.target) && e.target !== dom.sidebarToggle) {
          dom.sidebar.classList.remove('open');
        }
      }
    });

    // Node search
    dom.nodeSearch.addEventListener('input', () => renderNodes());

    // Refresh nodes
    dom.btnRefreshNodes.addEventListener('click', () => {
      fetchNodes(); fetchSummary(); fetchHealthScore();
    });

    // Flight sheets
    dom.btnNewFs.addEventListener('click', () => {
      dom.fsCreateForm.classList.toggle('hidden');
      if (!dom.fsCreateForm.classList.contains('hidden') && dom.fsTargets.children.length === 0) {
        addFsTargetRow();
      }
    });
    dom.btnCancelFs.addEventListener('click', () => dom.fsCreateForm.classList.add('hidden'));
    dom.btnAddTarget.addEventListener('click', addFsTargetRow);
    dom.btnCreateFs.addEventListener('click', createFlightSheet);

    // Alert filter
    dom.alertFilter.addEventListener('change', renderAlerts);

    // Command modal
    dom.btnCloseCmd.addEventListener('click', closeCommandModal);
    dom.btnCancelCmd.addEventListener('click', closeCommandModal);
    dom.btnSendCmd.addEventListener('click', sendCommand);
    dom.cmdModal.addEventListener('click', (e) => {
      if (e.target === dom.cmdModal) closeCommandModal();
    });

    // Action dropdown items
    dom.actionDropdown.querySelectorAll('.action-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        if (!dropdownTarget) return;
        const action = item.dataset.action;
        if (action === 'install_model') {
          openCommandModal(dropdownTarget.nodeId, dropdownTarget.hostname);
        } else if (action === 'benchmark') {
          api('POST', '/api/v1/nodes/' + dropdownTarget.nodeId + '/commands', { action: 'benchmark' })
            .then(() => addTermLine('success', 'Benchmark started on ' + dropdownTarget.hostname))
            .catch(e => addTermLine('error', 'Benchmark failed: ' + e.message));
        } else if (action === 'reboot') {
          if (confirm('Reboot ' + dropdownTarget.hostname + '?')) {
            api('POST', '/api/v1/nodes/' + dropdownTarget.nodeId + '/commands', { action: 'reboot' })
              .then(() => addTermLine('warning', 'Reboot command sent to ' + dropdownTarget.hostname))
              .catch(e => addTermLine('error', 'Reboot failed: ' + e.message));
          }
        } else if (action === 'remove') {
          if (confirm('Remove node ' + dropdownTarget.hostname + '?')) {
            api('POST', '/api/v1/nodes/' + dropdownTarget.nodeId + '/commands', { action: 'remove' })
              .then(() => { addTermLine('warning', 'Node ' + dropdownTarget.hostname + ' removed.'); fetchNodes(); })
              .catch(e => addTermLine('error', 'Remove failed: ' + e.message));
          }
        }
        hideActionDropdown();
      });
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!dom.actionDropdown.contains(e.target) && !e.target.classList.contains('actions-btn')) {
        hideActionDropdown();
      }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeCommandModal();
        hideActionDropdown();
      }
    });

    // Terminal
    dom.btnTermClear.addEventListener('click', () => {
      terminalLines = [];
      dom.terminalOutput.textContent = '';
      addTermLine('system', 'Terminal cleared.');
    });

    dom.btnTermPause.addEventListener('click', () => {
      terminalPaused = !terminalPaused;
      dom.btnTermPause.textContent = terminalPaused ? 'Resume' : 'Pause';
      dom.btnTermPause.style.borderColor = terminalPaused ? 'var(--yellow)' : '';
      dom.btnTermPause.style.color = terminalPaused ? 'var(--yellow)' : '';
      if (!terminalPaused) dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
    });

    dom.btnTermToggle.addEventListener('click', () => {
      dom.terminalPanel.classList.toggle('collapsed');
      dom.btnTermToggle.textContent = dom.terminalPanel.classList.contains('collapsed') ? '\u25B2' : '\u25BC';
    });

    dom.terminalFilter.addEventListener('change', () => {
      terminalFilter = dom.terminalFilter.value;
      rebuildTerminal();
    });

    dom.terminalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = dom.terminalInput.value;
        dom.terminalInput.value = '';
        handleTermCommand(val);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (terminalHistory.length > 0 && terminalHistIdx > 0) {
          terminalHistIdx--;
          dom.terminalInput.value = terminalHistory[terminalHistIdx];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (terminalHistIdx < terminalHistory.length - 1) {
          terminalHistIdx++;
          dom.terminalInput.value = terminalHistory[terminalHistIdx];
        } else {
          terminalHistIdx = terminalHistory.length;
          dom.terminalInput.value = '';
        }
      }
    });

    // Terminal resize handle
    let resizing = false;
    let startY = 0;
    let startH = 0;

    dom.terminalPanel.querySelector('.terminal-handle').addEventListener('mousedown', (e) => {
      resizing = true;
      startY = e.clientY;
      startH = dom.terminalPanel.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const diff = startY - e.clientY;
      const newH = Math.max(100, Math.min(600, startH + diff));
      dom.terminalPanel.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // ===================== INFERENCE PLAYGROUND =====================
  let playgroundHistory = [];

  function populatePlaygroundModels() {
    const select = dom.playgroundModel;
    if (!select) return;
    fetch('/api/v1/models')
      .then(r => r.json())
      .then(data => {
        const models = data.models || [];
        select.innerHTML = '<option value="">Select model...</option>';
        for (const m of models) {
          const opt = document.createElement('option');
          opt.value = m.model;
          opt.textContent = m.model + ' (' + m.node_count + ' nodes)';
          select.appendChild(opt);
        }
      })
      .catch(() => {});
  }

  function addPlaygroundMessage(role, content, meta) {
    const container = dom.playgroundMessages;
    if (!container) return;

    // Remove empty state
    const empty = container.querySelector('.playground-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'playground-msg playground-msg-' + role;
    div.textContent = content;

    if (meta) {
      const metaDiv = document.createElement('div');
      metaDiv.className = 'playground-msg-meta';
      metaDiv.textContent = meta;
      div.appendChild(metaDiv);
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  async function sendPlaygroundMessage() {
    const input = dom.playgroundInput;
    const model = dom.playgroundModel?.value;
    const text = input?.value.trim();

    if (!text) return;
    if (!model) {
      if (dom.playgroundStatus) dom.playgroundStatus.textContent = 'Please select a model first.';
      return;
    }

    addPlaygroundMessage('user', text);
    input.value = '';
    if (dom.playgroundStatus) dom.playgroundStatus.textContent = 'Sending to ' + model + '...';
    if (dom.btnPlaygroundSend) dom.btnPlaygroundSend.disabled = true;

    playgroundHistory.push({ role: 'user', content: text });

    try {
      const startTime = Date.now();
      const resp = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: playgroundHistory,
          stream: false,
        }),
      });

      const elapsed = Date.now() - startTime;
      const data = await resp.json();

      if (data.error) {
        const errMsg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
        addPlaygroundMessage('assistant', 'Error: ' + errMsg);
        if (dom.playgroundStatus) dom.playgroundStatus.textContent = 'Error';
      } else {
        const choice = data.choices?.[0];
        const content = choice?.message?.content || '(empty response)';
        const tc = data._tentaclaw || {};
        const nodeId = tc.hostname || tc.routed_to || 'cluster';
        const latency = tc.latency_ms || elapsed;
        addPlaygroundMessage('assistant', content, nodeId + ' | ' + Math.round(latency / 1000) + 's');
        playgroundHistory.push({ role: 'assistant', content: content });
        if (dom.playgroundStatus) dom.playgroundStatus.textContent = nodeId + ' responded in ' + Math.round(latency / 1000) + 's';
      }
    } catch (err) {
      addPlaygroundMessage('assistant', 'Connection error: ' + err.message);
      if (dom.playgroundStatus) dom.playgroundStatus.textContent = 'Connection error — is the cluster running?';
    }
    if (dom.btnPlaygroundSend) dom.btnPlaygroundSend.disabled = false;
  }

  // Bind playground events
  if (dom.btnPlaygroundSend) {
    dom.btnPlaygroundSend.addEventListener('click', sendPlaygroundMessage);
  }
  if (dom.playgroundInput) {
    dom.playgroundInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPlaygroundMessage();
      }
    });
  }

  // ===================== INIT =====================
  function init() {
    bindEvents();

    // Initial data loads
    fetchNodes();
    fetchSummary();
    fetchHealthScore();
    fetchFlightSheets();
    fetchAlerts();
    fetchBenchmarks();
    fetchPower();
    fetchLeaderboard();
    populatePlaygroundModels();

    connectSSE();

    // Polling
    setInterval(() => {
      fetchNodes();
      fetchSummary();
      fetchHealthScore();

      // Also refresh current view data
      switch (state.activeView) {
        case 'alerts': fetchAlerts(); break;
        case 'power': fetchPower(); break;
      }
    }, POLL_INTERVAL);

    addTermLine('system', 'TentaCLAW OS initialized. Type "help" for commands.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();



