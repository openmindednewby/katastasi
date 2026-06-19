// RTM sinks: starter config scaffolding, file outputs, and idempotent roadmap section folding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { starterConfig, parseTraceConfig } from '../dist/core/trace/config.js';
import { writeOutputs, updateRoadmapSection, reportSection } from '../dist/core/trace/publish.js';
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

test('starterConfig produces a valid, parseable config', () => {
  const cfg = parseTraceConfig(starterConfig({ project: 'X', jiraEpic: 'PROJ-100' }));
  assert.equal(cfg.project, 'X');
  assert.equal(cfg.scopes[0].requirements[0].type, 'jira-epic');
  assert.equal(cfg.output.markdown, 'docs/RTM.md');
});

test('writeOutputs writes the configured formats', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-out-'));
  mkdirSync(join(root, 'docs'));
  const written = writeOutputs(demoReport(), { markdown: 'docs/RTM.md', html: 'docs/rtm.html', json: 'docs/rtm.json' }, root);
  assert.deepEqual(written.sort(), ['docs/RTM.md', 'docs/rtm.html', 'docs/rtm.json']);
  assert.match(readFileSync(join(root, 'docs/RTM.md'), 'utf8'), /Requirements Traceability/);
  assert.match(readFileSync(join(root, 'docs/rtm.html'), 'utf8'), /<!doctype html>/);
  assert.ok(existsSync(join(root, 'docs/rtm.json')));
});

test('reportSection demotes the H1 so it nests under an existing doc', () => {
  assert.match(reportSection(demoReport()), /^## Requirements Traceability/);
});

test('updateRoadmapSection folds in and replaces idempotently', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-road-'));
  const path = join(root, 'roadmap.md');
  writeFileSync(path, '# Roadmap\n\nIntro text.\n');
  updateRoadmapSection(demoReport(), { path: 'roadmap.md', sectionId: 'rtm' }, root);
  let doc = readFileSync(path, 'utf8');
  assert.match(doc, /# Roadmap/); // original preserved
  assert.match(doc, /acp:trace:start rtm/);
  updateRoadmapSection(demoReport(), { path: 'roadmap.md', sectionId: 'rtm' }, root);
  doc = readFileSync(path, 'utf8');
  assert.equal((doc.match(/acp:trace:start rtm/g) || []).length, 1); // still one section
});
