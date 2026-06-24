/**
 * The web-wizard local server — plain `node:http`, no framework, loopback-bound by default (it handles a
 * dev's credentials, so it must not be exposed). Serves the self-contained SPA and the `/api/*` endpoints
 * that call the existing core. Slice 1 wires Connect (`/api/env`); later slices add discovery / pull /
 * analyze / sync on the same router. `handleRequest` is exported so endpoints are unit-tested with no socket.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { readEnvStatus, readEnvValues, writeEnvKeys } from './envFile.js';
import { renderWizardPage } from './page.js';
import { discover, type DiscoverClient } from './discover.js';
import { atlassianDiscoverClient } from './atlassianClient.js';
import { pullSelected, type PullItem } from './pull.js';
import { loadTraceConfig, parseTraceConfig, type TraceConfig } from '../trace/config.js';
import { runWizard } from '../wizard/wizard.js';
import { defaultChat, aiConfigFromEnv, type ChatFn } from '../analyze/ai.js';
import { runSync } from '../sync/sync.js';
import type { SyncAdapter } from '../sync/model.js';

export interface WebServerContext {
  baseDir: string;
  /** Injected in tests; defaults to a real Atlassian client built from the saved `.env`. */
  discoverClient?: DiscoverClient;
  /** Injected in tests; defaults to the model resolved from the saved `.env`. */
  chat?: ChatFn;
  /** Injected in tests; per-binding sync adapters (else built from the saved `.env`). */
  syncAdapters?: Record<string, SyncAdapter>;
}

/** Use the repo's acp-trace.json if present, else synthesise one over the pulled requirements. */
function configFor(baseDir: string): TraceConfig {
  const cfgPath = join(baseDir, 'acp-trace.json');
  if (existsSync(cfgPath)) return loadTraceConfig(cfgPath);
  return parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: '.acp/requirements/index.md' }] }] }));
}

function rel(baseDir: string, p: string): string {
  return relative(baseDir, p).replace(/\\/g, '/');
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function json(res: ServerResponse, status: number, data: unknown): void {
  send(res, status, JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

/** Route one request. Pure-ish (only touches the filesystem via the core) so tests drive it directly. */
export async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: WebServerContext): Promise<void> {
  const url = (req.url ?? '/').split('?')[0];
  const method = req.method ?? 'GET';

  try {
    if (method === 'GET' && (url === '/' || url === '/index.html')) {
      return send(res, 200, renderWizardPage(), 'text/html; charset=utf-8');
    }
    if (method === 'GET' && url === '/api/env') {
      return json(res, 200, readEnvStatus(ctx.baseDir));
    }
    if (method === 'POST' && url === '/api/env') {
      let kv: Record<string, string> = {};
      try {
        kv = JSON.parse(await readBody(req)) as Record<string, string>;
      } catch {
        return json(res, 400, { error: 'invalid JSON body' });
      }
      writeEnvKeys(ctx.baseDir, kv);
      return json(res, 200, readEnvStatus(ctx.baseDir));
    }
    if (method === 'POST' && url === '/api/sources/discover') {
      let body: { url?: string } = {};
      try {
        body = JSON.parse(await readBody(req)) as { url?: string };
      } catch {
        return json(res, 400, { error: 'invalid JSON body' });
      }
      if (!body.url?.trim()) return json(res, 400, { error: 'paste a Jira issue or Confluence page URL' });
      const client = ctx.discoverClient ?? atlassianDiscoverClient(ctx.baseDir);
      const items = await discover(body.url, client);
      return json(res, 200, { items });
    }
    if (method === 'POST' && url === '/api/pull') {
      let body: { items?: PullItem[]; outDir?: string } = {};
      try {
        body = JSON.parse(await readBody(req)) as { items?: PullItem[]; outDir?: string };
      } catch {
        return json(res, 400, { error: 'invalid JSON body' });
      }
      if (!Array.isArray(body.items) || body.items.length === 0) return json(res, 400, { error: 'select at least one item to pull' });
      const client = ctx.discoverClient ?? atlassianDiscoverClient(ctx.baseDir);
      const outRel = body.outDir ?? '.acp/requirements';
      const result = await pullSelected(body.items, client, join(ctx.baseDir, outRel));
      return json(res, 200, { ...result, outDir: outRel });
    }
    if (method === 'POST' && url === '/api/design') {
      let body: { feature?: string; dbChanges?: boolean } = {};
      try {
        body = JSON.parse(await readBody(req)) as { feature?: string; dbChanges?: boolean };
      } catch {
        return json(res, 400, { error: 'invalid JSON body' });
      }
      if (!body.feature?.trim()) return json(res, 400, { error: 'name the feature first' });
      const chat = ctx.chat ?? defaultChat(aiConfigFromEnv(readEnvValues(ctx.baseDir)));
      const result = await runWizard(configFor(ctx.baseDir), ctx.baseDir, { feature: body.feature, source: 'none', dbChanges: !!body.dbChanges, chat });
      return json(res, 200, { pack: result.pack, html: rel(ctx.baseDir, result.htmlPath), md: rel(ctx.baseDir, result.mdPath) });
    }
    if (method === 'POST' && url === '/api/sync') {
      let body: { apply?: boolean; direction?: 'both' | 'push' | 'pull'; binding?: string } = {};
      try {
        body = JSON.parse(await readBody(req)) as typeof body;
      } catch {
        return json(res, 400, { error: 'invalid JSON body' });
      }
      const config = configFor(ctx.baseDir);
      if (!config.sync?.bindings?.length) {
        return json(res, 200, { configured: false, message: 'No sync bindings configured. Add a `sync` block to acp-trace.json (see docs/SYNC.md).' });
      }
      const results = await runSync(config, ctx.baseDir, {
        apply: !!body.apply,
        direction: body.direction,
        binding: body.binding,
        env: readEnvValues(ctx.baseDir),
        ...(ctx.syncAdapters ? { adapters: ctx.syncAdapters } : {}),
      });
      return json(res, 200, { configured: true, applied: !!body.apply, results });
    }
    if (url.startsWith('/api/')) return json(res, 404, { error: `no endpoint ${method} ${url}` });
    return send(res, 404, 'Not found', 'text/plain');
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

export interface StartWebOptions {
  baseDir: string;
  port?: number; // 0 = ephemeral (tests)
  host?: string; // default 127.0.0.1 (loopback only)
  discoverClient?: DiscoverClient; // tests
  chat?: ChatFn; // tests
  syncAdapters?: Record<string, SyncAdapter>; // tests
}

export interface RunningWeb {
  url: string;
  port: number;
  server: Server;
  close: () => Promise<void>;
}

/** Start the web-wizard server. Resolves once it's listening, with the actual URL + a close(). */
export function startWebServer(opts: StartWebOptions): Promise<RunningWeb> {
  const host = opts.host ?? '127.0.0.1';
  const ctx: WebServerContext = {
    baseDir: opts.baseDir,
    ...(opts.discoverClient ? { discoverClient: opts.discoverClient } : {}),
    ...(opts.chat ? { chat: opts.chat } : {}),
    ...(opts.syncAdapters ? { syncAdapters: opts.syncAdapters } : {}),
  };
  const server = createServer((req, res) => {
    void handleRequest(req, res, ctx);
  });
  return new Promise((resolvePromise, reject) => {
    server.on('error', reject);
    server.listen(opts.port ?? 8799, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 8799);
      resolvePromise({
        url: `http://${host}:${port}`,
        port,
        server,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
