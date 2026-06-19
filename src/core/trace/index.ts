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
import { fetchJiraRequirements } from './requirements/jiraEpic.js';
import { parseMarkdownRequirements } from './requirements/markdown.js';
import { parseRoadmapHtml } from './requirements/roadmapHtml.js';
import { ingestResults } from './results.js';
import { renderHtml } from './report/html.js';
import { renderMarkdown } from './report/markdown.js';
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

/** Build a TraceReport from a validated config. `baseDir` = directory the config paths resolve against. */
export async function runTrace(config: TraceConfig, baseDir: string): Promise<TraceReport> {
  const keyPattern = config.keyPattern ?? DEFAULT_KEY_PATTERN;
  const repoDir = rel(baseDir, config.repoDir ?? '.');

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

  const ingested = ingestResults([...new Set(resultFiles)], keyPattern);
  return computeReport({
    requirements,
    refs,
    ingested,
    git: getGitContext(repoDir),
    generatedAt: new Date().toISOString(),
    project: config.project,
  });
}

/** Render a report to every output format. */
export function renderAll(report: TraceReport): { markdown: string; html: string; json: string } {
  return { markdown: renderMarkdown(report), html: renderHtml(report), json: `${JSON.stringify(report, null, 2)}\n` };
}
