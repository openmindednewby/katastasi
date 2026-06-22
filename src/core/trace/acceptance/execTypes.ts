/**
 * Shared types for the step executors (HTTP + process). `ExecContext` carries the runner config and the
 * mutable `vars` bag that capture writes into and interpolation reads from. `StepResult` is the
 * per-step outcome the case runner aggregates and the JUnit emitter renders.
 */
import type { Vars } from './interpolate.js';

export interface ExecContext {
  baseUrl?: string; // prepended to relative step URLs
  headers?: Record<string, string>; // default headers merged under each step's
  env?: NodeJS.ProcessEnv; // source for {{env.X}} (defaults to process.env)
  vars: Vars; // mutable capture bag, shared across a case's steps
  fetchImpl?: typeof fetch; // injectable for tests (defaults to global fetch)
  cwd?: string; // base working dir for process steps
}

export interface StepResult {
  ok: boolean;
  failures: string[]; // assertion failures (human-readable)
  request: string; // e.g. "POST http://…/login" or "run node cli.js"
  status?: number; // HTTP status
  exit?: number; // process exit code
  error?: string; // transport / spawn error (distinct from an assertion failure)
  captured?: Record<string, unknown>; // variables captured by this step
}
