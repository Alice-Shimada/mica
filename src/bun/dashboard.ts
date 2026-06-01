export function renderDashboard(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MMA Agent Bridge</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: system-ui, sans-serif; background: #0f1115; color: #e8edf3; }
      main { max-width: 1100px; margin: 0 auto; padding: 24px; }
      h1 { margin: 0 0 16px; font-size: 2rem; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      section { background: #171b22; border: 1px solid #2a3140; border-radius: 12px; padding: 16px; }
      h2 { margin: 0 0 12px; font-size: 1.1rem; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.875rem; line-height: 1.5; }
      .muted { color: #96a0b5; }
    </style>
  </head>
  <body>
    <main>
      <h1>MMA Agent Bridge</h1>
      <p id="auth-message" class="muted"></p>
      <div class="grid">
        <section>
          <h2>Notebook Registry</h2>
          <pre id="notebooks" class="muted">Loading notebooks…</pre>
        </section>
        <section>
          <h2>Request Queue</h2>
          <pre class="muted">Request queue status is refreshed through the backend shell.</pre>
        </section>
        <section>
          <h2>Diagnostics</h2>
          <pre id="diagnostics" class="muted">Loading diagnostics…</pre>
        </section>
      </div>
    </main>
    <script>
      let refreshInFlight = false;
      const token = new URLSearchParams(location.hash.slice(1)).get('token');

      function dashboardHeaders() {
        return token ? { authorization: \`Bearer \${token}\` } : {};
      }

      function requireDashboardToken() {
        if (token) return true;
        const message = 'Missing dashboard token. Open the dashboard URL printed by the MICA server.';
        document.getElementById('auth-message').textContent = message;
        document.getElementById('diagnostics').textContent = message;
        document.getElementById('notebooks').textContent = message;
        return false;
      }

      async function refreshDashboard() {
        if (!requireDashboardToken()) return;
        if (refreshInFlight) return;
        refreshInFlight = true;

        const [statusResponse, notebooksResponse] = await Promise.all([
          fetch('/status', { headers: dashboardHeaders() }),
          fetch('/notebooks', { headers: dashboardHeaders() }),
        ]);

        const status = await statusResponse.json();
        const notebooks = await notebooksResponse.json();

        document.getElementById('diagnostics').textContent = JSON.stringify(status, null, 2);
        document.getElementById('notebooks').textContent = JSON.stringify(notebooks, null, 2);

        refreshInFlight = false;
      }

      function scheduleRefresh() {
        setTimeout(() => {
          refreshDashboard()
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              document.getElementById('diagnostics').textContent = 'Failed to refresh dashboard: ' + message;
            })
            .finally(() => {
              refreshInFlight = false;
              scheduleRefresh();
            });
        }, 2000);
      }

      refreshDashboard()
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          document.getElementById('diagnostics').textContent = 'Failed to refresh dashboard: ' + message;
        })
        .finally(() => {
          refreshInFlight = false;
          scheduleRefresh();
        });
    </script>
  </body>
</html>`;
}
