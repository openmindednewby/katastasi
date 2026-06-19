// acp analyze: prompt build, JSON extraction, output validation, and the full orchestration (fake AI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractJson, aiConfigFromEnv } from '../dist/core/analyze/ai.js';
import { buildPrompt, validateOutput, taskMarkdown, analyze } from '../dist/core/analyze/analyze.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';

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

test('buildPrompt + validateOutput + taskMarkdown', () => {
  const msgs = buildPrompt([{ key: 'PROJ-1', title: 'Login', declaredStatus: 'To Do' }], ['src/auth.ts']);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[1].content, /PROJ-1: Login/);
  assert.match(msgs[1].content, /src\/auth\.ts/);

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
});
