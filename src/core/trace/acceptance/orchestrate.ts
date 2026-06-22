/**
 * Orchestration that ties the acceptance pieces to a trace config: gather spec files (declared
 * `tech: 'acceptance'` globs, else a sensible default) + inline ` ```acp-test ` blocks from markdown
 * requirement sources, run them through the runner (with the config's `runner` baseUrl/headers/setup),
 * and emit JUnit to the declared results path. This is what `katastasi test` and the MCP `test_run` call.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceConfig } from '../config.js';
import { normalizeSpec, type AcceptanceCase, type AcceptanceSpec } from './model.js';
import { gatherSpecFiles, runSpecs, type AcceptanceRunResult } from './runner.js';
import { parseInlineFromDoc } from './parse/inline.js';
import { writeJUnit } from './junit.js';

const DEFAULT_SPEC_GLOBS = [
  '.acp/tests/**/*.acp.json',
  '.acp/tests/**/*.acp.yml',
  '.acp/tests/**/*.acp.yaml',
  '.acp/tests/**/*.acp.md',
];
const DEFAULT_RESULTS = '.acp/results/acceptance.xml';

export interface AcceptanceCliOptions {
  baseUrl?: string; // overrides config.runner.baseUrl
  req?: string; // filter to one requirement key
  specGlobs?: string[]; // overrides declared/default spec globs
  out?: string; // JUnit output path (relative to repoDir)
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface AcceptanceRunSummary extends AcceptanceRunResult {
  outPath: string; // absolute path the JUnit was written to
  specCount: number; // specs gathered (after req filter)
}

function acceptanceTests(config: TraceConfig): Array<{ globs: string[]; results?: string[] }> {
  return config.scopes.flatMap((s) => (s.tests ?? []).filter((t) => t.tech === 'acceptance'));
}

function resolveSetup(config: TraceConfig): AcceptanceCase | undefined {
  const setup = config.runner?.setup;
  if (!setup) return undefined;
  return normalizeSpec({ req: 'setup', cases: [setup] }, 'runner.setup').cases[0];
}

function gatherInline(repoDir: string, config: TraceConfig): AcceptanceSpec[] {
  const out: AcceptanceSpec[] = [];
  for (const scope of config.scopes) {
    for (const r of scope.requirements) {
      if (r.type !== 'markdown') continue;
      try {
        const text = readFileSync(join(repoDir, r.path), 'utf8');
        out.push(...parseInlineFromDoc(text, config.keyPattern, r.path));
      } catch {
        // missing/unreadable requirement doc — skip
      }
    }
  }
  return out;
}

/** Run acceptance specs for a config and write JUnit results. Never throws on assertion failures. */
export async function runAcceptance(
  baseDir: string,
  config: TraceConfig,
  opts: AcceptanceCliOptions = {},
): Promise<AcceptanceRunSummary> {
  const repoDir = join(baseDir, config.repoDir ?? '.');
  const declared = acceptanceTests(config);

  const globs = opts.specGlobs ?? (declared.flatMap((t) => t.globs).length ? declared.flatMap((t) => t.globs) : DEFAULT_SPEC_GLOBS);
  let specs = [...gatherSpecFiles(repoDir, globs), ...gatherInline(repoDir, config)];
  if (opts.req) specs = specs.filter((s) => s.req.toUpperCase() === opts.req!.toUpperCase());

  const result = await runSpecs(specs, {
    baseUrl: opts.baseUrl ?? config.runner?.baseUrl,
    headers: config.runner?.headers,
    setup: resolveSetup(config),
    env: opts.env,
    fetchImpl: opts.fetchImpl,
    now: opts.now,
  });

  const declaredResult = declared.flatMap((t) => t.results ?? [])[0];
  const outPath = join(repoDir, opts.out ?? declaredResult ?? DEFAULT_RESULTS);
  writeJUnit(outPath, result);
  return { ...result, outPath, specCount: specs.length };
}
