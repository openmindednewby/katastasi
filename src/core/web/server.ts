/**
 * The web-wizard local server — plain `node:http`, no framework, loopback-bound by default (it handles a
 * dev's credentials, so it must not be exposed). Serves the self-contained SPA and the `/api/*` endpoints
 * that call the existing core. Slice 1 wires Connect (`/api/env`); later slices add discovery / pull /
 * analyze / sync on the same router. `handleRequest` is exported so endpoints are unit-tested with no socket.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readEnvStatus, writeEnvKeys } from './envFile.js';
import { renderWizardPage } from './page.js';

export interface WebServerContext {
  baseDir: string;
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
  const ctx: WebServerContext = { baseDir: opts.baseDir };
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
