// acp analyze: prompt build, JSON extraction, output validation, and the full orchestration (fake AI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractJson, aiConfigFromEnv } from '../dist/core/analyze/ai.js';
import { buildPrompt, validateOutput, taskMarkdown, analyze, collectCodeContext } from '../dist/core/analyze/analyze.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';
import { gatherSpecFiles } from '../dist/core/trace/acceptance/runner.js';

test('extractJson: handles fences + surrounding prose', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('here you go {"a":[1,2]} thanks'), { a: [1, 2] });
  assert.throws(() => extractJson('no json here'), /No JSON/);
});

test('aiConfigFromEnv: anthropic vs openai-compatible', () => {
  assert.equal(aiConfigFromEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).provider, 'anthropic');
  const oa = aiConfigFromEnv({ AI_PROVIDER: 'github-models', GITHUB_TOKEN: 'g' });
  assert.equal(oa.apiKey, 'g');
  assert.match(oa.baseUrl, /\/v1$|api/);
});

test('collectCodeContext: reads + caps file contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-ctx-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'auth.ts'), 'export function login(){ return true; }');
  writeFileSync(join(root, 'src', 'big.ts'), 'x'.repeat(10000));
  const { context, included } = collectCodeContext(root, ['src/auth.ts', 'src/big.ts'], { maxBytesPerFile: 100 });
  assert.equal(included, 2);
  assert.match(context, /=== src\/auth\.ts ===[\s\S]*function login/); // real contents
  assert.match(context, /…\(truncated\)/); // big file truncated
});

test('buildPrompt + validateOutput + taskMarkdown', () => {
  const msgs = buildPrompt([{ key: 'PROJ-1', title: 'Login', declaredStatus: 'To Do' }], '=== src/auth.ts ===\nfunction login(){}', 1);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[1].content, /PROJ-1: Login/);
  assert.match(msgs[1].content, /src\/auth\.ts/);
  assert.match(msgs[1].content, /function login/); // actual code in the prompt

  const out = validateOutput({ gapAnalysis: 'gap', tasks: [{ key: 'proj-1', title: 'Login', acceptanceCriteria: ['can log in'], tests: [{ tech: 'jest', title: 't' }] }] });
  assert.equal(out.tasks[0].key, 'PROJ-1'); // uppercased
  assert.equal(out.technicalAnalysis, '(none)'); // missing → coerced

  const md = taskMarkdown(out.tasks[0]);
  assert.match(md, /^# Login/); // first heading = summary (Jira-publishable)
  assert.match(md, /## Acceptance Criteria/);
  assert.match(md, /@PROJ-1/);
});

const FAKE_REPLY = JSON.stringify({
  gapAnalysis: 'PROJ-1 (Login) is not implemented in the codebase.',
  technicalAnalysis: '# Technical Analysis\n\nAuth endpoint.\n\n```mermaid\nflowchart TD\n  A-->B\n```',
  tasks: [
    { key: 'PROJ-1', title: 'Login', acceptanceCriteria: ['user can log in', 'invalid creds rejected'], flowMermaid: 'flowchart TD\n  Start-->Login', tests: [{ tech: 'playwright', title: 'login works' }] },
  ],
});

test('analyze: writes gap analysis + tech doc + tasks and scaffolds a tagged test (fake AI)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-analyze-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  const config = parseTraceConfig(JSON.stringify({
    scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [{ tech: 'playwright', globs: ['e2e/**/*.spec.ts'] }], code: ['src/**/*.ts'] }],
  }));

  const r = await analyze(config, root, { chat: async () => FAKE_REPLY, outDir: 'ta' });
  assert.equal(r.tasks.length, 1);
  assert.ok(existsSync(join(root, 'ta', 'gap-analysis.md')));
  assert.ok(existsSync(join(root, 'ta', 'technical-analysis.md')));
  assert.ok(existsSync(join(root, 'ta', 'tasks', 'epic.md')));
  assert.match(readFileSync(join(root, 'ta', 'tasks', 'PROJ-1.md'), 'utf8'), /## Acceptance Criteria[\s\S]*user can log in/);
  // a tagged e2e stub was scaffolded
  assert.equal(r.scaffolded[0], 'e2e/proj-1.spec.ts');
  assert.match(readFileSync(join(root, 'e2e', 'proj-1.spec.ts'), 'utf8'), /@PROJ-1/);
  assert.equal(r.mode, 'full');
});

const ASK_REPLY = JSON.stringify({
  gapAnalysis: 'Login flow undecided.',
  openQuestionsMarkdown: '# Login decisions\n\n## Flow overview\n\n```mermaid\nflowchart TD\n  START["Start"] --> Q1{"Q1 · SSO or password?"}\n  Q1 -->|SSO| A[SSO]\n  Q1 -->|Password| B[Password]\n  classDef pending fill:#ffe8b3;\n  class Q1 pending;\n```\n\n## Open questions (QA)\n\n- **Q1 — SSO or password?:**\n  - [ ] SSO\n  - [ ] Password\n',
});

test('analyze --ask: writes an open-questions form (gap-analysis + .md + .html)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-ask-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  const config = parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }] }));
  const r = await analyze(config, root, { chat: async () => ASK_REPLY, outDir: 'ta', ask: true });
  assert.equal(r.mode, 'ask');
  assert.equal(r.tasks.length, 0);
  assert.ok(existsSync(join(root, 'ta', 'open-questions.md')));
  assert.match(readFileSync(join(root, 'ta', 'open-questions.html'), 'utf8'), /^<!doctype html>/i);
  assert.match(readFileSync(join(root, 'ta', 'open-questions.html'), 'utf8'), /SSO or password/);
});

test('analyze --answers: incorporates the answers into the full prompt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-ans-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  const config = parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }] }));
  let seenAnswers = false;
  const chat = async (msgs) => { seenAnswers = /STAKEHOLDER ANSWERS[\s\S]*use password auth/.test(msgs[1].content); return FAKE_REPLY; };
  await analyze(config, root, { chat, outDir: 'ta', answers: '- Q1: use password auth', scaffold: false });
  assert.equal(seenAnswers, true); // the answers reached the model
});

// Phase 2 step 10: analyze emits executable acceptance specs (.acp/tests/<KEY>.acp.json + inline block).
const FAKE_REPLY_WITH_ACCEPTANCE = JSON.stringify({
  gapAnalysis: 'PROJ-1 login is missing.',
  technicalAnalysis: '# Technical Analysis\n\nAuth.',
  tasks: [
    {
      key: 'PROJ-1', title: 'Login', acceptanceCriteria: ['rejects bad creds'], tests: [],
      acceptanceTests: [
        { name: 'rejects bad credentials', steps: [{ POST: '/login', body: { user: 'x', pass: 'bad' }, expect: { status: 401 } }] },
      ],
    },
    { key: 'PROJ-2', title: 'Internal calc', acceptanceCriteria: ['math is right'], tests: [] }, // no acceptanceTests
  ],
});

test('analyze: writes executable acceptance specs + inline acp-test block', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-acc-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login\n- [ ] PROJ-2 Calc');
  const config = parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }] }));

  const r = await analyze(config, root, { chat: async () => FAKE_REPLY_WITH_ACCEPTANCE, outDir: 'ta', scaffold: false });

  // spec file written for PROJ-1 only (PROJ-2 has none)
  assert.equal(r.acceptanceSpecs.length, 1);
  const specPath = join(root, '.acp', 'tests', 'PROJ-1.acp.json');
  assert.ok(existsSync(specPath));
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  assert.equal(spec.req, 'PROJ-1');
  assert.equal(spec.cases[0].steps[0].expect.status, 401);

  // the spec parses through the gatherer
  const specs = gatherSpecFiles(root, ['.acp/tests/**/*.acp.json']);
  assert.equal(specs[0].req, 'PROJ-1');

  // task markdown embeds an inline acp-test block; PROJ-2 does not
  assert.match(readFileSync(join(root, 'ta', 'tasks', 'PROJ-1.md'), 'utf8'), /```acp-test/);
  assert.doesNotMatch(readFileSync(join(root, 'ta', 'tasks', 'PROJ-2.md'), 'utf8'), /```acp-test/);
});

// Wizard phase 2: analyze emits an explicit end-to-end system data-flow diagram.
test('analyze: systemDiagram is returned + written into technical-analysis.md', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-sysdiag-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  const config = parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }] }));
  const reply = JSON.stringify({
    gapAnalysis: 'gap',
    technicalAnalysis: '# Technical Analysis\n\nAuth.',
    systemDiagram: 'flowchart LR\n  UI -->|credentials| API[/login]\n  API -->|user row| DB[(users)]',
    tasks: [{ key: 'PROJ-1', title: 'Login', acceptanceCriteria: [], tests: [] }],
  });
  const r = await analyze(config, root, { chat: async () => reply, outDir: 'ta', scaffold: false });
  assert.match(r.systemDiagram, /flowchart LR/);
  assert.match(readFileSync(join(root, 'ta', 'technical-analysis.md'), 'utf8'), /## System data-flow[\s\S]*credentials/);
});
