// Phase 2 step 5: HTTP executor against an in-process http server (no real network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { executeHttpStep } from '../dist/core/trace/acceptance/httpExecutor.js';
import { normalizeStep } from '../dist/core/trace/acceptance/model.js';

/** A tiny test API: POST /login (echoes a token), GET /me (needs Bearer), GET /health. */
function buildServer() {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url;
      if (req.method === 'POST' && url === '/login') {
        const creds = body ? JSON.parse(body) : {};
        if (creds.pass === 'good') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ token: 'T-123', user: { id: 7 } }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad creds' }));
        }
      } else if (req.method === 'GET' && url === '/me') {
        if (req.headers.authorization === 'Bearer T-123') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 7, name: 'demetris' }));
        } else {
          res.writeHead(403);
          res.end('forbidden');
        }
      } else if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
  });
}

async function withServer(run) {
  const server = buildServer();
  server.listen(0);
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('http: bad credentials → 401 passes', async () => {
  await withServer(async (baseUrl) => {
    const step = normalizeStep({ POST: '/login', body: { pass: 'bad' }, expect: { status: 401, json: { '$.error': 'exists' } } }, 'x');
    const r = await executeHttpStep(step, { baseUrl, vars: {} });
    assert.equal(r.ok, true, r.failures.join('; '));
    assert.equal(r.status, 401);
  });
});

test('http: capture token then reuse via {{tok}}', async () => {
  await withServer(async (baseUrl) => {
    const vars = {};
    const login = normalizeStep(
      { POST: '/login', body: { pass: 'good' }, expect: { status: 200 }, capture: { tok: '$.token', uid: '$.user.id' } },
      'x',
    );
    const r1 = await executeHttpStep(login, { baseUrl, vars });
    assert.equal(r1.ok, true, r1.failures.join('; '));
    assert.deepEqual(r1.captured, { tok: 'T-123', uid: 7 });
    assert.equal(vars.tok, 'T-123');

    const me = normalizeStep(
      { GET: '/me', headers: { Authorization: 'Bearer {{tok}}' }, expect: { status: 200, json: { '$.id': 7 } } },
      'x',
    );
    const r2 = await executeHttpStep(me, { baseUrl, vars });
    assert.equal(r2.ok, true, r2.failures.join('; '));
  });
});

test('http: missing auth → assertion failure recorded', async () => {
  await withServer(async (baseUrl) => {
    const me = normalizeStep({ GET: '/me', expect: { status: 200 } }, 'x');
    const r = await executeHttpStep(me, { baseUrl, vars: {} });
    assert.equal(r.ok, false);
    assert.match(r.failures[0], /status: expected 200, got 403/);
  });
});

test('http: text body + bodyContains + header assert', async () => {
  await withServer(async (baseUrl) => {
    const step = normalizeStep(
      { GET: '/health', expect: { status: 200, bodyContains: ['ok'], headers: { 'Content-Type': 'text/plain' } } },
      'x',
    );
    const r = await executeHttpStep(step, { baseUrl, vars: {} });
    assert.equal(r.ok, true, r.failures.join('; '));
  });
});

test('http: env interpolation into header', async () => {
  await withServer(async (baseUrl) => {
    const me = normalizeStep({ GET: '/me', headers: { Authorization: 'Bearer {{env.TOK}}' }, expect: { status: 200 } }, 'x');
    const r = await executeHttpStep(me, { baseUrl, vars: {}, env: { TOK: 'T-123' } });
    assert.equal(r.ok, true, r.failures.join('; '));
  });
});

test('http: transport error → error result, not a throw', async () => {
  const step = normalizeStep({ GET: '/x', expect: { status: 200 } }, 'x');
  const r = await executeHttpStep(step, { baseUrl: 'http://127.0.0.1:1', vars: {} });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
