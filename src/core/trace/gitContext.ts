/**
 * Resolve the git commit a traceability report reflects, so "which requirements hold true"
 * is always answered at a specific code version. Degrades gracefully (all-null) outside a repo.
 */
import { execFileSync } from 'node:child_process';
import type { GitContext } from './types.js';

/** Run a git command in `dir`, returning trimmed stdout or null on any failure. */
function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Collect the git context (sha / branch / dirty / commit time) for `repoDir` (default cwd). */
export function getGitContext(repoDir: string = process.cwd()): GitContext {
  const sha = git(repoDir, ['rev-parse', 'HEAD']);
  const branch = git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = git(repoDir, ['status', '--porcelain']);
  const committedAt = git(repoDir, ['log', '-1', '--format=%cI']);
  return {
    sha,
    shortSha: sha ? sha.slice(0, 8) : null,
    branch: branch && branch !== 'HEAD' ? branch : branch,
    dirty: status !== null && status.length > 0,
    committedAt: committedAt || null,
  };
}
