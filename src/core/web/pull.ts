/**
 * Slice 3 — pull the confirmed items to markdown. For each selected discovered item we refetch its
 * content (Jira description / Confluence body, already markdown via the DiscoverClient) and write a
 * per-item file, plus an `index.md` that lists Jira items as requirement checkbox lines (so `analyze` /
 * `trace` pick up their keys) and Confluence pages as reference docs. Robust: a broken item is skipped,
 * not fatal. Pure over the injectable client → network-free tests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoverClient } from './discover.js';

export interface PullItem {
  type: 'jira' | 'confluence';
  id: string;
}

export interface PullResult {
  written: string[]; // file names written under outDir
  requirementsFile: string; // the index the config can point at
  skipped: Array<{ id: string; error: string }>;
}

function safe(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

interface Fetched {
  type: 'jira' | 'confluence';
  id: string;
  title: string;
  body: string;
  url?: string;
}

function fileContent(f: Fetched): string {
  const link = f.url ? `\n> source: ${f.type} · ${f.url}\n` : `\n> source: ${f.type}\n`;
  return `# ${f.id} — ${f.title}\n${link}\n${f.body.trim()}\n`;
}

function indexContent(items: Fetched[]): string {
  const jira = items.filter((i) => i.type === 'jira');
  const pages = items.filter((i) => i.type === 'confluence');
  const lines = [`# Requirements`, '', `_Pulled ${items.length} item(s) via the Katastasi wizard._`, ''];
  if (jira.length) {
    for (const i of jira) lines.push(`- [ ] ${i.id} ${i.title}`);
  }
  if (pages.length) {
    lines.push('', '## Reference docs', '');
    for (const p of pages) lines.push(`- [${p.title}](${safe(p.id)}.md) (page ${p.id})`);
  }
  return lines.join('\n') + '\n';
}

/** Pull the selected items into `outDir` as markdown + an index. */
export async function pullSelected(items: PullItem[], client: DiscoverClient, outDir: string): Promise<PullResult> {
  mkdirSync(outDir, { recursive: true });
  const fetched: Fetched[] = [];
  const skipped: PullResult['skipped'] = [];

  for (const it of items) {
    try {
      const data = it.type === 'jira' ? await client.jiraIssue(it.id) : await client.confluencePage(it.id);
      const f: Fetched = { type: it.type, id: it.id, title: (data.title || it.id).trim(), body: data.body ?? '', url: data.url };
      fetched.push(f);
    } catch (err) {
      skipped.push({ id: it.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const written: string[] = [];
  for (const f of fetched) {
    const name = `${safe(f.id)}.md`;
    writeFileSync(join(outDir, name), fileContent(f), 'utf8');
    written.push(name);
  }
  const requirementsFile = 'index.md';
  writeFileSync(join(outDir, requirementsFile), indexContent(fetched), 'utf8');

  return { written, requirementsFile, skipped };
}
