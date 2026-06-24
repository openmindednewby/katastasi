// Web wizard slice 1: .env read/write + the /api/env endpoints over a real (ephemeral) HTTP server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, readEnvStatus, writeEnvKeys } from '../dist/core/web/envFile.js';
import { startWebServer } from '../dist/core/web/server.js';

// ── envFile ───────────────────────────────────────────────────────────────────────────────

test('parseEnv: keys, quotes, comments', () => {
  const m = parseEnv('# c\nJIRA_EMAIL=you@x.com\nJIRA_API_TOKEN="abc"\n\nFOO = bar');
  assert.equal(m.JIRA_EMAIL, 'you@x.com');
  assert.equal(m.JIRA_API_TOKEN, 'abc');
  assert.equal(m.FOO, 'bar');
});

test('readEnvStatus: a group is set only when all its keys are present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-env-'));
  writeFileSync(join(dir, '.env'), 'GITHUB_TOKEN=ghp_x\nJIRA_BASE_URL=https://x\nJIRA_EMAIL=e\n'); // jira missing token
  const status = readEnvStatus(dir, {});
  assert.equal(status.github, true);
  assert.equal(status.jira, false); // token missing
  assert.equal(status.confluence, false);
});

test('writeEnvKeys: upserts + preserves other lines, ignores empties', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-write-'));
  writeFileSync(join(dir, '.env'), 'EXISTING=keep\nJIRA_EMAIL=old\n');
  writeEnvKeys(dir, { JIRA_EMAIL: 'new@x.com', JIRA_API_TOKEN: 'tok', BLANK: '  ' });
  const text = readFileSync(join(dir, '.env'), 'utf8');
  assert.match(text, /EXISTING=keep/); // preserved
  assert.match(text, /JIRA_EMAIL=new@x\.com/); // updated
  assert.match(text, /JIRA_API_TOKEN=tok/); // added
  assert.doesNotMatch(text, /BLANK/); // empty ignored
});

// ── server endpoints ────────────────────────────────────────────────────────────────────────

async function withServer(baseDir, run) {
  const s = await startWebServer({ baseDir, port: 0 });
  try {
    await run(s.url);
  } finally {
    await s.close();
  }
}

test('GET / serves the wizard page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-page-'));
  await withServer(dir, async (url) => {
    const res = await fetch(url + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /feature onboarding[\s\S]*Connect/);
  });
});

test('GET /api/env reports status; POST writes .env (token never echoed)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-api-'));
  await withServer(dir, async (url) => {
    let res = await fetch(url + '/api/env');
    assert.deepEqual(await res.json(), { jira: false, confluence: false, github: false });

    res = await fetch(url + '/api/env', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ GITHUB_TOKEN: 'ghp_secret' }) });
    const status = await res.json();
    assert.equal(status.github, true);
    assert.equal(JSON.stringify(status).includes('ghp_secret'), false); // status is booleans only
    assert.match(readFileSync(join(dir, '.env'), 'utf8'), /GITHUB_TOKEN=ghp_secret/); // but written to disk
  });
});

test('POST /api/env with bad JSON → 400; unknown /api → 404', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-err-'));
  await withServer(dir, async (url) => {
    assert.equal((await fetch(url + '/api/env', { method: 'POST', body: '{bad' })).status, 400);
    assert.equal((await fetch(url + '/api/nope')).status, 404);
  });
});
