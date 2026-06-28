// Shared results backend: POST /ingest stores a report; the dashboard aggregates projects (with auth).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveCollector } from '../dist/core/trace/collector.js';
import { computeReport } from '../dist/core/trace/computeState.js';
import { postReport } from '../dist/core/trace/publish.js';

function demoReport(project) {
  return computeReport({
    requirements: [{ key: 'PROJ-1', title: 'Login', declaredStatus: 'Done', declaredComplete: true, source: 'markdown' }],
    refs: [{ key: 'PROJ-1', file: 'a.spec.ts', title: 'login', tech: 'playwright', via: 'tag' }],
    ingested: { byKey: new Map([['PROJ-1', { passed: 1, failed: 0, skipped: 0, lastRun: null }]]), occurrences: [] },
    git: { sha: null, shortSha: 'abc1234', branch: 'main', dirty: false, committedAt: null },
    generatedAt: '2026-06-19T00:00:00.000Z', project,
  });
}

test('collector: ingest stores per project; views aggregate (token-gated)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtm-coll-'));
  const port = 8930;
  const server = await serveCollector({ port, dir, token: 's3cret' });
  try {
    const base = `http://127.0.0.1:${port}`;

    // ingest needs the token
    assert.equal((await fetch(`${base}/ingest`, { method: 'POST', body: '{}' })).status, 401);

    // post a real report (reuses the same sink the CLI/portal use)
    const ok = await postReport(demoReport('Acme App'), { url: `${base}/ingest`, headers: { Authorization: 'Bearer s3cret' } });
    assert.equal(ok, true);
    // a second project
    await postReport(demoReport('Beta Service'), { url: `${base}/ingest`, headers: { Authorization: 'Bearer s3cret' } });

    // rejects non-reports
    assert.equal((await fetch(`${base}/ingest`, { method: 'POST', headers: { Authorization: 'Bearer s3cret' }, body: JSON.stringify({ nope: 1 }) })).status, 400);

    // aggregate index lists both projects
    const index = await (await fetch(`${base}/?token=s3cret`)).text();
    assert.match(index, /Acme App/);
    assert.match(index, /Beta Service/);

    // per-project dashboard renders the report
    const proj = await (await fetch(`${base}/p/acme-app?token=s3cret`)).text();
    assert.match(proj, /PROJ-1/);
    assert.match(proj, /← all projects/);

    const projects = await (await fetch(`${base}/api/projects?token=s3cret`)).json();
    assert.deepEqual(projects.projects.sort(), ['acme-app', 'beta-service']);

    // viewing without the token is blocked (not --public)
    assert.equal((await fetch(`${base}/`)).status, 401);

    // a tokened visit issues an http-only cookie so navigation stays authed
    const tokened = await fetch(`${base}/?token=s3cret`);
    assert.equal(tokened.status, 200);
    const setCookie = tokened.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /rtm_token=s3cret/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);

    // subsequent navigation with ONLY the cookie (no ?token=) stays authed
    const viaCookie = await fetch(`${base}/p/acme-app`, { headers: { cookie: 'rtm_token=s3cret' } });
    assert.equal(viaCookie.status, 200);
    assert.match(await viaCookie.text(), /PROJ-1/);

    // a wrong cookie is still rejected
    assert.equal((await fetch(`${base}/p/acme-app`, { headers: { cookie: 'rtm_token=nope' } })).status, 401);
  } finally {
    server.closeAllConnections?.();
    await new Promise((ok) => server.close(ok));
  }
});
