/**
 * Requirements Traceability (RTM) data model.
 *
 * The pipeline joins three things on a stable requirement KEY (typically a Jira issue key):
 *   1. the requirement universe (what SHOULD exist) — from Jira / roadmap / Confluence / markdown,
 *   2. what tests CLAIM to cover each key (static scan of test sources, hybrid with a mapping file),
 *   3. whether those tests actually PASS (ingested JUnit / TRX result files),
 * then derives a per-requirement state and stamps the whole report with the git commit it reflects.
 */

/** The lifecycle state a requirement is in, derived from declared status + tests + results. */
export type RequirementState =
  | 'verified' // tests reference it AND every referencing test with a result passed
  | 'failing' // referencing tests exist and at least one failed
  | 'unverified' // tests reference it but no result was ingested (not run / no reporter)
  | 'specified'; // requirement exists but no test references it

export const REQUIREMENT_STATES: readonly RequirementState[] = [
  'verified',
  'failing',
  'unverified',
  'specified',
];

/** Where a requirement came from — drives how its key + declared status were extracted. */
export type RequirementSourceKind = 'jira-epic' | 'roadmap-html' | 'confluence-page' | 'markdown';

/** A single requirement to verify (one row of the matrix). */
export interface Requirement {
  /** Stable join key, e.g. `PROJ-123`. Matched (case-insensitively) against test tags. */
  key: string;
  /** Human title / summary. */
  title: string;
  /** Raw status as the source declares it (e.g. Jira "Done", roadmap "complete", `[x]`). */
  declaredStatus: string | null;
  /** True when the source declares this complete/done — used to flag drift. */
  declaredComplete: boolean;
  /** Which kind of source produced this requirement. */
  source: RequirementSourceKind;
  /** Optional deep link to the requirement (Jira browse URL, Confluence page, …). */
  url?: string;
  /** Optional scope/grouping label (e.g. the product or epic this belongs to). */
  scope?: string;
}

/** Test technology family. Drives default tag/scan conventions. */
export type TestTech = 'playwright' | 'jest' | 'vitest' | 'node' | 'xunit' | 'generic';

/** A single test that references a requirement key (discovered by the static scanner or a mapping). */
export interface TestRef {
  /** The requirement key this test claims to cover. */
  key: string;
  /** Source file the test lives in (relative to the repo root when possible). */
  file: string;
  /** Test title / name (without the tag), best-effort. */
  title: string;
  /** Test technology. */
  tech: TestTech;
  /** 1-based line number of the match, when known. */
  line?: number;
  /** How the link was established. */
  via: 'tag' | 'trait' | 'mapping';
}

/** Aggregated execution outcome for one requirement key, across all ingested result files. */
export interface KeyResult {
  passed: number;
  failed: number;
  skipped: number;
  /** ISO timestamp of the newest result file consumed for this key, when known. */
  lastRun: string | null;
}

/** A test result entry that referenced a key that has no matching requirement. */
export interface OrphanTest {
  key: string;
  /** Where it was seen (a source file or a result file). */
  source: string;
  status?: 'passed' | 'failed' | 'skipped';
}

/** The git commit a report reflects — the "version" at which the requirements hold (or not). */
export interface GitContext {
  sha: string | null;
  shortSha: string | null;
  branch: string | null;
  /** True when the working tree had uncommitted changes when the report was generated. */
  dirty: boolean;
  /** Commit author/commit date (ISO), when resolvable. */
  committedAt: string | null;
}

/** One fully-joined requirement row in the report. */
export interface TracedRequirement extends Requirement {
  state: RequirementState;
  /** Declared complete but not verified → the requirement may not actually hold. */
  drift: boolean;
  tests: TestRef[];
  result: KeyResult;
}

/** Rollup counts for the report header / badges. */
export interface TraceStats {
  total: number;
  verified: number;
  failing: number;
  unverified: number;
  specified: number;
  drift: number;
  orphanTests: number;
  /** verified / total as a 0–100 integer percentage. */
  coveragePct: number;
}

/** The full traceability report — the canonical object every sink renders. */
export interface TraceReport {
  /** ISO timestamp the report was generated. */
  generatedAt: string;
  /** Optional project/label. */
  project?: string;
  git: GitContext;
  requirements: TracedRequirement[];
  orphanTests: OrphanTest[];
  stats: TraceStats;
}
