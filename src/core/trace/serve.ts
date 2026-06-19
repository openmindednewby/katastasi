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
import { isAbsolute, resolve } from 'node:path';
import type { TraceConfig } from './config.js';
import { loadTraceConfig } from './config.js';
import { listRuns, loadPreviousRun } from './history.js';
import { runTrace } from './index.js';
import { publishConfluenceReport, stampJiraLabels, updateRoadmapSection, writeOutputs } from './publish.js';
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
  return config.history ? rel(baseDir, config.history.dir) : null;
}

function runsFor(historyDir: string | null): string[] {
  if (!historyDir) return [];
  return listRuns(historyDir)
    .map((p) => p.split(/[\\/]/).pop() as string)
    .reverse()
    .slice(0, 20);
}

/** Start the portal. Resolves with the listening server (kept alive until stopped). */
export async function serve(configPath: string, baseDir: string, opts: ServeOptions = {}): Promise<Server> {
  const config = loadTraceConfig(configPath);
  const port = opts.port ?? config.portal?.port ?? 8787;
  const host = opts.host ?? '127.0.0.1';
  const readOnly = Boolean(opts.readOnly);
  const historyDir = historyDirOf(config, baseDir);
  const repoDir = rel(baseDir, config.repoDir ?? '.');

  // The report currently shown. Live mode recomputes on POST /run; read-only reads committed runs.
  let current: TraceReport | null = readOnly && historyDir ? loadPreviousRun(historyDir) : null;
  if (!current) current = await runTrace(config, baseDir, { save: false, compare: !readOnly });

  let version = signature(current as TraceReport);
  const clients = new Set<ServerResponse>();

  /** Adopt a new report; if it actually changed, notify open dashboards to refresh. */
  function setCurrent(report: TraceReport): void {
    current = report;
    const sig = signature(report);
    if (sig === version) return;
    version = sig;
    for (const res of clients) res.write('data: changed\n\n');
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
  process.stdout.write(`\n  RTM portal (${mode}${opts.watch ? ' · watching' : ''}): http://${host}:${port}\n`);
  if (!readOnly) process.stdout.write('  POST /run (?run=1 to execute suites, ?publish=1 to push to Confluence)  ·  GET /api/report  ·  Ctrl+C to stop\n');

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = `${req.method} ${url.pathname}`;

    if (key === 'GET /' || key === 'GET /index.html') {
      if (readOnly && historyDir) current = loadPreviousRun(historyDir) ?? current;
      return sendHtml(res, portalPage(current as TraceReport, runsFor(historyDir), { readOnly, live: true }));
    }
    if (key === 'GET /events') return openEventStream(req, res, clients);
    if (key === 'GET /api/report') {
      if (readOnly && historyDir) current = loadPreviousRun(historyDir) ?? current;
      return sendJson(res, 200, current);
    }
    if (key === 'GET /api/runs') return sendJson(res, 200, { runs: runsFor(historyDir) });
    if (key === 'POST /run') {
      if (readOnly) return sendJson(res, 403, { error: 'read-only dashboard — runs happen on each developer machine' });
      const report = await runTrace(config, baseDir, { run: url.searchParams.get('run') === '1', save: true, compare: true });
      applySinks(report, config, baseDir, url.searchParams.get('publish') === '1', url.searchParams.get('stamp') === '1');
      setCurrent(report);
      return sendJson(res, 200, { ok: true, stats: report.stats, regressions: report.regressions ?? [] });
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
  if (config.publish?.roadmap) updateRoadmapSection(report, config.publish.roadmap, baseDir);
  if (publish && config.publish?.confluence) {
    void publishConfluenceReport(report, config.publish.confluence).catch(() => undefined);
  }
  if (stamp && config.publish?.jira?.verifiedLabel) {
    void stampJiraLabels(report, config.publish.jira).catch(() => undefined);
  }
}

const PORTAL_STYLE = `
.portal{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.run-btn{background:#1a7f37;color:#fff;border:0;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:600;cursor:pointer}
.run-btn:disabled{opacity:.6;cursor:default}
.ro-badge{background:#ddf4ff;color:#0969da;border:1px solid #54aeff;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600}
.run-opt{font-size:13px;color:#57606a}.portal-links a{font-size:13px;color:#0969da}
.runs{font-size:13px}.runs ul{margin:6px 0 0;padding-left:18px;max-height:160px;overflow:auto}
.runs code{font-family:ui-monospace,Menlo,Consolas,monospace}`;

const PORTAL_SCRIPT = `
const btn=document.getElementById('rtm-run'),chk=document.getElementById('rtm-suites');
btn&&btn.addEventListener('click',async()=>{btn.disabled=true;btn.textContent='Running…';
  try{await fetch('/run'+(chk&&chk.checked?'?run=1':''),{method:'POST'});location.reload();}
  catch(e){btn.textContent='Run failed — retry';btn.disabled=false;}});`;

// Auto-refresh: reload when the server signals the report changed (a run, a watch tick, a pull).
const SSE_SCRIPT = `try{const es=new EventSource('/events');es.onmessage=()=>location.reload();}catch(_){}`;

/** Inject the portal toolbar + script into the static dashboard HTML. */
export function portalPage(report: TraceReport, runs: string[], opts: { readOnly?: boolean; live?: boolean } = {}): string {
  const runsList = runs.length
    ? runs.map((r) => `<li><code>${r.replace(/</g, '&lt;')}</code></li>`).join('')
    : '<li>(no history yet)</li>';
  const control = opts.readOnly
    ? '<span class="ro-badge">● read-only · git-backed</span>'
    : '<button id="rtm-run" class="run-btn">▶ Run</button>' +
      '<label class="run-opt"><input type="checkbox" id="rtm-suites"> execute test suites</label>';
  const toolbar =
    '<div class="portal">' +
    control +
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

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
