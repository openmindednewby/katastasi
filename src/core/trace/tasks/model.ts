/**
 * Task model — the data layer for Phase 1 task tracking. Tasks are markdown files with YAML-ish
 * frontmatter under `.acp/tasks/` (markdown is the source of truth); the store manifest holds
 * per-prefix id counters. This module is pure IO + parsing; status validation, date stamping, and the
 * honesty cross-check live in the ops/verify layers.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { manifestPath } from '../store.js';

export interface Task {
  id: string;
  title: string;
  status: string;
  requirements: string[]; // requirement keys (many-to-many)
  tests: string[]; // optional explicit test refs; coverage is otherwise derived via requirements
  assignee: string | null;
  source: 'local' | 'jira'; // jira = read-only cached import
  created: string; // ISO date (YYYY-MM-DD)
  updated: string;
  body: string;
}

// ── Frontmatter (minimal, tailored to task fields — not a general YAML parser) ──────────────

function unquote(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

function parseScalarOrArray(val: string): string | string[] | null {
  if (val === '' || val === '~' || val === 'null') return null;
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter((s) => s.length > 0);
  }
  return unquote(val);
}

function parseFrontmatter(md: string): { fm: Record<string, string | string[] | null>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: md.trim() };
  const fm: Record<string, string | string[] | null> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    fm[key] = parseScalarOrArray(line.slice(idx + 1).trim());
  }
  return { fm, body: (m[2] ?? '').trim() };
}

/** Quote a scalar only if it contains frontmatter-significant characters. */
function scalar(s: string): string {
  return /[:#[\]"'\n]/.test(s) ? JSON.stringify(s) : s;
}

// ── Serialize / parse a task ────────────────────────────────────────────────────────────────

export function serializeTask(t: Task): string {
  const arr = (a: string[]) => `[${a.map((x) => (/[,\s[\]]/.test(x) ? JSON.stringify(x) : x)).join(', ')}]`;
  return [
    '---',
    `id: ${t.id}`,
    `title: ${scalar(t.title)}`,
    `status: ${t.status}`,
    `requirements: ${arr(t.requirements)}`,
    `tests: ${arr(t.tests)}`,
    `assignee: ${t.assignee ? scalar(t.assignee) : '~'}`,
    `source: ${t.source}`,
    `created: ${t.created}`,
    `updated: ${t.updated}`,
    '---',
    '',
    t.body.trim(),
    '',
  ].join('\n');
}

export function parseTask(md: string): Task {
  const { fm, body } = parseFrontmatter(md);
  const str = (k: string, d = '') => (typeof fm[k] === 'string' ? (fm[k] as string) : d);
  const list = (k: string) => (Array.isArray(fm[k]) ? (fm[k] as string[]) : []);
  return {
    id: str('id'),
    title: str('title'),
    status: str('status'),
    requirements: list('requirements'),
    tests: list('tests'),
    assignee: typeof fm.assignee === 'string' ? fm.assignee : null,
    source: str('source') === 'jira' ? 'jira' : 'local',
    created: str('created'),
    updated: str('updated'),
    body,
  };
}

// ── File IO ─────────────────────────────────────────────────────────────────────────────────

export function taskFileName(id: string): string {
  return `${id}.md`;
}

export function readTask(path: string): Task {
  return parseTask(readFileSync(path, 'utf8'));
}

/** Write a task to `<dir>/<id>.md` (creates dir). Returns the path. */
export function writeTask(dir: string, t: Task): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, taskFileName(t.id));
  writeFileSync(path, serializeTask(t), 'utf8');
  return path;
}

/** Read every task `*.md` under `tasksRoot` (recurses into per-scope subfolders). */
export function listTasks(tasksRoot: string): Task[] {
  if (!existsSync(tasksRoot)) return [];
  const out: Task[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.md')) out.push(readTask(p));
    }
  };
  walk(tasksRoot);
  return out;
}

/** Find a task's file path by id under `tasksRoot` (searches subfolders); null if absent. */
export function findTaskPath(tasksRoot: string, id: string): string | null {
  if (!existsSync(tasksRoot)) return null;
  let found: string | null = null;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (found) return;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry === taskFileName(id)) found = p;
    }
  };
  walk(tasksRoot);
  return found;
}

// ── Manifest (per-prefix id counters; preserves other manifest keys for Phase 3 sync) ─────────

function readRawManifest(baseDir: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(manifestPath(baseDir), 'utf8')) as Record<string, unknown>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Current id counters (e.g. `{ TASK: 3, WEB: 1 }`). */
export function readTaskCounters(baseDir: string): Record<string, number> {
  const c = readRawManifest(baseDir).counters;
  return c && typeof c === 'object' ? (c as Record<string, number>) : {};
}

/** Allocate the next id for a prefix (e.g. `TASK-4`), persisting the bumped counter. */
export function allocateId(baseDir: string, prefix: string): string {
  const raw = readRawManifest(baseDir);
  const counters = (raw.counters && typeof raw.counters === 'object' ? raw.counters : {}) as Record<string, number>;
  const next = (counters[prefix] ?? 0) + 1;
  counters[prefix] = next;
  raw.version = (raw.version as number) ?? 1;
  raw.counters = counters;
  mkdirSync(dirname(manifestPath(baseDir)), { recursive: true });
  writeFileSync(manifestPath(baseDir), `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return `${prefix}-${next}`;
}
