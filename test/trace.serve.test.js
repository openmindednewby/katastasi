// RTM portal: page injection (pure) + a live server integration test (start → fetch → POST → close).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { portalPage, serve } from '../dist/core/trace/serve.js';
import { computeReport } from '../dist/core/trace/computeState.js';

function demoReport() {
  return computeReport({
    requirements: [{ key: 'PROJ-1', title: 'Login', declaredStatus: 'Done', declaredComplete: true, source: 'markdown' }],
    refs: [{ key: 'PROJ-1', file: 'a.spec.ts', title: 'login', tech: 'playwright', via: 'tag' }],
    ingested: { byKey: new Map([['PROJ-1', { passed: 1, failed: 0, skipped: 0, lastRun: null }]]), occurrences: [] },
    git: { sha: null, shortSha: null, branch: null, dirty: false, committedAt: null },
    generatedAt: '2026-06-19T00:00:00Z',
    project: 'P',
  });
}

test('portalPage injects the Run button, suites checkbox, and history', () => {
  const html = portalPage(demoReport(), ['2026-06-19T00-00-00-000Z_abc.json']);
  assert.match(html, /id="rtm-run"/);
  assert.match(html, /id="rtm-suites"/);
  assert.match(html, /History \(1\)/);
  assert.match(html, /2026-06-19T00-00-00-000Z_abc\.json/);
  assert.match(html, /^<!doctype html>/);
});

test('portalPage read-only: no Run button, shows the git-backed badge', () => {
  const html = portalPage(demoReport(), [], { readOnly: true });
  assert.doesNotMatch(html, /id="rtm-run"/);
  assert.doesNotMatch(html, /id="rtm-suites"/);
  assert.match(html, /read-only · git-backed/);
});

test('portalPage: trend renders a sparkline + history links to permalinks', () => {
  const html = portalPage(demoReport(), ['2026-a.json', '2026-b.json'], { trend: [50, 75, 90] });
  assert.match(html, /<polyline/);
  assert.match(html, /90%/);
  assert.match(html, /href="\/runs\/2026-a\.json"/);
});

test('serve: /runs/<file> serves a historical snapshot; path traversal 404s', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-perma-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'runs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [x] PROJ-1 Login');
  const snapshot = {
    generatedAt: '2026-06-19T00:00:00Z', git: { sha: 'a', shortSha: 'abc12345', branch: 'main', dirty: false, committedAt: null },
    requirements: [{ key: 'PROJ-1', title: 'Login', declaredStatus: 'Done', declaredComplete: true, source: 'markdown', state: 'verified', drift: false, stale: false, tests: [], result: { passed: 1, failed: 0, skipped: 0, lastRun: null } }],
    orphanTests: [], stats: { total: 1, verified: 1, failing: 0, unverified: 0, specified: 0, drift: 0, orphanTests: 0, stale: 0, regressions: 0, coveragePct: 100 },
  };
  writeFileSync(join(root, 'runs', '2026-06-19T00-00-00-000Z_abc12345.json'), JSON.stringify(snapshot));
  writeFileSync(join(root, 'acp-trace.json'), JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }], history: { dir: 'runs' } }));

  const port = 8916;
  const server = await serve(join(root, 'acp-trace.json'), root, { port });
  try {
    const base = `http://127.0.0.1:${port}`;
    const ok = await fetch(`${base}/runs/2026-06-19T00-00-00-000Z_abc12345.json`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /PROJ-1/);
    assert.equal((await fetch(`${base}/runs/nope.json`)).status, 404);
    assert.equal((await fetch(`${base}/runs/..%2f..%2facp-trace.json`)).status, 404); // traversal blocked
  } finally {
    server.closeAllConnections?.();
    await new Promise((ok) => server.close(ok));
  }
});

test('serve: live server answers /api/report, /api/runs, and POST /run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-serve-'));
  mkdirSync(join(root, 'e2e', 'results'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  writeFileSync(join(root, 'e2e', 'login.spec.ts'), `test('login @PROJ-1', ...)`);
  writeFileSync(
    join(root, 'e2e', 'results', 'junit.xml'),
    `<testsuites><testsuite><testcase name="login @PROJ-1"></testcase></testsuite></testsuites>`,
  );
  writeFileSync(
    join(root, 'acp-trace.json'),
    JSON.stringify({
      scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }],
        tests: [{ tech: 'playwright', globs: ['e2e/**/*.spec.ts'], results: ['e2e/results/*.xml'] }] }],
      history: { dir: 'runs' },
    }),
  );

  const port = 8911;
  const server = await serve(join(root, 'acp-trace.json'), root, { port });
  try {
    const base = `http://127.0.0.1:${port}`;
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /id="rtm-run"/);

    const report = await (await fetch(`${base}/api/report`)).json();
    assert.equal(report.requirements[0].state, 'verified');

    const run = await (await fetch(`${base}/run`, { method: 'POST' })).json();
    assert.equal(run.ok, true);
    assert.equal(typeof run.stats.coveragePct, 'number');

    const runs = await (await fetch(`${base}/api/runs`)).json();
    assert.ok(runs.runs.length >= 1);

    assert.equal((await fetch(`${base}/nope`)).status, 404);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});

async function readUntil(reader, needle, ms) {
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 200)),
    ]);
    if (chunk.done) break;
    if (chunk.value) buf += dec.decode(chunk.value, { stream: true });
    if (buf.includes(needle)) return true;
  }
  return buf.includes(needle);
}

test('serve: /events pushes "changed" when a run changes the report (auto-refresh)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-sse-'));
  mkdirSync(join(root, 'e2e', 'results'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  writeFileSync(join(root, 'e2e', 'login.spec.ts'), `test('login @PROJ-1', ...)`);
  const junit = join(root, 'e2e', 'results', 'junit.xml');
  writeFileSync(junit, `<testsuites><testsuite><testcase name="login @PROJ-1"></testcase></testsuite></testsuites>`);
  writeFileSync(
    join(root, 'acp-trace.json'),
    JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [{ tech: 'playwright', globs: ['e2e/**/*.spec.ts'], results: ['e2e/results/*.xml'] }] }] }),
  );

  const port = 8913;
  const server = await serve(join(root, 'acp-trace.json'), root, { port });
  let reader;
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.match(await (await fetch(`${base}/`)).text(), /EventSource\('\/events'\)/); // page subscribes
    const stream = await fetch(`${base}/events`);
    reader = stream.body.getReader();
    writeFileSync(junit, `<testsuites><testsuite><testcase name="login @PROJ-1"><failure/></testcase></testsuite></testsuites>`);
    await fetch(`${base}/run`, { method: 'POST' }); // verified → failing → signature changes
    assert.equal(await readUntil(reader, 'changed', 3000), true);
  } finally {
    if (reader) await reader.cancel().catch(() => {});
    server.closeAllConnections?.();
    await new Promise((ok) => server.close(ok));
  }
});

test('serve --token: protects every route; token via header/query authorizes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-auth-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [x] PROJ-1 Login');
  writeFileSync(join(root, 'acp-trace.json'), JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }] }));

  const port = 8914;
  const server = await serve(join(root, 'acp-trace.json'), root, { port, token: 's3cret' });
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/report`)).status, 401); // no token
    assert.equal((await fetch(`${base}/run`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/report`, { headers: { Authorization: 'Bearer s3cret' } })).status, 200);
    assert.equal((await fetch(`${base}/api/report?token=s3cret`)).status, 200);
    // GET / with the token sets the cookie for subsequent same-origin calls
    const home = await fetch(`${base}/?token=s3cret`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('set-cookie') || '', /rtm_token=s3cret/);
  } finally {
    server.closeAllConnections?.();
    await new Promise((ok) => server.close(ok));
  }
});

test('serve --token --public: read-only GETs open, mutations still protected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-pub-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [x] PROJ-1 Login');
  writeFileSync(join(root, 'acp-trace.json'), JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }] }));

  const port = 8915;
  const server = await serve(join(root, 'acp-trace.json'), root, { port, token: 's3cret', public: true });
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/report`)).status, 200); // public view allowed
    assert.equal((await fetch(`${base}/run`, { method: 'POST' })).status, 401); // mutation still needs token
  } finally {
    server.closeAllConnections?.();
    await new Promise((ok) => server.close(ok));
  }
});

test('serve --read-only: shows committed run, refuses POST /run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-ro-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'runs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [x] PROJ-1 Login');
  // Seed a committed run snapshot for the dashboard to display.
  const snapshot = {
    generatedAt: '2026-06-19T00:00:00Z', git: { sha: 'a', shortSha: 'abc12345', branch: 'main', dirty: false, committedAt: null },
    requirements: [{ key: 'PROJ-1', title: 'Login', declaredStatus: 'Done', declaredComplete: true, source: 'markdown', state: 'verified', drift: false, tests: [], result: { passed: 1, failed: 0, skipped: 0, lastRun: null } }],
    orphanTests: [], stats: { total: 1, verified: 1, failing: 0, unverified: 0, specified: 0, drift: 0, orphanTests: 0, regressions: 0, coveragePct: 100 },
  };
  writeFileSync(join(root, 'runs', '2026-06-19T00-00-00-000Z_abc12345.json'), JSON.stringify(snapshot));
  writeFileSync(
    join(root, 'acp-trace.json'),
    JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }], history: { dir: 'runs' } }),
  );

  const port = 8912;
  const server = await serve(join(root, 'acp-trace.json'), root, { port, readOnly: true });
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.match(await (await fetch(`${base}/`)).text(), /read-only · git-backed/);
    const report = await (await fetch(`${base}/api/report`)).json();
    assert.equal(report.git.shortSha, 'abc12345'); // the committed snapshot, not a fresh trace
    assert.equal((await fetch(`${base}/run`, { method: 'POST' })).status, 403);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});
