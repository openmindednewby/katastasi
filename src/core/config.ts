/**
 * Configuration loader. Reads the repo `.env` (same file the bash/n8n flows use) and
 * exposes the values the publish layer needs. Stage 1 only needs the n8n webhook base URL.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_WEBHOOK_URL = 'http://localhost:10353/webhook';

let loaded = false;

/** Walk up from this file to find the project root (the dir containing `.env` or `package.json`). */
function findProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Load `.env` once, from the project root and the current working directory. */
export function ensureEnvLoaded(): void {
  if (loaded) return;
  const root = findProjectRoot();
  loadDotenv({ path: resolve(root, '.env') });
  loadDotenv({ path: resolve(process.cwd(), '.env') });
  loaded = true;
}

/** Which backend the publish layer targets. Stage 1 = `n8n`; `direct` is reserved for Stage 2. */
export type Backend = 'n8n' | 'direct';

export interface AcpConfig {
  backend: Backend;
  /** n8n webhook base URL, e.g. `http://localhost:10353/webhook` (no trailing slash). */
  webhookUrl: string;
}

/** Resolve the active configuration from the environment. */
export function getConfig(): AcpConfig {
  ensureEnvLoaded();
  const backend: Backend = process.env.ACP_BACKEND === 'direct' ? 'direct' : 'n8n';
  const webhookUrl = (process.env.WEBHOOK_URL || DEFAULT_WEBHOOK_URL).replace(/\/+$/, '');
  return { backend, webhookUrl };
}
