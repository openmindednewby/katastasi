/**
 * Built-in web portal: `acp trace serve`. A dependency-free Node HTTP server with two modes:
 *
 *  - **live (default)** — recomputes from the local working tree; the dashboard has a Run button +
 *    `POST /run`. Storage is the local repo's `runs/`. This is the per-person always-on service.
 *  - **read-only (`--read-only`)** — a git-backed central dashboard: it shows the latest *committed*
 *    run snapshot (optionally `git pull`-ing on an interval) and disables running. Devs' local runs
 *    flow up through normal commits.
 *
 * Same engine + renderers as the CLI; exposes a small JSON/HTTP API so n8n/CI/agents can trigger runs.
 */
import { spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';
import type { TraceConfig } from './config.js';
import { loadTraceConfig } from './config.js';
import { listRuns, loadPreviousRun, loadRun } from './history.js';
import { resolveStoreDir } from './store.js';
import { runTrace } from './index.js';
import { runRequirement, runSuite } from './triggers.js';
import { publishConfluenceReport, postReport, stampJiraLabels, updateRoadmapSection, writeOutputs } from './publish.js';
import { shouldNotify, sendNotification } from './notify.js';
import { renderHtml } from './report/html.js';
import type { TraceReport } from './types.js';

export interface ServeOptions {
  port?: number;
  /** Bind host (default 127.0.0.1 — local only). Use 0.0.0.0 in a container. */
  host?: string;
  /** Git-backed central dashboard: show the latest committed run, disable running. */
  readOnly?: boolean;
  /** In read-only mode, `git pull` the repo on an interval to pick up newly committed runs. */
  pull?: boolean;
  /** Seconds between pulls (default 60). */
  pullIntervalSec?: number;
  /** Re-trace on an interval and push live updates to open dashboards (SSE). */
  watch?: boolean;
  /** Seconds between watch re-traces (default 5). */
  watchIntervalSec?: number;
  /** Shared secret. When set, every request needs it (Bearer header, ?token=, or the rtm_token cookie). */
  token?: string;
  /** With a token set, still allow read-only GETs (dashboard view) without it; protect only mutations. */
  public?: boolean;
}

const PUBLIC_GET = new Set(['GET /', 'GET /index.html', 'GET /api/report', 'GET /api/runs', 'GET /events']);

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** A request is authorized if there's no token, or it presents the token (header / query / cookie). */
function isAuthorized(req: IncomingMessage, url: URL, token: string | undefined): boolean {
  if (!token) return true;
  if (req.headers.authorization === `Bearer ${token}`) return true;
  if (url.searchParams.get('token') === token) return true;
  return parseCookies(req.headers.cookie).rtm_token === token;
}

/** A change signature: the dashboard only refreshes when a state/stat actually changes. */
function signature(report: TraceReport): string {
  const s = report.stats;
  const states = report.requirements.map((r) => `${r.key}:${r.state}`).join(',');
  return `${s.coveragePct}|${s.failing}|${s.regressions}|${s.total}|${states}`;
}

function rel(baseDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

function historyDirOf(config: TraceConfig, baseDir: string): string | null {
  if (!config.history) return null;
  return config.history.dir ? rel(baseDir, config.history.dir) : resolveStoreDir(baseDir, 'runs');
}

function runsFor(historyDir: string | null): string[] {
  if (!historyDir) return [];
  return listRuns(historyDir)
    .map((p) => p.split(/[\\/]/).pop() as string)
    .reverse()
    .slice(0, 20);
}

/** Coverage % across the last 20 runs (oldest → newest), for the trend sparkline. */
function trendFor(historyDir: string | null): number[] {
  if (!historyDir) return [];
  return listRuns(historyDir)
    .slice(-20)
    .map((p) => loadRun(p))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => r.stats.coveragePct);
}

/** Start the portal. Resolves with the listening server (kept alive until stopped). */
export async function serve(configPath: string, baseDir: string, opts: ServeOptions = {}): Promise<Server> {
  const config = loadTraceConfig(configPath);
  const port = opts.port ?? config.portal?.port ?? 8787;
  const host = opts.host ?? '127.0.0.1';
  const readOnly = Boolean(opts.readOnly);
  const token = opts.token && opts.token.length ? opts.token : undefined;
  const isPublic = Boolean(opts.public);
  const historyDir = historyDirOf(config, baseDir);
  const repoDir = rel(baseDir, config.repoDir ?? '.');
  const suites = [...new Set(config.scopes.flatMap((s) => s.tests).filter((t) => t.command).map((t) => t.tech))];

  // The report currently shown. Live mode recomputes on POST /run; read-only reads committed runs.
  let current: TraceReport | null = readOnly && historyDir ? loadPreviousRun(historyDir) : null;
  if (!current) current = await runTrace(config, baseDir, { save: false, compare: !readOnly });

  let version = signature(current as TraceReport);
  const clients = new Set<ServerResponse>();

  /** Send a named SSE event to every open dashboard. */
  function broadcast(event: string, data: string): void {
    const payload = `event: ${event}\ndata: ${data}\n\n`;
    for (const res of clients) res.write(payload);
  }

  /** Adopt a new report; if it actually changed, tell dashboards to refresh. */
  function setCurrent(report: TraceReport): void {
    current = report;
    const sig = signature(report);
    if (sig === version) return;
    version = sig;
    broadcast('changed', 'changed');
  }

  /** Re-derive the current report (read-only: latest committed run; live: a fresh ingest). */
  async function refresh(): Promise<void> {
    const report = readOnly
      ? (historyDir ? loadPreviousRun(historyDir) : null) ?? (current as TraceReport)
      : await runTrace(config, baseDir, { save: false, compare: true });
    setCurrent(report);
  }

  if (readOnly && opts.pull) startPullLoop(repoDir, (opts.pullIntervalSec ?? 60) * 1000);
  if (opts.watch) setInterval(() => void refresh().catch(() => undefined), (opts.watchIntervalSec ?? 5) * 1000).unref();

  const server = createServer((req, res) => {
    route(req, res).catch((err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }));
  });

  await new Promise<void>((ok) => server.listen(port, host, ok));
  const mode = readOnly ? 'read-only · git-backed' : 'live';
  const auth = token ? (isPublic ? ' · token (public view)' : ' · token-protected') : host !== '127.0.0.1' ? ' · ⚠️ NO AUTH' : '';
  process.stdout.write(`\n  RTM portal (${mode}${opts.watch ? ' · watching' : ''}${auth}): http://${host}:${port}${token ? `/?token=${token}` : ''}\n`);
  if (!readOnly) process.stdout.write('  POST /run (?run=1 to execute suites, ?publish=1 to push to Confluence)  ·  GET /api/report  ·  Ctrl+C to stop\n');

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = `${req.method} ${url.pathname}`;

    const publicGet = PUBLIC_GET.has(key) || (req.method === 'GET' && url.pathname.startsWith('/runs/'));
    // Auth gate: a token protects everything, unless --public exempts read-only GETs.
    if (token && !isAuthorized(req, url, token) && !(isPublic && publicGet)) {
      if (req.method === 'GET' && (key === 'GET /' || key === 'GET /index.html')) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>Unauthorized. Append <code>?token=YOUR_TOKEN</code> to the URL (set when the portal was started).</p>');
        return;
      }
      return sendJson(res, 401, { error: 'unauthorized — provide ?token=, an Authorization: Bearer header, or the rtm_token cookie' });
    }

    if (key === 'GET /' || key === 'GET /index.html') {
      if (readOnly && historyDir) current = loadPreviousRun(historyDir) ?? current;
      // Remember the token in a cookie so the dashboard's fetch()/EventSource carry it on reload.
      const headers: Record<string, string> = token ? { 'Set-Cookie': `rtm_token=${token}; HttpOnly; SameSite=Strict; Path=/` } : {};
      return sendHtml(res, portalPage(current as TraceReport, runsFor(historyDir), { readOnly, live: true, trend: trendFor(historyDir), suites }), headers);
    }
    // Permalink to a historical run snapshot (read-only, no auto-refresh).
    if (req.method === 'GET' && url.pathname.startsWith('/runs/')) {
      const file = decodeURIComponent(url.pathname.slice('/runs/'.length));
      if (!historyDir || file.includes('/') || file.includes('..') || !file.endsWith('.json')) return sendJson(res, 404, { error: 'run not found' });
      const snap = loadRun(join(historyDir, file));
      if (!snap) return sendJson(res, 404, { error: 'run not found' });
      return sendHtml(res, portalPage(snap, runsFor(historyDir), { readOnly: true, live: false, trend: trendFor(historyDir) }));
    }
    if (key === 'GET /events') return openEventStream(req, res, clients);
    if (key === 'GET /api/report') {
      if (readOnly && historyDir) current = loadPreviousRun(historyDir) ?? current;
      return sendJson(res, 200, current);
    }
    if (key === 'GET /api/runs') return sendJson(res, 200, { runs: runsFor(historyDir) });
    if (key === 'POST /run') {
      if (readOnly) return sendJson(res, 403, { error: 'read-only dashboard — runs happen on each developer machine' });
      const reqKey = url.searchParams.get('key');
      const suite = url.searchParams.get('suite');
      broadcast('running', JSON.stringify({ key: reqKey, suite }));
      const onLine = (l: string) => broadcast('output', l.replace(/[\r\n]+/g, ' '));
      try {
        const report = reqKey
          ? await runRequirement(config, baseDir, reqKey, onLine) // run only this requirement's tagged tests
          : suite
            ? await runSuite(config, baseDir, suite, onLine) // run just this suite
            : await runTrace(config, baseDir, { run: url.searchParams.get('run') === '1', save: true, compare: true, onLine });
        applySinks(report, config, baseDir, url.searchParams.get('publish') === '1', url.searchParams.get('stamp') === '1');
        setCurrent(report);
        return sendJson(res, 200, { ok: true, stats: report.stats, regressions: report.regressions ?? [] });
      } finally {
        broadcast('done', 'done');
      }
    }
    sendJson(res, 404, { error: `no route: ${key}` });
  }

  return server;
}

/** Server-Sent Events stream: emits `data: changed` whenever the report's signature changes. */
function openEventStream(req: IncomingMessage, res: ServerResponse, clients: Set<ServerResponse>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

/** Periodically `git pull` so a read-only dashboard picks up newly committed runs. */
function startPullLoop(repoDir: string, intervalMs: number): void {
  const pull = () => {
    const res = spawnSync('git pull --ff-only', { cwd: repoDir, shell: true, encoding: 'utf8' });
    if (res.status === 0) process.stdout.write(`  [git pull] ${(res.stdout ?? '').trim().split('\n').pop() ?? 'ok'}\n`);
  };
  pull();
  setInterval(pull, intervalMs).unref();
}

/** Write file outputs + roadmap section (+ Confluence / Jira labels when asked) after a triggered run. */
function applySinks(report: TraceReport, config: TraceConfig, baseDir: string, publish: boolean, stamp: boolean): void {
  if (config.output) writeOutputs(report, config.output, baseDir);
  if (config.output?.post) void postReport(report, config.output.post).catch(() => undefined);
  if (config.publish?.roadmap) updateRoadmapSection(report, config.publish.roadmap, baseDir);
  if (publish && config.publish?.confluence) {
    void publishConfluenceReport(report, config.publish.confluence).catch(() => undefined);
  }
  if (stamp && config.publish?.jira?.verifiedLabel) {
    void stampJiraLabels(report, config.publish.jira).catch(() => undefined);
  }
  if (config.notify?.webhook && shouldNotify(report, config.notify.on)) {
    void sendNotification(config.notify.webhook, report).catch(() => undefined);
  }
}

const PORTAL_STYLE = `
.portal{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.run-btn{background:#1a7f37;color:#fff;border:0;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:600;cursor:pointer}
.run-btn:disabled{opacity:.6;cursor:default}
.ro-badge{background:#ddf4ff;color:#0969da;border:1px solid #54aeff;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600}
.run-opt{font-size:13px;color:#57606a}.portal-links a{font-size:13px;color:#0969da}
.runs{font-size:13px}.runs ul{margin:6px 0 0;padding-left:18px;max-height:160px;overflow:auto}
.runs code{font-family:ui-monospace,Menlo,Consolas,monospace}.runs a{color:#0969da;text-decoration:none}
.spark{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#1a7f37;font-weight:600}
.rowrun{display:inline-block !important}
.suiterun{border:1px solid #d0d7de;background:#fff;border-radius:6px;font-size:12px;padding:4px 9px;cursor:pointer;color:#1a7f37}
.suiterun:hover{background:#f0fff4}.suiterun:disabled{opacity:.5}.suites{display:inline-flex;gap:6px;flex-wrap:wrap}
.live{position:fixed;right:14px;bottom:14px;width:440px;max-width:92vw;background:#0d1117;color:#c9d1d9;border-radius:8px;box-shadow:0 6px 24px #0007;z-index:50;overflow:hidden;display:none}
.live .livehd{display:flex;justify-content:space-between;padding:7px 12px;background:#161b22;color:#58a6ff;font-weight:600;font-size:12px}
.live .livehd button{background:none;border:0;color:#8b949e;cursor:pointer;font-size:13px}
.live pre{margin:0;padding:8px 12px;max-height:220px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}`;

const PORTAL_SCRIPT = `
const btn=document.getElementById('rtm-run'),chk=document.getElementById('rtm-suites');
btn&&btn.addEventListener('click',async()=>{btn.disabled=true;btn.textContent='Running…';
  try{await fetch('/run'+(chk&&chk.checked?'?run=1':''),{method:'POST'});location.reload();}
  catch(e){btn.textContent='Run failed — retry';btn.disabled=false;}});
// Granular triggers: per-requirement ▶ (run only its tagged tests) and per-suite ▶.
document.addEventListener('click',async(ev)=>{
  const t=ev.target.closest&&(ev.target.closest('.rowrun')||ev.target.closest('.suiterun'));if(!t)return;
  const q=t.classList.contains('rowrun')?'key='+encodeURIComponent(t.dataset.key):'suite='+encodeURIComponent(t.dataset.suite);
  t.disabled=true;const o=t.textContent;t.textContent='⏳';
  try{await fetch('/run?run=1&'+q,{method:'POST'});location.reload();}
  catch(e){t.textContent='!';t.disabled=false;}});`;

// Live status: a panel shows the running command's output; the dashboard reloads when it finishes.
const SSE_SCRIPT = `
function rtmPanel(){let p=document.getElementById('rtm-live');if(!p){p=document.createElement('div');p.id='rtm-live';p.className='live';
  p.innerHTML='<div class="livehd"><span id="rtm-live-hd">⏳ running…</span><button onclick="document.getElementById(\\'rtm-live\\').style.display=\\'none\\'">✕</button></div><pre></pre>';
  document.body.appendChild(p);}return p;}
try{const es=new EventSource('/events');
  es.addEventListener('changed',()=>location.reload());
  es.addEventListener('running',()=>{const p=rtmPanel();p.querySelector('pre').textContent='';p.querySelector('#rtm-live-hd').textContent='⏳ running…';p.style.display='block';});
  es.addEventListener('output',(e)=>{const p=rtmPanel();const pre=p.querySelector('pre');pre.textContent+=e.data+'\\n';pre.scrollTop=pre.scrollHeight;});
  es.addEventListener('done',()=>{const hd=document.querySelector('#rtm-live-hd');if(hd)hd.textContent='✓ done';});
}catch(_){}`;

/** A tiny inline SVG sparkline of coverage % across recent runs. */
function sparkline(trend: number[]): string {
  if (trend.length < 2) return '';
  const w = 120;
  const h = 22;
  const pts = trend
    .map((v, i) => `${((i / (trend.length - 1)) * w).toFixed(1)},${(h - (Math.max(0, Math.min(100, v)) / 100) * h).toFixed(1)}`)
    .join(' ');
  return `<span class="spark" title="coverage trend (last ${trend.length} runs)"><svg width="${w}" height="${h}"><polyline fill="none" stroke="#1a7f37" stroke-width="1.5" points="${pts}"/></svg>${trend[trend.length - 1]}%</span>`;
}

/** Inject the portal toolbar + script into the static dashboard HTML. */
export function portalPage(
  report: TraceReport,
  runs: string[],
  opts: { readOnly?: boolean; live?: boolean; trend?: number[]; suites?: string[] } = {},
): string {
  const runsList = runs.length
    ? runs.map((r) => { const e = r.replace(/</g, '&lt;'); return `<li><a href="/runs/${encodeURIComponent(r)}"><code>${e}</code></a></li>`; }).join('')
    : '<li>(no history yet)</li>';
  const suiteBtns = !opts.readOnly && opts.suites && opts.suites.length
    ? `<span class="suites">${opts.suites.map((s) => `<button class="suiterun" data-suite="${s.replace(/[^a-z0-9]/gi, '')}" title="Run the ${s} suite">▶ ${s.replace(/</g, '&lt;')}</button>`).join('')}</span>`
    : '';
  const control = opts.readOnly
    ? '<span class="ro-badge">● read-only · git-backed</span>'
    : '<button id="rtm-run" class="run-btn">▶ Run</button>' +
      '<label class="run-opt"><input type="checkbox" id="rtm-suites"> execute test suites</label>' +
      suiteBtns;
  const toolbar =
    '<div class="portal">' +
    control +
    sparkline(opts.trend ?? []) +
    '<span class="portal-links"><a href="/api/report" target="_blank">JSON</a></span>' +
    `<details class="runs"><summary>History (${runs.length})</summary><ul>${runsList}</ul></details>` +
    '</div>';
  let html = renderHtml(report)
    .replace('</head>', `<style>${PORTAL_STYLE}</style></head>`)
    .replace('<div class="cards">', `${toolbar}<div class="cards">`);
  const scripts: string[] = [];
  if (!opts.readOnly) scripts.push(PORTAL_SCRIPT);
  if (opts.live) scripts.push(SSE_SCRIPT);
  if (scripts.length) html = html.replace('</body>', `<script>${scripts.join('\n')}</script></body>`);
  return html;
}

function sendHtml(res: ServerResponse, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
