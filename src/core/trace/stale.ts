/**
 * Stale-results guard. A requirement that HAS a result can still be lying: if the test files that
 * cover it were modified after the result was produced — or the result predates the current commit —
 * the green is outdated. This flags those so a stale ✅ never passes silently for fresh truth.
 */
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { TraceReport } from './types.js';

function mtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** Flag requirements whose newest result is older than their covering tests / the current commit. */
export function markStale(report: TraceReport, repoDir: string): TraceReport {
  const committedAt = report.git.committedAt ? Date.parse(report.git.committedAt) : null;
  let count = 0;

  for (const r of report.requirements) {
    const hasResult = r.result.passed + r.result.failed > 0;
    const lastRun = r.result.lastRun ? Date.parse(r.result.lastRun) : null;
    if (!hasResult || lastRun === null) {
      r.stale = false;
      continue;
    }
    let newestTest = 0;
    for (const t of r.tests) {
      const m = mtimeMs(isAbsolute(t.file) ? t.file : resolve(repoDir, t.file));
      if (m !== null && m > newestTest) newestTest = m;
    }
    const staleByTest = newestTest > lastRun;
    const staleByCommit = committedAt !== null && committedAt > lastRun;
    r.stale = staleByTest || staleByCommit;
    if (r.stale) count += 1;
  }

  report.stats.stale = count;
  return report;
}
