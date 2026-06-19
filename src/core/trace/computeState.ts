/**
 * The join: requirements × test references × results → a per-requirement state, plus drift and
 * orphan-test detection. This is the heart of the RTM — it decides which requirements actually hold.
 */
import type { IngestedResults } from './results.js';
import type {
  GitContext,
  KeyResult,
  OrphanTest,
  Requirement,
  RequirementState,
  TestRef,
  TraceReport,
  TraceStats,
  TracedRequirement,
} from './types.js';

function blankResult(): KeyResult {
  return { passed: 0, failed: 0, skipped: 0, lastRun: null };
}

/** Derive the state of a single requirement from its tests + aggregated result. */
export function deriveState(tests: TestRef[], result: KeyResult): RequirementState {
  if (result.failed > 0) return 'failing';
  if (result.passed > 0) return 'verified';
  if (tests.length > 0) return 'unverified'; // referenced, but no pass yet (unrun or skipped-only)
  return 'specified';
}

function groupByKey<T extends { key: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = item.key.toUpperCase();
    (map.get(k) ?? map.set(k, []).get(k)!).push(item);
  }
  return map;
}

/** Collect references + result keys that match no requirement (a test tags a non-existent key). */
function findOrphans(reqKeys: Set<string>, refs: TestRef[], ingested: IngestedResults): OrphanTest[] {
  const orphans = new Map<string, OrphanTest>();
  for (const ref of refs) {
    const k = ref.key.toUpperCase();
    if (reqKeys.has(k) || orphans.has(k)) continue;
    orphans.set(k, { key: k, source: ref.file });
  }
  for (const occ of ingested.occurrences) {
    const k = occ.key.toUpperCase();
    if (reqKeys.has(k)) continue;
    const existing = orphans.get(k);
    if (existing) existing.status = existing.status ?? occ.status;
    else orphans.set(k, { key: k, source: occ.file, status: occ.status });
  }
  return [...orphans.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function computeStats(rows: TracedRequirement[], orphanCount: number): TraceStats {
  const count = (s: RequirementState) => rows.filter((r) => r.state === s).length;
  const total = rows.length;
  const verified = count('verified');
  return {
    total,
    verified,
    failing: count('failing'),
    unverified: count('unverified'),
    specified: count('specified'),
    drift: rows.filter((r) => r.drift).length,
    orphanTests: orphanCount,
    regressions: 0, // set by the history diff when a prior run exists
    coveragePct: total ? Math.round((verified / total) * 100) : 0,
  };
}

export interface ComputeInput {
  requirements: Requirement[];
  refs: TestRef[];
  ingested: IngestedResults;
  git: GitContext;
  generatedAt: string;
  project?: string;
}

/** Build the full traceability report. */
export function computeReport(input: ComputeInput): TraceReport {
  const { requirements, refs, ingested, git, generatedAt, project } = input;
  const refsByKey = groupByKey(refs);
  const reqKeys = new Set(requirements.map((r) => r.key.toUpperCase()));

  const rows: TracedRequirement[] = requirements.map((req) => {
    const key = req.key.toUpperCase();
    const tests = refsByKey.get(key) ?? [];
    const result = ingested.byKey.get(key) ?? blankResult();
    const state = deriveState(tests, result);
    return { ...req, key, tests, result, state, drift: req.declaredComplete && state !== 'verified' };
  });

  const orphanTests = findOrphans(reqKeys, refs, ingested);
  return { generatedAt, project, git, requirements: rows, orphanTests, stats: computeStats(rows, orphanTests.length) };
}
