export function renderDashboard(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MICA Dashboard</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b0d12;
        --surface: #11151c;
        --surface-raised: #0f131a;
        --surface-selected: #121926;
        --border: #252c3a;
        --border-strong: #3b82f6;
        --text: #e6edf3;
        --muted: #8b95a7;
        --subtle: #8b95a7;
        --live: #34d399;
        --degraded: #fbbf24;
        --offline: #64748b;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
      main { max-width: 1240px; margin: 0 auto; padding: 32px 24px; }
      .hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 22px; }
      .eyebrow { margin: 0 0 6px; color: var(--subtle); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(2rem, 4vw, 3rem); line-height: 1; letter-spacing: -0.04em; }
      .subtitle { margin: 10px 0 0; color: var(--muted); font-size: 0.9rem; }
      .auth-pill { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #23483a; background: #0f1714; color: #8ee6bd; border-radius: 999px; padding: 7px 11px; font-size: 0.78rem; white-space: nowrap; }
      .status-dot { width: 7px; height: 7px; border-radius: 999px; display: inline-block; background: currentColor; }
      .status-dot.live { color: var(--live); }
      .status-dot.degraded { color: var(--degraded); }
      .status-dot.offline { color: var(--offline); }
      #auth-message { margin: 0 0 16px; color: var(--muted); min-height: 1.2em; }
      .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .card { min-height: 116px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: var(--text); padding: 14px; text-align: left; transition: border-color 150ms ease, background 150ms ease, transform 150ms ease; }
      .card--interactive { cursor: pointer; }
      .card--interactive:hover { border-color: #4b5871; transform: translateY(-1px); }
      .card--interactive:focus-visible, .detail-close:focus-visible { outline: 0; box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--border-strong); }
      .card--selected { background: var(--surface-selected); border-color: var(--border-strong); }
      .card-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 13px; }
      .card-title { color: var(--subtle); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; }
      .card--selected .card-title { color: #9fc3ff; }
      .card-value { font-size: 1.45rem; line-height: 1.1; font-weight: 680; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .card-footer { margin-top: 13px; padding-top: 10px; border-top: 1px solid #222938; color: var(--muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
      .chevron { color: var(--subtle); font-size: 0.8rem; }
      .card--selected .chevron { color: #9fc3ff; }
      .detail-panel { margin-top: 16px; border: 1px solid #252f40; border-radius: 16px; background: var(--surface-raised); overflow: hidden; }
      .detail-panel[hidden] { display: none; }
      .detail-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #222938; background: #111722; }
      .detail-title { margin: 0; font-size: 1rem; letter-spacing: -0.01em; }
      .detail-subtitle { margin: 4px 0 0; color: var(--muted); font-size: 0.78rem; }
      .detail-close { border: 1px solid #2d3546; border-radius: 10px; background: #151b26; color: #cbd5e1; padding: 7px 11px; cursor: pointer; }
      .detail-body { padding: 12px 16px 16px; max-height: 40vh; overflow: auto; }
      .detail-table { display: grid; gap: 8px; }
      .detail-row { display: grid; grid-template-columns: 1.4fr 0.8fr 1fr 1fr 1fr; gap: 10px; align-items: center; border: 1px solid #222938; border-radius: 11px; background: var(--surface); padding: 10px 8px; font-size: 0.82rem; font-variant-numeric: tabular-nums; }
      .detail-row--header { border: 0; background: transparent; padding-bottom: 0; color: var(--subtle); font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; }
      .mono { font-family: ui-monospace, Cascadia Code, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .chip { display: inline-flex; align-items: center; gap: 6px; width: fit-content; border-radius: 999px; padding: 2px 9px; font-size: 0.76rem; }
      .chip::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
      .chip--live { background: rgba(52, 211, 153, 0.12); color: #7ee7b8; }
      .chip--degraded { background: rgba(251, 191, 36, 0.12); color: #f7d36d; }
      .chip--offline, .chip--retired { background: rgba(100, 116, 139, 0.16); color: #aeb8c7; }
      .empty-state { border: 1px dashed #30384a; border-radius: 12px; padding: 24px 16px; text-align: center; color: var(--muted); }
      @media (max-width: 760px) { .hero { flex-direction: column; } .detail-row { grid-template-columns: 1fr; } .detail-row--header { display: none; } .detail-cell::before { content: attr(data-label) ": "; color: var(--subtle); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; } }
      @media (prefers-reduced-motion: reduce) { .card { transition: none; } .card--interactive:hover { transform: none; } }
    </style>
  </head>
  <body>
    <main>
      <header class="hero">
        <div>
          <p class="eyebrow">Local bridge diagnostics</p>
          <h1>MICA Dashboard</h1>
          <p class="subtitle">Taste-polished status overview for the local Wolfram notebook bridge. <span id="updated-at">Waiting for data.</span></p>
        </div>
        <div class="auth-pill"><span class="status-dot live"></span><span id="auth-state">Auth pending</span></div>
      </header>
      <p id="auth-message"></p>

      <div class="card-grid" aria-label="Diagnostic modules">
        <section class="card" aria-label="Server">
          <div class="card-header"><span class="card-title">Server</span><span id="server-dot" class="status-dot offline"></span></div>
          <div id="server-value" class="card-value">Waiting</div>
          <div id="server-meta" class="card-footer">No authenticated data yet</div>
        </section>

        <button id="agents-card" class="card card--interactive" type="button" data-detail="agents" aria-controls="detail-panel" aria-expanded="false">
          <div class="card-header"><span class="card-title">Agents</span><span class="chevron">▸</span></div>
          <div id="agents-value" class="card-value">Locked</div>
          <div id="agents-meta" class="card-footer">Open dashboard token URL</div>
        </button>

        <button id="notebooks-card" class="card card--interactive" type="button" data-detail="notebooks" aria-controls="detail-panel" aria-expanded="false">
          <div class="card-header"><span class="card-title">Notebooks</span><span class="chevron">▸</span></div>
          <div id="notebooks-value" class="card-value">Locked</div>
          <div id="notebooks-meta" class="card-footer">Open dashboard token URL</div>
        </button>

        <section class="card" aria-label="Requests">
          <div class="card-header"><span class="card-title">Requests</span><span class="status-dot offline"></span></div>
          <div id="requests-value" class="card-value">Waiting</div>
          <div id="requests-meta" class="card-footer">No queue data yet</div>
        </section>

        <section class="card" aria-label="Security">
          <div class="card-header"><span class="card-title">Security</span><span id="security-dot" class="status-dot offline"></span></div>
          <div id="security-value" class="card-value">Token hidden</div>
          <div id="security-meta" class="card-footer token-hidden">Bearer auth status pending</div>
        </section>
      </div>

      <section id="detail-panel" class="detail-panel" role="region" aria-labelledby="detail-title" aria-live="polite" hidden>
        <div class="detail-header">
          <div>
            <h2 id="detail-title" class="detail-title">Details</h2>
            <p id="detail-subtitle" class="detail-subtitle">Select Agents or Notebooks to inspect live bridge records.</p>
          </div>
          <button id="detail-close" class="detail-close" type="button" aria-label="Close details panel">Collapse</button>
        </div>
        <div id="detail-body" class="detail-body"></div>
      </section>
    </main>
    <script>
      let refreshInFlight = false;
      let latestStatus = null;
      let latestNotebooks = null;
      let activeDetail = null;
      const token = new URLSearchParams(location.hash.slice(1)).get('token');

      function dashboardHeaders() {
        return token ? { authorization: \`Bearer \${token}\` } : {};
      }

      function requireDashboardToken() {
        if (token) return true;
        const message = 'Missing dashboard token. Open the dashboard URL printed by the MICA server.';
        document.getElementById('auth-message').textContent = message;
        document.getElementById('auth-state').textContent = 'Auth required';
        renderLockedDashboard(message);
        return false;
      }

      function renderLockedDashboard(message) {
        setText('server-value', 'Locked');
        setText('server-meta', message);
        setText('agents-value', 'Locked');
        setText('agents-meta', 'Authenticate to view agents');
        setText('notebooks-value', 'Locked');
        setText('notebooks-meta', 'Authenticate to view notebooks');
        setText('requests-value', 'Locked');
        setText('requests-meta', 'Authenticate to view queue');
        setText('security-value', 'Protected');
        setText('security-meta', 'Token required; token hidden');
      }

      async function refreshDashboard() {
        if (!requireDashboardToken()) return;
        if (refreshInFlight) return;
        refreshInFlight = true;
        setText('auth-state', 'Refreshing…');

        try {
          const [statusResponse, notebooksResponse] = await Promise.all([
            fetch('/status', { headers: dashboardHeaders() }),
            fetch('/notebooks', { headers: dashboardHeaders() }),
          ]);

          latestStatus = await statusResponse.json();
          latestNotebooks = await notebooksResponse.json();
          renderDashboardData();
        } finally {
          refreshInFlight = false;
        }
      }

      function renderDashboardData() {
        const agents = Array.isArray(latestStatus?.agents) ? latestStatus.agents : [];
        const notebooks = Array.isArray(latestNotebooks?.notebooks) ? latestNotebooks.notebooks : [];
        const requests = latestStatus?.requests ?? {};
        const server = latestStatus?.server ?? {};
        const security = latestStatus?.security ?? {};

        document.getElementById('auth-message').textContent = '';
        setText('auth-state', security.authEnabled ? 'Auth enabled' : 'Auth disabled');
        setText('updated-at', 'Updated just now.');
        setText('server-value', titleCase(server.state ?? 'running'));
        setText('server-meta', 'pid ' + safeText(server.pid) + ' · ' + formatDuration(server.uptimeMs) + ' uptime');
        document.getElementById('server-dot').className = 'status-dot live';

        const liveAgents = countStatus(agents, 'live');
        const degradedAgents = countStatus(agents, 'degraded');
        const offlineAgents = agents.length - liveAgents - degradedAgents;
        setText('agents-value', liveAgents + ' live');
        setText('agents-meta', degradedAgents + ' degraded · ' + offlineAgents + ' offline');

        const liveNotebooks = countStatus(notebooks, 'live');
        const degradedNotebooks = countStatus(notebooks, 'degraded');
        setText('notebooks-value', liveNotebooks + ' live');
        setText('notebooks-meta', degradedNotebooks + ' degraded · active ' + safeText(latestNotebooks?.activeNotebookId ?? 'none'));

        setText('requests-value', safeText(requests.running ?? 0) + ' running');
        setText('requests-meta', 'queued ' + safeText(requests.queued ?? 0) + ' · timed out ' + safeText(requests.timed_out ?? 0));

        setText('security-value', security.authEnabled ? 'Protected' : 'Local only');
        setText('security-meta', security.dashboardTokenPresent ? 'Bearer auth · token hidden' : 'No bearer token configured');
        document.getElementById('security-dot').className = security.authEnabled ? 'status-dot live' : 'status-dot offline';

        if (activeDetail) renderDetail(activeDetail);
      }

      function openDetail(kind) {
        if (!latestStatus && !latestNotebooks) return;
        activeDetail = activeDetail === kind ? null : kind;
        updateDetailState();
      }

      function updateDetailState() {
        for (const card of document.querySelectorAll('[data-detail]')) {
          const selected = card.dataset.detail === activeDetail;
          card.classList.toggle('card--selected', selected);
          card.setAttribute('aria-expanded', selected ? 'true' : 'false');
          card.querySelector('.chevron').textContent = selected ? '▾' : '▸';
        }
        const panel = document.getElementById('detail-panel');
        panel.hidden = !activeDetail;
        if (activeDetail) renderDetail(activeDetail);
      }

      function renderDetail(kind) {
        const body = document.getElementById('detail-body');
        body.textContent = '';
        if (kind === 'agents') {
          setText('detail-title', 'Agents');
          setText('detail-subtitle', 'Connected Wolfram control agents, status, and heartbeat age.');
          renderRows(body, ['Agent', 'Status', 'Last seen', 'Wolfram', 'Platform'], (latestStatus?.agents ?? []).map((agent) => [
            mono(agent.agentSessionId), chip(agent.status), formatAge(agent.lastSeenAt), safeText(agent.wolframVersion), safeText(agent.platform)
          ]), 'No agents connected. Start MICA and open Wolfram Desktop to register one.');
          return;
        }

        setText('detail-title', 'Notebooks');
        setText('detail-subtitle', 'Registered live notebooks and mutation permissions.');
        renderRows(body, ['Notebook', 'Status', 'Last seen', 'ID', 'Permissions'], (latestNotebooks?.notebooks ?? []).map((notebook) => [
          safeText(notebook.displayName), chip(notebook.status), formatAge(notebook.lastSeenAt), mono(notebook.notebookId), safeText(enabledPermissions(notebook.permissions))
        ]), 'No notebooks registered. Open a notebook in Wolfram Desktop to see it here.');
      }

      function renderRows(container, headers, rows, emptyMessage) {
        const table = document.createElement('div');
        table.className = 'detail-table';
        table.setAttribute('role', 'table');
        const header = document.createElement('div');
        header.className = 'detail-row detail-row--header';
        header.setAttribute('role', 'row');
        for (const label of headers) header.appendChild(cell(label, label, 'columnheader'));
        table.appendChild(header);
        if (rows.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'empty-state';
          empty.textContent = emptyMessage;
          table.appendChild(empty);
        } else {
          for (const row of rows) {
            const item = document.createElement('div');
            item.className = 'detail-row';
            item.setAttribute('role', 'row');
            row.forEach((value, index) => item.appendChild(value instanceof Node ? labelNode(value, headers[index]) : cell(value, headers[index])));
            table.appendChild(item);
          }
        }
        container.appendChild(table);
      }

      function cell(value, label, role = 'cell') {
        const div = document.createElement('div');
        div.className = 'detail-cell';
        div.setAttribute('role', role);
        if (label) div.dataset.label = label;
        div.textContent = safeText(value);
        return div;
      }

      function labelNode(node, label) {
        const wrapper = document.createElement('div');
        wrapper.className = 'detail-cell';
        wrapper.setAttribute('role', 'cell');
        if (label) wrapper.dataset.label = label;
        wrapper.appendChild(node);
        return wrapper;
      }

      function chip(status) {
        const span = document.createElement('span');
        const value = safeText(status || 'unknown');
        span.className = 'chip chip--' + value;
        span.setAttribute('role', 'status');
        span.setAttribute('aria-label', 'Status: ' + value);
        span.textContent = value;
        return span;
      }

      function mono(value) {
        const span = document.createElement('span');
        span.className = 'mono';
        span.title = safeText(value);
        span.textContent = safeText(value);
        return span;
      }

      function enabledPermissions(permissions) {
        if (!permissions || typeof permissions !== 'object') return 'unknown';
        return Object.entries(permissions).filter(([, allowed]) => allowed).map(([name]) => name.replace(/Notebook|Cell/g, '')).join(', ') || 'none';
      }

      function countStatus(items, status) {
        return items.filter((item) => item.status === status).length;
      }

      function formatAge(timestamp) {
        if (typeof timestamp !== 'number') return 'unknown';
        return formatDuration(Date.now() - timestamp) + ' ago';
      }

      function formatDuration(ms) {
        if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'unknown';
        const seconds = Math.max(0, Math.floor(ms / 1000));
        if (seconds < 60) return seconds + 's';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm';
        return Math.floor(minutes / 60) + 'h';
      }

      function titleCase(value) {
        const text = safeText(value);
        return text.charAt(0).toUpperCase() + text.slice(1);
      }

      function safeText(value) {
        if (value === undefined || value === null || value === '') return 'none';
        return String(value);
      }

      function setText(id, value) {
        document.getElementById(id).textContent = safeText(value);
      }

      function closeDetail() {
        activeDetail = null;
        updateDetailState();
      }

      for (const card of document.querySelectorAll('[data-detail]')) {
        card.addEventListener('click', () => openDetail(card.dataset.detail));
      }
      document.getElementById('detail-close').addEventListener('click', closeDetail);
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && activeDetail) closeDetail();
      });

      function scheduleRefresh() {
        setTimeout(() => {
          refreshDashboard()
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              document.getElementById('auth-message').textContent = 'Failed to refresh dashboard: ' + message;
            })
            .finally(() => {
              scheduleRefresh();
            });
        }, 2000);
      }

      refreshDashboard()
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          document.getElementById('auth-message').textContent = 'Failed to refresh dashboard: ' + message;
        })
        .finally(() => {
          scheduleRefresh();
        });
    </script>
  </body>
</html>`;
}
