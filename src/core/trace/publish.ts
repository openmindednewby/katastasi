/**
 * Sinks for a TraceReport. The report is one canonical object; publishing is a separate, configurable
 * step: write files (markdown/html/json), fold a section into an existing doc (roadmap), or update a
 * Confluence page in place. Confluence reuses the direct-REST client + the markdown→storage converter.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { getPage, modifyIssueLabels, updatePage, pageWebUrl } from '../atlassian.js';
import { getConfluenceCreds } from '../config.js';
import { markdownToStorage } from '../markdownToStorage.js';
import type { TraceConfig } from './config.js';
import { renderHtml } from './report/html.js';
import { renderMarkdown } from './report/markdown.js';
import { updateSection } from './sectionUpdater.js';
import type { TraceReport } from './types.js';

function abs(baseDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** Write the configured markdown / html / json outputs; returns the paths written. */
export function writeOutputs(report: TraceReport, output: TraceConfig['output'], baseDir: string): string[] {
  const written: string[] = [];
  if (!output) return written;
  if (output.markdown) {
    writeFile(abs(baseDir, output.markdown), renderMarkdown(report));
    written.push(output.markdown);
  }
  if (output.html) {
    writeFile(abs(baseDir, output.html), renderHtml(report));
    written.push(output.html);
  }
  if (output.json) {
    writeFile(abs(baseDir, output.json), `${JSON.stringify(report, null, 2)}\n`);
    written.push(output.json);
  }
  return written;
}

/** The report as a nestable section (H1 demoted to H2) for embedding in another doc. */
export function reportSection(report: TraceReport): string {
  return renderMarkdown(report).replace(/^# /, '## ');
}

/** Fold the report into an existing markdown doc between `acp:trace` markers; returns the path. */
export function updateRoadmapSection(
  report: TraceReport,
  roadmap: { path: string; sectionId: string },
  baseDir: string,
): string {
  const path = abs(baseDir, roadmap.path);
  let doc = '';
  try {
    doc = readFileSync(path, 'utf8');
  } catch {
    doc = '';
  }
  writeFile(path, updateSection(doc, roadmap.sectionId, reportSection(report)));
  return roadmap.path;
}

/** Which Jira issues should gain / lose the verified label, based on the report. Pure. */
export function planJiraLabelStamp(report: TraceReport, label: string): { toAdd: string[]; toRemove: string[] } {
  const toAdd: string[] = [];
  const toRemove: string[] = [];
  for (const r of report.requirements) {
    if (r.source !== 'jira-epic') continue; // only stamp real Jira issues we resolved
    (r.state === 'verified' ? toAdd : toRemove).push(r.key);
  }
  return { toAdd, toRemove };
}

/** Stamp `verifiedLabel` onto verified Jira issues (and remove it from no-longer-verified ones). */
export async function stampJiraLabels(
  report: TraceReport,
  jira: { verifiedLabel?: string },
): Promise<{ added: number; removed: number }> {
  const label = jira.verifiedLabel;
  if (!label) return { added: 0, removed: 0 };
  const { toAdd, toRemove } = planJiraLabelStamp(report, label);
  for (const key of toAdd) await modifyIssueLabels(key, [label], []);
  for (const key of toRemove) await modifyIssueLabels(key, [], [label]);
  return { added: toAdd.length, removed: toRemove.length };
}

/** Update an existing Confluence page in place with the rendered report. Returns the page URL. */
export async function publishConfluenceReport(
  report: TraceReport,
  conf: { pageId: string; title?: string },
): Promise<string> {
  const creds = getConfluenceCreds();
  const page = await getPage(conf.pageId, creds);
  const version = (page.version?.number ?? 1) + 1;
  const title = conf.title ?? page.title ?? 'Requirements Traceability';
  const storage = markdownToStorage(renderMarkdown(report));
  await updatePage(
    conf.pageId,
    { id: conf.pageId, type: 'page', title, version: { number: version }, body: { storage: { value: storage, representation: 'storage' } } },
    creds,
  );
  return pageWebUrl(page, creds);
}
