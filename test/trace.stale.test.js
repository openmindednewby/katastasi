// Stale-results guard: a result older than the covering test file (or the commit) is flagged stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markStale } from '../dist/core/trace/stale.js';
import { computeReport } from '../dist/core/trace/computeState.js';

function reportFor(testFile, lastRun, committedAt = null) {
  return computeReport({
    requirements: [{ key: 'PROJ-1', title: 'Login', declaredStatus: null, declaredComplete: false, source: 'markdown' }],
    refs: [{ key: 'PROJ-1', file: testFile, title: 't', tech: 'playwright', via: 'tag' }],
    ingested: { byKey: new Map([['PROJ-1', { passed: 1, failed: 0, skipped: 0, lastRun }]]), occurrences: [] },
    git: { sha: null, shortSha: null, branch: null, dirty: false, committedAt },
    generatedAt: '2026-06-19T00:00:00Z',
  });
}

test('markStale: test file newer than the result → stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-stale-'));
  writeFileSync(join(root, 'login.spec.ts'), 'x');
  // result ran an hour before "now"; the spec file mtime is "now" (newer) → stale
  const lastRun = new Date(Date.now() - 3600_000).toISOString();
  const report = reportFor('login.spec.ts', lastRun);
  markStale(report, root);
  assert.equal(report.requirements[0].stale, true);
  assert.equal(report.stats.stale, 1);
});

test('markStale: test file older than the result → not stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-fresh-'));
  const spec = join(root, 'login.spec.ts');
  writeFileSync(spec, 'x');
  const old = Date.now() / 1000 - 7200; // 2h ago (seconds for utimes)
  utimesSync(spec, old, old);
  const lastRun = new Date(Date.now() - 3600_000).toISOString(); // result 1h ago, newer than the spec
  const report = reportFor('login.spec.ts', lastRun);
  markStale(report, root);
  assert.equal(report.requirements[0].stale, false);
  assert.equal(report.stats.stale, 0);
});

test('markStale: result older than the current commit → stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-commit-'));
  const spec = join(root, 'login.spec.ts');
  writeFileSync(spec, 'x');
  const old = Date.now() / 1000 - 7200;
  utimesSync(spec, old, old); // spec old, so test-mtime path won't trigger
  const lastRun = new Date(Date.now() - 3600_000).toISOString(); // result 1h ago
  const committedAt = new Date(Date.now() - 600_000).toISOString(); // commit 10m ago → newer than result
  const report = reportFor('login.spec.ts', lastRun, committedAt);
  markStale(report, root);
  assert.equal(report.requirements[0].stale, true);
});

test('markStale: no result → never stale', () => {
  const report = computeReport({
    requirements: [{ key: 'PROJ-1', title: 'X', declaredStatus: null, declaredComplete: false, source: 'markdown' }],
    refs: [{ key: 'PROJ-1', file: 'a.spec.ts', title: 't', tech: 'playwright', via: 'tag' }],
    ingested: { byKey: new Map(), occurrences: [] },
    git: { sha: null, shortSha: null, branch: null, dirty: false, committedAt: '2030-01-01T00:00:00Z' },
    generatedAt: '2026-06-19T00:00:00Z',
  });
  markStale(report, '/tmp');
  assert.equal(report.requirements[0].stale, false); // unverified, nothing to be stale
});
