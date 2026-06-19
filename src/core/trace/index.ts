/**
 * Trace orchestrator: turn a config into a TraceReport by gathering requirements (from each scope's
 * sources), scanning + ingesting tests, and joining them at the current git commit. Then render the
 * report to markdown / HTML / JSON. The CLI + MCP layers call these two functions.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { RequirementSource, TraceConfig, TraceScope } from './config.js';
import { computeReport } from './computeState.js';
import { getGitContext } from './gitContext.js';
import { fetchConfluenceRequirements } from './requirements/confluencePage.js';
import { runCommandRequirements } from './requirements/command.js';
import { fetchGithubRequirements, fetchGitlabRequirements } from './requirements/issues.js';
import { fetchJiraRequirements } from './requirements/jiraEpic.js';
import { parseMarkdownRequirements } from './requirements/markdown.js';
import { parseRoadmapHtml } from './requirements/roadmapHtml.js';
import { ingestResults } from './results.js';
import { renderHtml } from './report/html.js';
import { renderMarkdown } from './report/markdown.js';
import { execCommands, type CommandRun, type RunnableSpec } from './runner.js';
import { applyDiff, loadBaseline, pruneRuns, saveRun } from './history.js';
import { markStale } from './stale.js';
import { DEFAULT_KEY_PATTERN, readMappingFile, scanTestSources, type TestSourceSpec } from './testScanner.js';
import { globFiles } from './glob.js';
import type { Requirement, TestRef, TraceReport } from './types.js';

/** Resolve a config-relative path against the directory the config lives in. */
function rel(baseDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

/** Gather requirements for one source entry. Network for jira/confluence; local for markdown/roadmap. */
async function loadRequirements(
  source: RequirementSource,
  baseDir: string,
  keyPattern: string,
  scope?: string,
): Promise<Requirement[]> {
  switch (source.type) {
    case 'jira-epic':
      return fetchJiraRequirements(source.epic, {
        includeEpic: source.includeEpic,
        recursive: source.recursive,
        doneStatuses: source.doneStatuses,
        scope,
      });
    case 'confluence-page':
      return fetchConfluenceRequirements(source.pageId, { keyPattern, scope });
    case 'markdown':
      return parseMarkdownRequirements(readFileSync(rel(baseDir, source.path), 'utf8'), keyPattern, 'markdown', scope);
    case 'roadmap-html':
      return parseRoadmapHtml(readFileSync(rel(baseDir, source.path), 'utf8'), keyPattern, scope);
    case 'github-issues':
      return fetchGithubRequirements(source, scope);
    case 'gitlab-issues':
      return fetchGitlabRequirements(source, scope);
    case 'command':
      return runCommandRequirements(source, baseDir, keyPattern, scope);
    default:
      return [];
  }
}

/** Collect refs + result files for one scope. */
function loadScopeTests(
  scope: TraceScope,
  repoDir: string,
  baseDir: string,
  keyPattern: string,
): { refs: TestRef[]; resultFiles: string[] } {
  const specs: TestSourceSpec[] = scope.tests.map((t) => ({ tech: t.tech, globs: t.globs }));
  const refs = scanTestSources(repoDir, specs, keyPattern);
  if (scope.mapping) refs.push(...readMappingFile(rel(baseDir, scope.mapping)));

  const resultFiles: string[] = [];
  for (const t of scope.tests) {
    if (!t.results) continue;
    resultFiles.push(...globFiles(repoDir, t.results).map((f) => resolve(repoDir, f)));
  }
  return { refs, resultFiles };
}

/** Options controlling side effects of a trace run. */
export interface RunTraceOptions {
  /** Execute each test group's `command` before ingesting results (default false). */
  run?: boolean;
  /** Persist this run to the history dir (default true when `history` is configured). */
  save?: boolean;
  /** Diff against the previous run / baseline (default true when `history` is configured). */
  compare?: boolean;
  /** Stream each executed command's output line-by-line (the portal uses this for live status). */
  onLine?: (line: string) => void;
}

/** A trace result plus any command runs that produced it. */
export interface TraceRunResult {
  report: TraceReport;
  commands: CommandRun[];
}

/** Build a TraceReport from a validated config, optionally running suites + recording history. */
export async function runTrace(config: TraceConfig, baseDir: string, opts: RunTraceOptions = {}): Promise<TraceReport> {
  return (await runTraceDetailed(config, baseDir, opts)).report;
}

/** Like `runTrace` but also returns the command outcomes (for the portal / verbose CLI). */
export async function runTraceDetailed(
  config: TraceConfig,
  baseDir: string,
  opts: RunTraceOptions = {},
): Promise<TraceRunResult> {
  const keyPattern = config.keyPattern ?? DEFAULT_KEY_PATTERN;
  const repoDir = rel(baseDir, config.repoDir ?? '.');

  // 1. Optionally (re)run the suites so they regenerate their result files.
  let commands: CommandRun[] = [];
  if (opts.run) {
    const specs: RunnableSpec[] = config.scopes.flatMap((s) =>
      s.tests.map((t) => ({ tech: t.tech, command: t.command, cwd: t.cwd })),
    );
    commands = await execCommands(specs, repoDir, opts.onLine);
  }

  // 2. Gather requirements + test refs + result files.
  const requirements: Requirement[] = [];
  const refs: TestRef[] = [];
  const resultFiles: string[] = [];
  for (const scope of config.scopes) {
    for (const source of scope.requirements) {
      requirements.push(...(await loadRequirements(source, baseDir, keyPattern, scope.name)));
    }
    const scopeTests = loadScopeTests(scope, repoDir, baseDir, keyPattern);
    refs.push(...scopeTests.refs);
    resultFiles.push(...scopeTests.resultFiles);
  }

  // 3. Join everything at the current commit.
  const ingested = ingestResults([...new Set(resultFiles)], keyPattern);
  const report = computeReport({
    requirements,
    refs,
    ingested,
    git: getGitContext(repoDir),
    generatedAt: new Date().toISOString(),
    project: config.project,
  });
  markStale(report, repoDir);

  // 4. History: diff against the prior run, then persist this one.
  if (config.history) {
    const historyDir = rel(baseDir, config.history.dir);
    if (opts.compare !== false) {
      const prev = loadBaseline(historyDir, config.history.baseline);
      if (prev) applyDiff(report, prev);
    }
    if (opts.save !== false) {
      saveRun(report, historyDir);
      if (config.history.keep) pruneRuns(historyDir, config.history.keep);
    }
  }

  return { report, commands };
}

/** Look up one requirement's current state (agent-friendly "is KEY verified?"). */
export async function requirementStatus(config: TraceConfig, baseDir: string, key: string) {
  const report = await runTrace(config, baseDir, { save: false });
  return report.requirements.find((r) => r.key.toUpperCase() === key.toUpperCase()) ?? null;
}

/** Render a report to every output format. */
export function renderAll(report: TraceReport): { markdown: string; html: string; json: string } {
  return { markdown: renderMarkdown(report), html: renderHtml(report), json: `${JSON.stringify(report, null, 2)}\n` };
}
