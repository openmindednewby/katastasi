// Web wizard slice 3: pull selected items → markdown + a requirement-parseable index; /api/pull endpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pullSelected } from '../dist/core/web/pull.js';
import { startWebServer } from '../dist/core/web/server.js';
import { parseMarkdownRequirements } from '../dist/core/trace/requirements/markdown.js';

function fakeClient() {
  return {
    async jiraIssue(key) {
      if (key === 'BAD-1') throw new Error('403');
      return { key, title: `Issue ${key}`, body: `Body of ${key}`, url: `https://x/browse/${key}` };
    },
    async jiraChildren() { return []; },
    async confluencePage(id) { return { id, title: `Page ${id}`, body: `Page body ${id}`, url: `https://x/pages/${id}` }; },
    async confluenceChildren() { return []; },
  };
}

test('pullSelected: writes per-item files + an index, skips broken items', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-pull-'));
  const res = await pullSelected(
    [{ type: 'jira', id: 'PROJ-1' }, { type: 'confluence', id: '500' }, { type: 'jira', id: 'BAD-1' }],
    fakeClient(),
    dir,
  );
  assert.deepEqual(res.written.sort(), ['500.md', 'PROJ-1.md']);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].id, 'BAD-1');
  assert.match(readFileSync(join(dir, 'PROJ-1.md'), 'utf8'), /# PROJ-1 — Issue PROJ-1[\s\S]*Body of PROJ-1/);
  assert.ok(existsSync(join(dir, 'index.md')));
});

test('pullSelected: the index is parseable as requirements (jira keys) + lists pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-pull-idx-'));
  await pullSelected([{ type: 'jira', id: 'PROJ-1' }, { type: 'jira', id: 'PROJ-2' }, { type: 'confluence', id: '500' }], fakeClient(), dir);
  const index = readFileSync(join(dir, 'index.md'), 'utf8');
  const reqs = parseMarkdownRequirements(index);
  assert.deepEqual(reqs.map((r) => r.key).sort(), ['PROJ-1', 'PROJ-2']); // jira items become requirements
  assert.match(index, /## Reference docs[\s\S]*page 500/); // confluence page listed as a doc
});

test('endpoint /api/pull: pulls into .acp/requirements via injected client', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-pull-api-'));
  const s = await startWebServer({ baseDir: dir, port: 0, discoverClient: fakeClient() });
  try {
    let res = await fetch(s.url + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ type: 'jira', id: 'PROJ-1' }] }) });
    const d = await res.json();
    assert.equal(res.status, 200);
    assert.equal(d.outDir, '.acp/requirements');
    assert.ok(existsSync(join(dir, '.acp', 'requirements', 'PROJ-1.md')));
    // empty selection → 400
    res = await fetch(s.url + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] }) });
    assert.equal(res.status, 400);
  } finally {
    await s.close();
  }
});
