// Phase 2 step 7: runner — gather spec files + run cases with shared setup, against an in-process server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSpecs, gatherSpecFiles } from '../dist/core/trace/acceptance/runner.js';
import { normalizeSpec } from '../dist/core/trace/acceptance/model.js';

function buildServer() {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'T-1' }));
      } else if (req.url === '/me') {
        res.writeHead(req.headers.authorization === 'Bearer T-1' ? 200 : 403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 1 }));
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

const clock = () => {
  let t = 0;
  return () => (t += 5);
};

test('runSpecs: passing + failing cases tallied', async () => {
  await withServer(async (baseUrl) => {
    const specs = [
      normalizeSpec({ req: 'P-1', cases: [{ name: 'health', steps: [{ GET: '/health', expect: { status: 200 } }] }] }, 's'),
      normalizeSpec({ req: 'P-2', cases: [{ name: 'missing', steps: [{ GET: '/nope', expect: { status: 200 } }] }] }, 's'),
    ];
    const result = await runSpecs(specs, { baseUrl, now: clock() });
    assert.equal(result.total, 2);
    assert.equal(result.passed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.cases.find((c) => c.req === 'P-1').ok, true);
    assert.match(result.cases.find((c) => c.req === 'P-2').failure, /status: expected 200, got 404/);
  });
});

test('runSpecs: setup captures a token shared by all cases', async () => {
  await withServer(async (baseUrl) => {
    const setup = { name: 'login', steps: [{ POST: '/login', expect: { status: 200 }, capture: { tok: '$.token' } }] };
    const specs = [
      normalizeSpec(
        { req: 'P-1', cases: [{ name: 'me', steps: [{ GET: '/me', headers: { Authorization: 'Bearer {{tok}}' }, expect: { status: 200 } }] }] },
        's',
      ),
    ];
    // normalizeSpec also normalises the setup case's steps via the same path:
    const setupCase = normalizeSpec({ req: 'setup', cases: [setup] }, 's').cases[0];
    const result = await runSpecs(specs, { baseUrl, setup: setupCase, now: clock() });
    assert.equal(result.passed, 1, JSON.stringify(result.cases));
  });
});

test('runSpecs: setup failure fails all cases without running them', async () => {
  await withServer(async (baseUrl) => {
    const badSetup = normalizeSpec({ req: 's', cases: [{ name: 'bad', steps: [{ GET: '/nope', expect: { status: 200 } }] }] }, 's').cases[0];
    const specs = [normalizeSpec({ req: 'P-1', cases: [{ name: 'x', steps: [{ GET: '/health', expect: { status: 200 } }] }] }, 's')];
    const result = await runSpecs(specs, { baseUrl, setup: badSetup, now: clock() });
    assert.equal(result.failed, 1);
    assert.match(result.cases[0].failure, /setup failed/);
    assert.equal(result.cases[0].steps.length, 0);
  });
});

test('runSpecs: case stops at first failing step', async () => {
  await withServer(async (baseUrl) => {
    const specs = [
      normalizeSpec(
        { req: 'P-1', cases: [{ name: 'chain', steps: [{ GET: '/me', expect: { status: 200 } }, { GET: '/health', expect: { status: 200 } }] }] },
        's',
      ),
    ];
    const result = await runSpecs(specs, { baseUrl, now: clock() });
    assert.equal(result.cases[0].ok, false);
    assert.equal(result.cases[0].steps.length, 1); // second step never ran
  });
});

test('gatherSpecFiles: reads JSON + YAML + md specs by glob', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-specs-'));
  mkdirSync(join(dir, '.acp', 'tests'), { recursive: true });
  writeFileSync(join(dir, '.acp/tests/A.acp.json'), '{"req":"A-1","steps":[{"GET":"/a","expect":{"status":200}}]}');
  writeFileSync(join(dir, '.acp/tests/B.acp.yml'), 'req: B-1\nsteps:\n  - GET: /b\n    expect: { status: 200 }');
  writeFileSync(join(dir, '.acp/tests/C.acp.md'), 'req: C-1\n| method | path | status |\n|--|--|--|\n| GET | /c | 200 |');
  const specs = gatherSpecFiles(dir, ['.acp/tests/**/*.acp.json', '.acp/tests/**/*.acp.yml', '.acp/tests/**/*.acp.md']);
  assert.deepEqual(specs.map((s) => s.req).sort(), ['A-1', 'B-1', 'C-1']);
});
