// Feature Lifecycle Wizard (slice 1): pure renderers + helpers + end-to-end runWizard (fake AI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderFeaturePack, renderFeaturePackMarkdown } from '../dist/core/wizard/featurePack.js';
import {
  extractFirstMermaid, curlsFromAcceptance, buildFeaturePack, wizardCheck, ensureRequirementsDoc, runWizard,
} from '../dist/core/wizard/wizard.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';

// ── pure helpers ──────────────────────────────────────────────────────────────────────────

test('extractFirstMermaid: pulls the first mermaid block', () => {
  const md = '# Doc\n\nintro\n\n```mermaid\nflowchart TD\n  A-->B\n```\n\nmore\n\n```mermaid\nfoo\n```';
  assert.equal(extractFirstMermaid(md), 'flowchart TD\n  A-->B');
  assert.equal(extractFirstMermaid('no diagram'), undefined);
});

test('curlsFromAcceptance: HTTP steps → curls, ids flagged', () => {
  const tasks = [
    { key: 'P-1', title: 'Login', acceptanceCriteria: [], tests: [],
      acceptanceTests: [
        { name: 'bad creds', steps: [{ POST: '/login', body: { u: 'x' }, expect: { status: 401 } }] },
        { name: 'get user', steps: [{ GET: '/users/{id}', expect: { status: 200 } }] },
      ] },
  ];
  const curls = curlsFromAcceptance(tasks);
  assert.equal(curls.length, 2);
  assert.equal(curls[0].method, 'POST');
  assert.equal(curls[0].url, '/login');
  assert.deepEqual(curls[0].body, { u: 'x' });
  assert.match(curls[1].note, /real id/);
});

test('wizardCheck: none needs nothing; jira flags missing env', () => {
  assert.equal(wizardCheck('none').ok, true);
  const saved = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'].map((k) => [k, process.env[k]]);
  for (const [k] of saved) delete process.env[k];
  const r = wizardCheck('jira');
  assert.equal(r.ok, false);
  assert.ok(r.lines.some((l) => /Jira/.test(l) && /set/.test(l)));
  for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
});

test('ensureRequirementsDoc: scaffolds when missing, true when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wz-req-'));
  assert.equal(ensureRequirementsDoc(dir), false); // created
  assert.ok(existsSync(join(dir, 'docs/requirements.md')));
  assert.equal(ensureRequirementsDoc(dir), true); // already there
});

test('buildFeaturePack: assembles requirements + mermaid + tasks + curls', () => {
  const pack = buildFeaturePack({
    feature: 'Login',
    source: 'none',
    requirements: [{ key: 'FEAT-1', title: 'Login', declaredStatus: 'todo' }],
    analyzeResult: {
      outDir: '/x/.acp/tech-analysis', acceptanceSpecs: ['.acp/tests/FEAT-1.acp.json'],
      tasks: [{ key: 'FEAT-1', title: 'Implement login', acceptanceCriteria: ['rejects bad creds'],
        flowMermaid: 'flowchart TD\n A-->B', tests: [{ tech: 'playwright', title: 'e2e' }],
        acceptanceTests: [{ name: 'bad', steps: [{ POST: '/login', expect: { status: 401 } }] }] }],
    },
    techMd: '# T\n\n```mermaid\nflowchart TD\n  U-->API\n```',
    gapMd: '# Gap Analysis\n\nmissing.',
    outDirRel: '.acp/tech-analysis',
  });
  assert.equal(pack.requirements[0].key, 'FEAT-1');
  assert.equal(pack.systemMermaid, 'flowchart TD\n  U-->API');
  assert.equal(pack.useCases.length, 1);
  assert.equal(pack.tasks[0].context.length >= 2, true);
  assert.equal(pack.tests.length, 2); // playwright + acceptance spec
  assert.equal(pack.curls.length, 1);
  assert.equal(pack.gapAnalysis, 'missing.');
});

// ── renderers ───────────────────────────────────────────────────────────────────────────────

const samplePack = {
  feature: 'Login & <auth>',
  source: 'none',
  requirements: [{ key: 'FEAT-1', title: 'Login', status: 'todo' }],
  systemMermaid: 'flowchart TD\n  U-->API',
  useCases: [{ key: 'FEAT-1', title: 'Login', mermaid: 'flowchart TD\n  A-->B' }],
  gapAnalysis: 'missing.',
  tasks: [{ key: 'FEAT-1', title: 'Implement login', requirements: ['FEAT-1'], context: ['criterion: rejects bad creds'] }],
  tests: [{ tech: 'playwright', title: 'e2e', key: 'FEAT-1' }],
  curls: [{ name: 'FEAT-1 — bad', method: 'POST', url: '/login', body: { u: 'x' } }],
  docs: { mdDir: 'feature-pack.md' },
};

test('renderFeaturePack: self-contained HTML with sections + escaped title', () => {
  const html = renderFeaturePack(samplePack, { baseUrl: 'http://api.test' });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Login &amp; &lt;auth&gt;/); // escaped
  assert.match(html, /System data-flow/);
  assert.match(html, /class="mermaid"/);
  assert.match(html, /curl -i -X POST &quot;http:\/\/api\.test\/login&quot;/); // quotes html-escaped in the page
  assert.match(html, /localStorage/);
});

test('renderFeaturePackMarkdown: mirrors the pack', () => {
  const md = renderFeaturePackMarkdown(samplePack);
  assert.match(md, /# Feature: Login & <auth>/);
  assert.match(md, /```mermaid/);
  assert.match(md, /- \[ \] Implement login/);
  assert.match(md, /POST \/login/);
});

// ── end-to-end (fake AI, source none) ─────────────────────────────────────────────────────────

const FAKE = JSON.stringify({
  gapAnalysis: 'FEAT-1 login is missing.',
  technicalAnalysis: '# Technical Analysis\n\nAuth.',
  systemDiagram: 'flowchart LR\n  UI -->|credentials| API[/login]\n  API -->|user row| DB[(users)]',
  tasks: [
    { key: 'FEAT-1', title: 'Implement login', acceptanceCriteria: ['rejects bad creds', 'returns a token'],
      flowMermaid: 'flowchart TD\n  A[POST /login]-->B{valid?}\n  B-->|no|E[401]', tests: [{ tech: 'playwright', title: 'login e2e' }],
      acceptanceTests: [{ name: 'rejects bad creds', steps: [{ POST: '/login', body: { user: 'x', pass: 'bad' }, expect: { status: 401 } }] }] },
  ],
});

test('runWizard: source none + fake AI → writes feature pack (html + md) @KAT-10', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wz-run-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs/requirements.md'), '# Requirements\n\n- [ ] FEAT-1 Login\n');
  const config = parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }] }));

  const r = await runWizard(config, dir, { feature: 'Login', source: 'none', chat: async () => FAKE, now: () => '2026-06-24 10:00' });

  assert.equal(r.pack.requirements.some((x) => x.key === 'FEAT-1'), true);
  assert.equal(r.pack.tasks.length, 1);
  assert.match(r.pack.systemMermaid, /flowchart LR[\s\S]*credentials/); // explicit systemDiagram preferred
  assert.equal(r.pack.useCases.length, 1);
  assert.equal(r.pack.curls.length, 1);
  assert.ok(existsSync(r.htmlPath));
  assert.ok(existsSync(r.mdPath));
  assert.match(readFileSync(r.htmlPath, 'utf8'), /Feature pack — Login/);
  assert.match(readFileSync(r.mdPath, 'utf8'), /## System data-flow/);
});

test('runWizard: --no-analyze still produces a pack (requirements only, no AI)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wz-noai-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs/requirements.md'), '# Requirements\n\n- [ ] FEAT-1 Login\n');
  const config = parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }] }));

  const r = await runWizard(config, dir, { feature: 'Login', source: 'none', analyze: false });
  assert.equal(r.pack.tasks.length, 0);
  assert.equal(r.pack.requirements.length, 1);
  assert.ok(existsSync(r.htmlPath));
});
