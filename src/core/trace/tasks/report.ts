/**
 * Source the trace report the honesty cross-check runs against: the latest saved run by default
 * (fast, offline; flagged stale when its commit differs from HEAD), or a fresh `--run` that re-runs
 * the suites first. Shared by the CLI and MCP `task verify` / `task board` / `task list --drift`.
 */
import { isAbsolute, resolve } from 'node:path';
import type { TraceConfig } from '../config.js';
import type { TraceReport } from '../types.js';
import { runTrace } from '../index.js';
import { loadPreviousRun } from '../history.js';
import { getGitContext } from '../gitContext.js';
import { resolveStoreDir } from '../store.js';

export interface ReportSource {
  report: TraceReport | null;
  fresh: boolean; // re-ran the suites
  stale: boolean; // the loaded run predates HEAD
  staleNote: string | null;
}

const rel = (baseDir: string, p: string): string => (isAbsolute(p) ? p : resolve(baseDir, p));

export async function reportForTasks(baseDir: string, config: TraceConfig, opts: { run?: boolean } = {}): Promise<ReportSource> {
  if (opts.run) {
    const report = await runTrace(config, baseDir, { save: true });
    return { report, fresh: true, stale: false, staleNote: null };
  }
  const runsDir = config.history?.dir ? rel(baseDir, config.history.dir) : resolveStoreDir(baseDir, 'runs');
  const report = loadPreviousRun(runsDir);
  if (!report) return { report: null, fresh: false, stale: false, staleNote: null };

  const repoDir = rel(baseDir, config.repoDir ?? '.');
  const head = getGitContext(repoDir);
  const stale = Boolean(head.sha && report.git.sha && head.sha !== report.git.sha);
  const staleNote = stale
    ? `latest run is from ${report.git.shortSha ?? '?'}, HEAD is ${head.shortSha ?? '?'} — pass --run to refresh`
    : null;
  return { report, fresh: false, stale, staleNote };
}
