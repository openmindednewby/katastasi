// RTM providers, config, and an offline end-to-end runTrace (markdown spec + scanned tests + JUnit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseMarkdownRequirements } from '../dist/core/trace/requirements/markdown.js';
import { parseRoadmapHtml } from '../dist/core/trace/requirements/roadmapHtml.js';
import { jiraIssueToRequirement } from '../dist/core/trace/requirements/jiraEpic.js';
import { confluenceStorageToRequirements } from '../dist/core/trace/requirements/confluencePage.js';
import { parseTraceConfig, traceConfigSchema } from '../dist/core/trace/config.js';
import { autodetect } from '../dist/core/trace/autodetect.js';
import { runTrace, renderAll } from '../dist/core/trace/index.js';

/* ── markdown requirements ── */

test('parseMarkdownRequirements: table shape', () => {
  const md = `| Key | Title | Status |\n|-----|-------|--------|\n| PROJ-1 | Login flow | Done |\n| PROJ-2 | Logout | To Do |`;
  const reqs = parseMarkdownRequirements(md);
  assert.equal(reqs.length, 2);
  assert.equal(reqs[0].key, 'PROJ-1');
  assert.equal(reqs[0].title, 'Login flow');
  assert.equal(reqs[0].declaredComplete, true);
  assert.equal(reqs[1].declaredComplete, false);
});

test('parseMarkdownRequirements: checklist shape', () => {
  const md = `- [x] PROJ-1 Login\n- [ ] PROJ-2 Logout\n- PROJ-3: Reset (In Progress)`;
  const reqs = parseMarkdownRequirements(md);
  assert.deepEqual(reqs.map((r) => r.key), ['PROJ-1', 'PROJ-2', 'PROJ-3']);
  assert.equal(reqs[0].title, 'Login');
  assert.equal(reqs[0].declaredComplete, true);
  assert.equal(reqs[2].declaredStatus, 'In Progress');
});

/* ── roadmap html ── */

test('parseRoadmapHtml: structured data-req attributes', () => {
  const html = `<div data-req="PROJ-1" data-title="Login" data-status="Done" data-complete="true"></div>
    <span data-req="PROJ-2" data-title="Logout" data-status="To Do"></span>`;
  const reqs = parseRoadmapHtml(html);
  assert.equal(reqs.length, 2);
  assert.equal(reqs[0].title, 'Login');
  assert.equal(reqs[0].declaredComplete, true);
  assert.equal(reqs[1].declaredComplete, false);
});

test('parseRoadmapHtml: falls back to visible text when unannotated', () => {
  const html = `<ul><li>PROJ-7 Build the thing — done</li><li>PROJ-8 Other thing</li></ul>`;
  const reqs = parseRoadmapHtml(html);
  const keys = reqs.map((r) => r.key);
  assert.ok(keys.includes('PROJ-7'));
  assert.equal(reqs.find((r) => r.key === 'PROJ-7').declaredComplete, true);
});

/* ── jira / confluence mappers (pure, no network) ── */

test('jiraIssueToRequirement maps status to declaredComplete + url', () => {
  const issue = { key: 'PROJ-1', fields: { summary: 'Login', status: { name: 'Done' } } };
  const r = jiraIssueToRequirement(issue, 'https://acme.atlassian.net');
  assert.equal(r.declaredComplete, true);
  assert.equal(r.url, 'https://acme.atlassian.net/browse/PROJ-1');

  const todo = jiraIssueToRequirement({ key: 'PROJ-2', fields: { summary: 'X', status: { name: 'To Do' } } }, 'https://acme.atlassian.net');
  assert.equal(todo.declaredComplete, false);
});

test('confluenceStorageToRequirements parses a storage body', () => {
  const reqs = confluenceStorageToRequirements('<p>PROJ-9 Login flow is done</p>', undefined, 'https://acme.atlassian.net/wiki/x');
  assert.equal(reqs[0].key, 'PROJ-9');
  assert.equal(reqs[0].url, 'https://acme.atlassian.net/wiki/x');
});

/* ── config ── */

test('parseTraceConfig: accepts a minimal valid config', () => {
  const cfg = parseTraceConfig(
    JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'spec.md' }] }] }),
  );
  assert.equal(cfg.scopes.length, 1);
  assert.deepEqual(cfg.scopes[0].tests, []); // default
});

test('parseTraceConfig: rejects an invalid config with a helpful error', () => {
  assert.throws(() => parseTraceConfig('{}'), /scopes/);
  assert.throws(() => parseTraceConfig('{ not json'), /not valid JSON/);
});

/* ── autodetect wizard ── */

test('autodetect: finds frameworks + a requirements source, emits a valid config', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-auto-'));
  mkdirSync(join(root, 'e2e'));
  mkdirSync(join(root, 'svc'));
  writeFileSync(join(root, 'e2e', 'a.spec.ts'), `test('a @PROJ-1', ()=>{})`);
  writeFileSync(join(root, 'svc', 'XTests.cs'), 'public class X {}');

  const plan = autodetect(root, 'Demo');
  const techs = plan.config.scopes[0].tests.map((t) => t.tech);
  assert.ok(techs.includes('playwright'));
  assert.ok(techs.includes('xunit'));
  assert.equal(plan.createRequirementsStub, 'docs/requirements.md'); // none found → stub
  assert.doesNotThrow(() => traceConfigSchema.parse(plan.config)); // config is valid
});

test('autodetect: prefers an existing requirements source over a stub', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-auto2-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 X');
  const plan = autodetect(root);
  assert.equal(plan.createRequirementsStub, null);
  assert.equal(plan.config.scopes[0].requirements[0].type, 'markdown');
});

/* ── end-to-end (offline) ── */

test('runTrace: markdown spec + scanned test + JUnit result → joined report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-e2e-'));
  mkdirSync(join(root, 'tests'));
  mkdirSync(join(root, 'results'));
  writeFileSync(join(root, 'spec.md'), `- [x] PROJ-1 Login\n- [x] PROJ-2 Logout\n- [ ] PROJ-3 Reset`);
  writeFileSync(join(root, 'tests', 'login.spec.ts'), `test('login @PROJ-1', ...)`);
  writeFileSync(
    join(root, 'results', 'junit.xml'),
    `<testsuites><testsuite><testcase name="login @PROJ-1"></testcase></testsuite></testsuites>`,
  );
  const config = parseTraceConfig(
    JSON.stringify({
      project: 'Demo',
      scopes: [
        {
          requirements: [{ type: 'markdown', path: 'spec.md' }],
          tests: [{ tech: 'playwright', globs: ['tests/**/*.spec.ts'], results: ['results/*.xml'] }],
        },
      ],
    }),
  );

  const report = await runTrace(config, root);
  const byKey = Object.fromEntries(report.requirements.map((r) => [r.key, r]));
  assert.equal(byKey['PROJ-1'].state, 'verified');
  assert.equal(byKey['PROJ-2'].state, 'specified'); // declared done, but no test → drift
  assert.equal(byKey['PROJ-2'].drift, true);
  assert.equal(byKey['PROJ-3'].state, 'specified');
  assert.equal(byKey['PROJ-3'].drift, false);
  assert.equal(report.stats.total, 3);
  assert.equal(report.stats.verified, 1);

  const rendered = renderAll(report);
  assert.match(rendered.markdown, /# Requirements Traceability — Demo/);
  assert.match(rendered.html, /^<!doctype html>/);
  assert.equal(typeof JSON.parse(rendered.json).stats.coveragePct, 'number');
});
