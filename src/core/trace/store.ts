/**
 * The `.acp/` store — Katastasi's tidy home in a repo. New writes go under `.acp/`, but legacy
 * root-level dirs (`requirements/`, `runs/`, `tech-analysis/`) are still read for back-compat, and
 * `katastasi migrate` moves them in. Config (`acp-trace.json`) stays at the repo root.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ACP_DIR = '.acp';

/** Store sub-dirs that have a legacy root location for back-compat. */
export const LEGACY_STORE_DIRS = ['requirements', 'runs', 'tech-analysis'] as const;
export type StoreDirName = (typeof LEGACY_STORE_DIRS)[number];

/** Absolute path of the `.acp/` dir for a repo. */
export function acpDir(baseDir: string): string {
  return join(baseDir, ACP_DIR);
}

/**
 * Resolve a store dir (absolute): prefer `.acp/<name>` if it exists, else legacy root `<name>` if it
 * exists, else default new writes to `.acp/<name>`.
 */
export function resolveStoreDir(baseDir: string, name: StoreDirName): string {
  const acp = join(baseDir, ACP_DIR, name);
  if (isDir(acp)) return acp;
  const legacy = join(baseDir, name);
  if (isDir(legacy)) return legacy;
  return acp; // default new writes into .acp/
}

/** Absolute tasks dir (always under `.acp/` by default; honours a configured `tasks.dir`). */
export function tasksDir(baseDir: string, dir: string = `${ACP_DIR}/tasks`): string {
  return join(baseDir, dir);
}

/** Absolute path of the store manifest (id counters; sync revisions in Phase 3). */
export function manifestPath(baseDir: string): string {
  return join(baseDir, ACP_DIR, 'manifest.json');
}

export interface MigrateResult {
  moved: StoreDirName[];
  skipped: string[];
}

/**
 * Move any legacy root store dirs (`requirements/`, `runs/`, `tech-analysis/`) into `.acp/`.
 * Idempotent: a dir that's absent, or whose `.acp/` target already exists, is skipped.
 */
export function migrateStore(baseDir: string): MigrateResult {
  const moved: StoreDirName[] = [];
  const skipped: string[] = [];
  mkdirSync(acpDir(baseDir), { recursive: true });
  for (const name of LEGACY_STORE_DIRS) {
    const legacy = join(baseDir, name);
    const target = join(baseDir, ACP_DIR, name);
    if (!isDir(legacy)) continue;
    if (existsSync(target)) {
      skipped.push(`${name} (.acp/${name} already exists)`);
      continue;
    }
    renameSync(legacy, target);
    moved.push(name);
  }
  return { moved, skipped };
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True if a directory has any entries (used to decide whether a legacy dir is worth migrating). */
export function dirHasEntries(path: string): boolean {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}
