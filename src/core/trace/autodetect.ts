/**
 * Autodetect wizard backing `acp trace init`: scan a repo for test frameworks (+ their run commands
 * and result-file locations) and a requirements source, and produce a ready-to-run config. Keeps the
 * onboarding to "run init, then run trace". Pure read-only scanning; the caller does any writes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestSourceConfig, TraceConfig } from './config.js';
import { globFiles } from './glob.js';

/** What init should do, derived from the scan. */
export interface DetectPlan {
  config: TraceConfig;
  /** Relative path of a requirements markdown stub to create, or null if a source was found. */
  createRequirementsStub: string | null;
  /** Human-readable detection notes (the wizard output). */
  notes: string[];
}

function has(repoDir: string, patterns: string[]): boolean {
  return globFiles(repoDir, patterns).length > 0;
}

/** Keep the globs that match files; if none match, keep the candidates as sensible defaults. */
function matchingGlobs(repoDir: string, candidates: string[]): string[] {
  const matched = candidates.filter((g) => globFiles(repoDir, [g]).length > 0);
  return matched.length ? matched : candidates;
}

function pkgHasJest(repoDir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    return 'jest' in pkg || existsSync(join(repoDir, 'jest.config.js')) || existsSync(join(repoDir, 'jest.config.ts'));
  } catch {
    return existsSync(join(repoDir, 'jest.config.js')) || existsSync(join(repoDir, 'jest.config.ts'));
  }
}

/** Detect each test framework present and build its config entry. */
function detectTests(repoDir: string, notes: string[]): TestSourceConfig[] {
  const out: TestSourceConfig[] = [];
  const playwright = has(repoDir, ['playwright.config.ts', 'playwright.config.js']) || has(repoDir, ['**/*.spec.ts']);
  const vitest = has(repoDir, ['vitest.config.ts', 'vitest.config.js', 'vitest.workspace.ts']);
  const jest = pkgHasJest(repoDir);
  const xunit = has(repoDir, ['**/*Tests.cs', '**/*Test.cs']);

  if (playwright) {
    out.push({ tech: 'playwright', globs: matchingGlobs(repoDir, ['**/*.spec.ts', '**/*.e2e.ts']),
      command: 'npx playwright test', results: ['test-results/**/*.xml', '**/junit*.xml'] });
    notes.push('✔ playwright → npx playwright test');
  }
  if (vitest) {
    out.push({ tech: 'vitest', globs: matchingGlobs(repoDir, ['**/*.test.ts', '**/*.test.tsx']),
      command: 'npx vitest run --reporter=junit --outputFile=test-results/vitest-junit.xml', results: ['test-results/*.xml'] });
    notes.push('✔ vitest → npx vitest run');
  }
  if (jest && !vitest) {
    out.push({ tech: 'jest', globs: matchingGlobs(repoDir, ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js']),
      command: 'npx jest', results: ['junit.xml', 'coverage/junit.xml'] });
    notes.push('✔ jest → npx jest');
  }
  if (!jest && !vitest && has(repoDir, ['test/**/*.test.js', 'test/**/*.test.mjs'])) {
    out.push({ tech: 'node', globs: matchingGlobs(repoDir, ['test/**/*.test.js', 'test/**/*.test.mjs']),
      command: 'node --test "test/**/*.test.js"', results: [] });
    notes.push('✔ node:test → node --test');
  }
  if (xunit) {
    out.push({ tech: 'xunit', globs: matchingGlobs(repoDir, ['**/*Tests.cs', '**/*Test.cs']),
      command: 'dotnet test --logger "trx"', results: ['**/TestResults/*.trx'] });
    notes.push('✔ xunit → dotnet test --logger trx');
  }

  // Fall back to a placeholder so the config is still valid + obviously editable.
  if (out.length === 0) {
    out.push({ tech: 'playwright', globs: ['e2e/**/*.spec.ts'], command: 'npx playwright test', results: ['test-results/**/*.xml'] });
    notes.push('… no test framework detected — wrote a placeholder playwright group to edit');
  }
  return out;
}

/** Find an existing requirements source, or signal that a stub should be created. */
function detectRequirements(repoDir: string, notes: string[]): { req: TraceConfig['scopes'][number]['requirements']; stub: string | null } {
  const roadmap = globFiles(repoDir, ['**/roadmap.html', 'docs/**/roadmap.html'])[0];
  if (roadmap) {
    notes.push(`✔ requirements ← ${roadmap} (roadmap-html)`);
    return { req: [{ type: 'roadmap-html', path: roadmap }], stub: null };
  }
  const reqMd = globFiles(repoDir, ['**/requirements.md', 'docs/**/requirements.md'])[0];
  if (reqMd) {
    notes.push(`✔ requirements ← ${reqMd} (markdown)`);
    return { req: [{ type: 'markdown', path: reqMd }], stub: null };
  }
  notes.push('… no requirements source found — created docs/requirements.md (edit it / point at a Jira epic)');
  return { req: [{ type: 'markdown', path: 'docs/requirements.md' }], stub: 'docs/requirements.md' };
}

/** Scan `repoDir` and produce a ready config + detection notes. */
export function autodetect(repoDir: string, project?: string): DetectPlan {
  const notes: string[] = [];
  const tests = detectTests(repoDir, notes);
  const { req, stub } = detectRequirements(repoDir, notes);
  const config: TraceConfig = {
    project: project ?? 'My Product',
    scopes: [{ name: 'default', requirements: req, tests }],
    history: { dir: 'runs' },
    output: { markdown: 'docs/RTM.md', html: 'docs/rtm.html', json: 'docs/rtm.json' },
    portal: { port: 8787 },
  };
  return { config, createRequirementsStub: stub, notes };
}

/** A starter requirements.md so a fresh repo has something to trace immediately. */
export const REQUIREMENTS_STUB = `# Requirements

List one requirement per line with a stable key (e.g. a Jira key). Tag the tests that cover each key
with that key (\`@PROJ-1\` in the test title, or \`[Trait("req","PROJ-1")]\` in xUnit).

- [ ] PROJ-1 Example requirement — replace me
- [ ] PROJ-2 Another requirement
`;
