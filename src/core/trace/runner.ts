/**
 * Optional test execution. When a test-source group declares a `command`, `acp trace --run` executes
 * it (in `cwd`, via the shell) so the suite re-produces its JUnit/TRX files before they're ingested.
 * A non-zero exit does NOT abort the trace — the resulting failures show up in the report on their own.
 */
import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

const DEFAULT_TIMEOUT_MS = 600_000; // 10 min per suite
const MAX_OUTPUT = 4_000; // keep captured output bounded

/** One runnable test group. */
export interface RunnableSpec {
  tech: string;
  command?: string;
  cwd?: string;
}

/** Outcome of executing one suite command. */
export interface CommandRun {
  tech: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  ok: boolean;
  durationMs: number;
  /** Tail of combined stdout+stderr, truncated. */
  output: string;
}

/** Execute one suite command and capture a bounded outcome. */
export function runCommand(spec: RunnableSpec & { command: string }, repoDir: string, now: () => number): CommandRun {
  const cwd = spec.cwd ? (isAbsolute(spec.cwd) ? spec.cwd : resolve(repoDir, spec.cwd)) : repoDir;
  const started = now();
  const res = spawnSync(spec.command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const combined = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return {
    tech: spec.tech,
    command: spec.command,
    cwd,
    exitCode: res.status,
    ok: res.status === 0,
    durationMs: now() - started,
    output: combined.length > MAX_OUTPUT ? `…${combined.slice(-MAX_OUTPUT)}` : combined,
  };
}

/** Run every spec that has a command. Specs without a command are skipped (ingest-only). */
export function runCommands(
  specs: RunnableSpec[],
  repoDir: string,
  now: () => number = () => Date.now(),
): CommandRun[] {
  return specs
    .filter((s): s is RunnableSpec & { command: string } => Boolean(s.command))
    .map((s) => runCommand(s, repoDir, now));
}
