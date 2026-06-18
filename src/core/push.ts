/**
 * Re-publish a pulled markdown folder back to Jira / Confluence, recursively.
 *
 * The complement to `pull`: reads the `acp-pull.json` manifest written by a pull, converts each
 * markdown file back (markdown → ADF / storage), and updates the matching issue/page in place via
 * direct REST — including sub-tasks and child pages, which the flat n8n re-publish cannot express.
 * Manifest entries without a key/id are created (parent links remapped to freshly-created ids).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToAdf } from './markdownToAdf.js';
import { markdownToStorage } from './markdownToStorage.js';
import {
  createIssue,
  createPage,
  getPage,
  updateIssue,
  updatePage,
  type IssueRef,
} from './atlassian.js';
import { ensureEnvLoaded, getConfluenceCreds, getJiraCreds } from './config.js';
import type { PushFolderResult, PushOptions, PushedIssue, PushedPage } from './types.js';

const MANIFEST_NAME = 'acp-pull.json';
const META_HEADERS = new Set(['priority', 'component', 'components', 'labels', 'estimate']);
const AUTO_LABEL = 'n8n-pipeline-generated';

interface JiraManifest {
  kind: 'jira';
  issues: Array<{ file: string; key?: string; type: string; parentKey: string | null }>;
}
interface ConfluenceManifest {
  kind: 'confluence';
  pages: Array<{ dir: string; pageId?: string; parentPageId: string | null; title?: string }>;
}

/** Read a folder's manifest and re-publish its tree. Dispatches on manifest `kind`. */
export async function pushFolder(dir: string, opts: PushOptions = {}): Promise<PushFolderResult> {
  const manifest = readManifest(dir);
  if (manifest.kind === 'jira') return pushJiraFolder(dir, manifest as JiraManifest, opts);
  if (manifest.kind === 'confluence') return pushConfluenceFolder(dir, manifest as ConfluenceManifest, opts);
  throw new Error(`Unsupported manifest kind "${(manifest as { kind?: string }).kind}" in ${MANIFEST_NAME}.`);
}

/* ── Jira ──────────────────────────────────────────────────────────────────── */

async function pushJiraFolder(dir: string, manifest: JiraManifest, opts: PushOptions): Promise<PushFolderResult> {
  ensureEnvLoaded();
  const creds = getJiraCreds();
  const projectKey = process.env.JIRA_PROJECT_KEY;
  const epicType = process.env.JIRA_EPIC_ISSUE_TYPE || 'Epic';
  const keyMap = new Map<string, string>(); // manifest key → live key
  const issues: PushedIssue[] = [];

  for (const entry of manifest.issues) {
    const parsed = parseIssueMarkdown(readFileSync(join(dir, entry.file), 'utf8'));
    const liveParent = entry.parentKey ? keyMap.get(entry.parentKey) ?? entry.parentKey : null;
    const url = (key: string): string => `${creds.baseUrl}/browse/${key}`;

    if (entry.key) {
      // Update in place — do not touch issuetype/parent on update.
      const fields = jiraFields(parsed, null, null);
      if (opts.dryRun) {
        issues.push({ file: entry.file, key: entry.key, action: 'would-update', url: url(entry.key) });
      } else {
        await updateIssue(entry.key, fields, creds);
        keyMap.set(entry.key, entry.key);
        issues.push({ file: entry.file, key: entry.key, action: 'updated', url: url(entry.key) });
      }
      continue;
    }

    // Create — needs project + issue type + (optional) parent.
    if (!projectKey) throw new Error('JIRA_PROJECT_KEY must be set in .env to create new issues.');
    const issueType = entry.type === 'epic' ? epicType : entry.type;
    const fields = jiraFields(parsed, { projectKey, issueType }, liveParent);
    if (opts.dryRun) {
      issues.push({ file: entry.file, key: '(new)', action: 'would-create', url: '' });
    } else {
      const created: IssueRef = await createIssue(fields, creds);
      issues.push({ file: entry.file, key: created.key, action: 'created', url: url(created.key) });
    }
  }

  return { kind: 'jira', dir, issues };
}

/** Build a Jira `fields` object from parsed markdown. Pass `create` to include project/type. */
function jiraFields(
  parsed: ParsedIssue,
  create: { projectKey: string; issueType: string } | null,
  parentKey: string | null,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    summary: parsed.title,
    description: markdownToAdf(parsed.body),
  };
  if (parsed.priority) fields.priority = { name: parsed.priority };
  if (parsed.labels.length > 0) fields.labels = parsed.labels;
  if (create) {
    fields.project = { key: create.projectKey };
    fields.issuetype = { name: create.issueType };
    if (parentKey) fields.parent = { key: parentKey };
  }
  return fields;
}

/* ── Confluence ────────────────────────────────────────────────────────────── */

async function pushConfluenceFolder(
  dir: string,
  manifest: ConfluenceManifest,
  opts: PushOptions,
): Promise<PushFolderResult> {
  ensureEnvLoaded();
  const creds = getConfluenceCreds();
  const spaceKey = process.env.CONFLUENCE_SPACE_KEY;
  const mermaidMacro = process.env.CONFLUENCE_MERMAID_MACRO || undefined;
  const idMap = new Map<string, string>(); // manifest id → live id
  const pages: PushedPage[] = [];

  for (const entry of manifest.pages) {
    const fileDir = entry.dir === '.' ? dir : join(dir, entry.dir);
    const parsed = parsePageMarkdown(readFileSync(join(fileDir, 'page.md'), 'utf8'), entry.title);
    const storage = markdownToStorage(parsed.body, mermaidMacro);
    const liveParent = entry.parentPageId ? idMap.get(entry.parentPageId) ?? entry.parentPageId : null;
    const url = (id: string): string => `${creds.baseUrl}/wiki/pages/viewpage.action?pageId=${id}`;

    if (entry.pageId) {
      if (opts.dryRun) {
        pages.push({ dir: entry.dir, pageId: entry.pageId, action: 'would-update', url: url(entry.pageId) });
        idMap.set(entry.pageId, entry.pageId);
        continue;
      }
      const current = await getPage(entry.pageId, creds);
      const version = (current.version?.number ?? 1) + 1;
      const body = confluenceBody(parsed.title, storage, spaceKey, { version });
      const updated = await updatePage(entry.pageId, body, creds);
      idMap.set(entry.pageId, updated.id ?? entry.pageId);
      pages.push({ dir: entry.dir, pageId: updated.id ?? entry.pageId, action: 'updated', url: url(updated.id ?? entry.pageId) });
      continue;
    }

    if (!spaceKey) throw new Error('CONFLUENCE_SPACE_KEY must be set in .env to create new pages.');
    if (opts.dryRun) {
      pages.push({ dir: entry.dir, pageId: '(new)', action: 'would-create', url: '' });
      continue;
    }
    const body = confluenceBody(parsed.title, storage, spaceKey, { ancestorId: liveParent });
    const created = await createPage(body, creds);
    idMap.set(`pending:${entry.dir}`, created.id);
    pages.push({ dir: entry.dir, pageId: created.id, action: 'created', url: url(created.id) });
  }

  return { kind: 'confluence', dir, pages };
}

/** Build a Confluence content payload for create (with optional ancestor) or update (with version). */
function confluenceBody(
  title: string,
  storage: string,
  spaceKey: string | undefined,
  opts: { version?: number; ancestorId?: string | null },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: 'page',
    title,
    body: { storage: { value: storage, representation: 'storage' } },
  };
  if (spaceKey) body.space = { key: spaceKey };
  if (opts.version) body.version = { number: opts.version };
  if (opts.ancestorId) body.ancestors = [{ id: opts.ancestorId }];
  return body;
}

/* ── Markdown parsing (reverse of the forward-format emit) ──────────────────── */

interface ParsedIssue {
  title: string;
  body: string;
  priority: string | null;
  component: string | null;
  labels: string[];
}

/** Parse a pulled issue markdown file back into title, description body, and metadata fields. */
export function parseIssueMarkdown(md: string): ParsedIssue {
  const lines = md.replace(/\r/g, '').split('\n');
  let title = '';
  const bodyLines: string[] = [];
  const meta: Record<string, string[]> = {};
  let current: string | null = null;

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    if (!title && h1) {
      title = h1[1].trim();
      continue;
    }
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2 && META_HEADERS.has(h2[1].toLowerCase())) {
      current = h2[1].toLowerCase();
      meta[current] = [];
      continue;
    }
    if (h2) {
      current = null; // a non-meta section → part of the description body
    }
    if (current) {
      meta[current].push(line);
    } else {
      bodyLines.push(line);
    }
  }

  const get = (k: string): string => (meta[k] ?? []).join('\n').trim();
  const labels = get('labels')
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l && l !== AUTO_LABEL);

  return {
    title: title || '(untitled)',
    body: bodyLines.join('\n').trim(),
    priority: get('priority') || null,
    component: get('component') || get('components') || null,
    labels,
  };
}

/** Parse a pulled page markdown file into title (from `# ` or manifest) and body. */
export function parsePageMarkdown(md: string, fallbackTitle?: string): { title: string; body: string } {
  const lines = md.replace(/\r/g, '').split('\n');
  const idx = lines.findIndex((l) => /^#\s+.+/.test(l));
  if (idx === -1) return { title: (fallbackTitle ?? '(untitled)').trim(), body: md.trim() };
  const title = lines[idx].replace(/^#\s+/, '').trim();
  const body = lines.slice(idx + 1).join('\n').trim();
  return { title: title || (fallbackTitle ?? '(untitled)').trim(), body };
}

/** Read and parse the manifest at the folder root. */
function readManifest(dir: string): { kind: string } {
  let raw: string;
  try {
    raw = readFileSync(join(dir, MANIFEST_NAME), 'utf8');
  } catch {
    throw new Error(`No ${MANIFEST_NAME} found in "${dir}". Run a pull first (it writes the manifest).`);
  }
  try {
    return JSON.parse(raw) as { kind: string };
  } catch {
    throw new Error(`${MANIFEST_NAME} in "${dir}" is not valid JSON.`);
  }
}
