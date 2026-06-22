// Phase 2 step 9: orchestrator (config → gather files+inline → run → JUnit) + CLI smoke + inline-from-doc.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAcceptance } from '../dist/core/trace/acceptance/orchestrate.js';
import { loadTraceConfig } from '../dist/core/trace/config.js';
import { parseJUnit } from '../dist/core/trace/results.js';
import { parseInlineFromDoc } from '../dist/core/trace/acceptance/parse/inline.js';

function buildServer() {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'T-1' }));
      } else if (req.url === '/me') {
        res.writeHead(req.headers.authorization === 'Bearer T-1' ? 200 : 403);
        res.end('me');
      } else if (req.url === '/health') {
        res.writeHead(200);
        res.end('ok');
      } else {
        res.writeHead(404);
        res.end('no');
      }
    });
  });
}

async function withServer(run) {
  const server = buildServer();
  server.listen(0);
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function scaffold(baseUrl) {
  const dir = mkdtempSync(join(tmpdir(), 'acp-orch-'));
  mkdirSync(join(dir, '.acp', 'tests'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(
    join(dir, '.acp/tests/login.acp.json'),
    JSON.stringify({ req: 'PROJ-1', cases: [{ name: 'me', steps: [{ GET: '/me', headers: { Authorization: 'Bearer {{tok}}' }, expect: { status: 200 } }] }] }),
  );
  writeFileSync(join(dir, 'docs/reqs.md'), '## PROJ-2 Health\n\n```acp-test\nGET /health -> 200\n```\n');
  writeFileSync(
    join(dir, 'acp-trace.json'),
    JSON.stringify({
      scopes: [
        {
          requirements: [{ type: 'markdown', path: 'docs/reqs.md' }],
          tests: [{ tech: 'acceptance', globs: ['.acp/tests/**/*.acp.json'], results: ['.acp/results/acceptance.xml'] }],
        },
      ],
      runner: { baseUrl, setup: { name: 'login', steps: [{ POST: '/login', expect: { status: 200 }, capture: { tok: '$.token' } }] } },
    }),
  );
  return dir;
}

test('parseInlineFromDoc: block attributed to nearest preceding requirement heading', () => {
  const md = '## PROJ-7 Thing\n\n```acp-test\nGET /a -> 200\n```\n\n## PROJ-8 Other\n\n```acp-test\nGET /b -> 200\n```';
  const specs = parseInlineFromDoc(md);
  assert.deepEqual(specs.map((s) => s.req).sort(), ['PROJ-7', 'PROJ-8']);
});

test('runAcceptance: spec file + inline doc, setup token shared, JUnit written', async () => {
  await withServer(async (baseUrl) => {
    const dir = scaffold(baseUrl);
    const config = loadTraceConfig(join(dir, 'acp-trace.json'));
    const summary = await runAcceptance(dir, config, {});
    assert.equal(summary.total, 2, JSON.stringify(summary.cases));
    assert.equal(summary.passed, 2, JSON.stringify(summary.cases));

    const xml = readFileSync(summary.outPath, 'utf8');
    const parsed = parseJUnit(xml);
    assert.equal(parsed.length, 2);
    assert.ok(parsed.every((p) => p.status === 'passed'));
    assert.ok(parsed.some((p) => p.name.includes('PROJ-1')));
    assert.ok(parsed.some((p) => p.name.includes('PROJ-2')));
  });
});

test('runAcceptance: --req filter narrows to one requirement', async () => {
  await withServer(async (baseUrl) => {
    const dir = scaffold(baseUrl);
    const config = loadTraceConfig(join(dir, 'acp-trace.json'));
    const summary = await runAcceptance(dir, config, { req: 'PROJ-2' });
    assert.equal(summary.total, 1);
    assert.equal(summary.cases[0].req, 'PROJ-2');
  });
});

test('CLI: `katastasi test` runs and exits 0 on all-pass', async () => {
  await withServer(async (baseUrl) => {
    const dir = scaffold(baseUrl);
    const { stdout, code } = await new Promise((resolvePromise) => {
      execFile('node', ['dist/cli/index.js', 'test', '--config', join(dir, 'acp-trace.json')], (err, stdout) => {
        resolvePromise({ stdout, code: err ? err.code : 0 });
      });
    });
    assert.equal(code, 0, stdout);
    assert.match(stdout, /2\/2 passed/);
  });
});
