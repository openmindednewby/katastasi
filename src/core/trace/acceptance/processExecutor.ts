/**
 * Process/CLI step executor — spawns a `run` command line through the shell, captures stdout/stderr and
 * the exit code, then runs the step's assertions (exit code, body/stdout-contains). Variables can be
 * captured from `stdout` / `stderr` / `exit` for later steps. The command is interpolated against the
 * capture bag + env before spawning; a default timeout guards against hangs.
 */
import { spawn } from 'node:child_process';
import { checkExpect, type Actual } from './assert.js';
import { interpolateString } from './interpolate.js';
import type { ProcessStep } from './model.js';
import type { ExecContext, StepResult } from './execTypes.js';

const DEFAULT_TIMEOUT_MS = 30_000;

interface RawRun {
  exit: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function runCommand(cmd: string, cwd: string | undefined, env: NodeJS.ProcessEnv): Promise<RawRun> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd, env: { ...process.env, ...env }, timeout: DEFAULT_TIMEOUT_MS });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', (err) => resolve({ exit: null, stdout, stderr, error: err.message }));
    child.on('close', (code) => resolve({ exit: code, stdout, stderr }));
  });
}

function applyCapture(spec: Record<string, string>, raw: RawRun): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, src] of Object.entries(spec)) {
    if (src === 'exit') out[name] = raw.exit;
    else if (src === 'stderr') out[name] = raw.stderr.trim();
    else out[name] = raw.stdout.trim(); // 'stdout' (default)
  }
  return out;
}

export async function executeProcessStep(step: ProcessStep, ctx: ExecContext): Promise<StepResult> {
  const env = ctx.env ?? process.env;
  const cmd = interpolateString(step.run, ctx.vars, env);
  const request = `run ${cmd}`;
  const raw = await runCommand(cmd, step.cwd ?? ctx.cwd, env);
  if (raw.error) return { ok: false, failures: [`process error: ${raw.error}`], request, error: raw.error };
  if (raw.exit === null) return { ok: false, failures: ['process timed out or was killed'], request, error: 'killed' };

  const actual: Actual = { exit: raw.exit, body: raw.stdout + raw.stderr };
  const failures = checkExpect(step.expect, actual);
  const captured = step.capture ? applyCapture(step.capture, raw) : undefined;
  if (captured) Object.assign(ctx.vars, captured);
  return { ok: failures.length === 0, failures, request, exit: raw.exit, captured };
}
