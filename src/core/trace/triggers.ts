/**
 * Dashboard-triggered test runs, finer-grained than "run everything":
 *   - runSuite(tech): run just one test group's command (full), then re-trace.
 *   - runRequirement(key): run only that requirement's tagged tests (--grep/-t/--filter). To avoid
 *     a filtered run clobbering the suite's results for OTHER requirements, the result files are
 *     snapshotted, the filtered run is read for the one key, the files are restored, and only that
 *     key's fresh outcome is overlaid onto the report.
 * Both reuse the same engine + sinks; the portal exposes them on POST /run.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { TestSourceConfig, TraceConfig } from './config.js';
import { deriveState, recomputeStats } from './computeState.js';
import { globFiles } from './glob.js';
import { resolveStoreDir } from './store.js';
import { pruneRuns, saveRun } from './history.js';
import { ingestResults } from './results.js';
import { runCommandStream } from './runner.js';
import { markStale } from './stale.js';
import { DEFAULT_KEY_PATTERN } from './testScanner.js';
import { runTrace } from './index.js';
import type { TestTech, TraceReport } from './types.js';

/** The CLI flag that restricts a suite to a requirement's tagged tests. */
export function filterArg(tech: TestTech, key: string): string {
  switch (tech) {
    case 'jest':
    case 'vitest':
      return `-t "@${key}"`;
    case 'node':
      return `--test-name-pattern "@${key}"`;
    case 'xunit':
      return `--filter "req=${key}"`; // matches [Trait("req","KEY")]
    case 'playwright':
    default:
      return `--grep "@${key}"`;
  }
}

function repoDirOf(config: TraceConfig, baseDir: string): string {
  const p = config.repoDir ?? '.';
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

type Runnable = TestSourceConfig & { command: string };
function groupsWithCommand(config: TraceConfig): Runnable[] {
  return config.scopes.flatMap((s) => s.tests).filter((t): t is Runnable => Boolean(t.command));
}

function resultPathsOf(groups: TestSourceConfig[], repoDir: string): string[] {
  const paths = groups.flatMap((t) => (t.results ?? []).flatMap((g) => globFiles(repoDir, [g]).map((f) => resolve(repoDir, f))));
  return [...new Set(paths)];
}

/** Run just one tech's suite(s), fully, then re-trace from the refreshed results. */
export async function runSuite(config: TraceConfig, baseDir: string, tech: string, onLine?: (l: string) => void): Promise<TraceReport> {
  const repoDir = repoDirOf(config, baseDir);
  const groups = groupsWithCommand(config).filter((t) => t.tech === tech);
  for (const t of groups) await runCommandStream({ tech: t.tech, command: t.command, cwd: t.cwd }, repoDir, onLine);
  return runTrace(config, baseDir, { run: false, save: true, compare: true });
}

/** Run only `key`'s tagged tests; overlay just that key's fresh result without disturbing the rest. */
export async function runRequirement(config: TraceConfig, baseDir: string, key: string, onLine?: (l: string) => void): Promise<TraceReport> {
  const repoDir = repoDirOf(config, baseDir);
  const keyPattern = config.keyPattern ?? DEFAULT_KEY_PATTERN;
  const upper = key.toUpperCase();
  const groups = groupsWithCommand(config);

  // 1. Snapshot the result files (content) so a filtered run can be rolled back.
  const snap = new Map<string, string | null>();
  for (const p of resultPathsOf(groups, repoDir)) {
    try {
      snap.set(p, readFileSync(p, 'utf8'));
    } catch {
      snap.set(p, null);
    }
  }

  // 2. Run each suite restricted to this requirement's tag.
  for (const t of groups) {
    await runCommandStream({ tech: t.tech, command: `${t.command} ${filterArg(t.tech, upper)}`, cwd: t.cwd }, repoDir, onLine);
  }

  // 3. Read the fresh result for this key from whatever the filtered run produced.
  const fresh = ingestResults(resultPathsOf(groups, repoDir), keyPattern).byKey.get(upper) ?? null;

  // 4. Restore the snapshotted result files (delete ones the filtered run newly created).
  for (const [p, content] of snap) {
    if (content === null) {
      try {
        rmSync(p);
      } catch {
        /* ignore */
      }
    } else {
      writeFileSync(p, content, 'utf8');
    }
  }

  // 5. Re-trace from the restored (full) results, then overlay just this key's fresh outcome.
  const report = await runTrace(config, baseDir, { run: false, save: false, compare: true });
  if (fresh) {
    const row = report.requirements.find((r) => r.key.toUpperCase() === upper);
    if (row) {
      row.result = fresh;
      row.state = deriveState(row.tests, fresh);
      row.drift = row.declaredComplete && row.state !== 'verified';
      markStale(report, repoDir);
      recomputeStats(report);
    }
  }
  if (config.history) {
    const dir = config.history.dir
      ? (isAbsolute(config.history.dir) ? config.history.dir : resolve(baseDir, config.history.dir))
      : resolveStoreDir(baseDir, 'runs');
    saveRun(report, dir);
    if (config.history.keep) pruneRuns(dir, config.history.keep);
  }
  return report;
}
