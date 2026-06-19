/**
 * Run history + regression detection. Each run is persisted as a git-stamped JSON snapshot; the
 * current run is diffed against the previous (or a named baseline) to flag requirements whose state
 * got worse — that's the regression signal (e.g. verified → failing between two commits).
 */
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequirementState, StateChange, TraceReport } from './types.js';

/** Higher is better. A drop in rank between runs is a regression. */
const STATE_RANK: Record<RequirementState, number> = { failing: 0, specified: 1, unverified: 2, verified: 3 };

/** Filesystem-safe run filename: `<iso-with-dashes>_<shortSha>.json`. */
export function runFileName(report: TraceReport): string {
  const ts = report.generatedAt.replace(/[:.]/g, '-');
  return `${ts}_${report.git.shortSha ?? 'nogit'}.json`;
}

/** Persist a run snapshot into `dir` (created if needed). Returns the absolute path. */
export function saveRun(report: TraceReport, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, runFileName(report));
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

/** Absolute paths of run snapshots in `dir`, oldest first (filenames sort chronologically). */
export function listRuns(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names.sort().map((n) => join(dir, n));
}

/** Keep only the newest `keep` run snapshots in `dir`; delete the rest. Returns how many were pruned. */
export function pruneRuns(dir: string, keep: number): number {
  if (keep <= 0) return 0;
  const runs = listRuns(dir); // oldest first
  const excess = runs.slice(0, Math.max(0, runs.length - keep));
  for (const path of excess) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
  return excess.length;
}

/** Parse a run file, or null if missing/corrupt. */
export function loadRun(path: string): TraceReport | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as TraceReport;
  } catch {
    return null;
  }
}

/** The most recent valid prior run in `dir` (walks back past corrupt files), or null. */
export function loadPreviousRun(dir: string): TraceReport | null {
  const runs = listRuns(dir);
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const r = loadRun(runs[i]);
    if (r) return r;
  }
  return null;
}

/** Load a named baseline file from `dir`, falling back to the previous run. */
export function loadBaseline(dir: string, baseline?: string): TraceReport | null {
  if (baseline) {
    const direct = loadRun(join(dir, baseline)) ?? loadRun(baseline);
    if (direct) return direct;
  }
  return loadPreviousRun(dir);
}

/** Compare two runs by per-requirement state rank → regressions (worse) and improvements (better). */
export function diffStates(prev: TraceReport, curr: TraceReport): { regressions: StateChange[]; improvements: StateChange[] } {
  const prevState = new Map(prev.requirements.map((r) => [r.key.toUpperCase(), r.state]));
  const regressions: StateChange[] = [];
  const improvements: StateChange[] = [];
  for (const r of curr.requirements) {
    const before = prevState.get(r.key.toUpperCase());
    if (!before || before === r.state) continue;
    const change: StateChange = { key: r.key, title: r.title, from: before, to: r.state };
    if (STATE_RANK[r.state] < STATE_RANK[before]) regressions.push(change);
    else improvements.push(change);
  }
  return { regressions, improvements };
}

/** Attach a comparison against `prev` to `report` (mutates + returns it). */
export function applyDiff(report: TraceReport, prev: TraceReport, file?: string): TraceReport {
  const { regressions, improvements } = diffStates(prev, report);
  report.regressions = regressions;
  report.improvements = improvements;
  report.stats.regressions = regressions.length;
  report.comparedTo = { ref: prev.git.shortSha, generatedAt: prev.generatedAt, file };
  return report;
}
