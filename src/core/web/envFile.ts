/**
 * Local `.env` read/write for the web wizard's Connect step. The dev enters their Atlassian / GitHub
 * credentials once in the browser; the server upserts them into `.env` on their machine (nothing leaves
 * the PC). Status is reported as booleans only — tokens are never read back out or sent to the browser.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CRED_GROUPS = {
  jira: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'],
  confluence: ['CONFLUENCE_BASE_URL', 'CONFLUENCE_EMAIL', 'CONFLUENCE_API_TOKEN'],
  github: ['GITHUB_TOKEN'],
} as const;

export type CredGroup = keyof typeof CRED_GROUPS;
export type EnvStatus = Record<CredGroup, boolean>;

function envPath(baseDir: string): string {
  return join(baseDir, '.env');
}

/** Parse a `.env` into a key→value map (ignores comments/blank lines; strips simple quotes). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

function readEnvMap(baseDir: string): Record<string, string> {
  const path = envPath(baseDir);
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

/** A key counts as set if it's non-empty in `.env` or already in the process environment. */
function isSet(key: string, env: Record<string, string>, processEnv: NodeJS.ProcessEnv): boolean {
  return !!(env[key]?.trim() || processEnv[key]?.trim());
}

/** Which credential groups are fully configured (booleans only — never the values). */
export function readEnvStatus(baseDir: string, processEnv: NodeJS.ProcessEnv = process.env): EnvStatus {
  const env = readEnvMap(baseDir);
  const status = {} as EnvStatus;
  for (const group of Object.keys(CRED_GROUPS) as CredGroup[]) {
    status[group] = CRED_GROUPS[group].every((k) => isSet(k, env, processEnv));
  }
  return status;
}

/** Upsert non-empty keys into `.env`, preserving every other line. Returns the keys written. */
export function writeEnvKeys(baseDir: string, kv: Record<string, string>): string[] {
  const entries = Object.entries(kv).filter(([, v]) => typeof v === 'string' && v.trim());
  if (!entries.length) return [];
  const path = envPath(baseDir);
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const written: string[] = [];
  for (const [key, value] of entries) {
    const v = value.trim();
    const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (idx === -1) lines.push(`${key}=${v}`);
    else lines[idx] = `${key}=${v}`;
    written.push(key);
  }
  writeFileSync(path, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  return written;
}
