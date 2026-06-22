/**
 * Acceptance runner — gathers specs (files via globs; inline blocks are merged in by the caller) and
 * runs every case. Each case gets its OWN variable bag seeded from an optional one-time `setup`
 * (e.g. a login that captures a token shared by all cases), and a case stops at its first failing step.
 * Output is a flat list of per-case results plus pass/fail tallies — the shape the JUnit emitter renders.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globFiles } from '../glob.js';
import { parseSpecFile } from './parse/index.js';
import { executeHttpStep } from './httpExecutor.js';
import { executeProcessStep } from './processExecutor.js';
import type { AcceptanceCase, AcceptanceSpec, Step } from './model.js';
import type { ExecContext, StepResult } from './execTypes.js';
import type { Vars } from './interpolate.js';

export interface CaseResult {
  req: string;
  name: string;
  ok: boolean;
  steps: StepResult[];
  durationMs: number;
  failure?: string; // first failure summary (assertion or transport)
}

export interface AcceptanceRunResult {
  cases: CaseResult[];
  passed: number;
  failed: number;
  total: number;
}

export interface RunOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  setup?: AcceptanceCase; // one-time steps; captured vars seed every case
  vars?: Vars; // initial variables
  now?: () => number; // injectable clock (tests)
}

function runStep(step: Step, ctx: ExecContext): Promise<StepResult> {
  return step.kind === 'http' ? executeHttpStep(step, ctx) : executeProcessStep(step, ctx);
}

function firstFailure(steps: StepResult[]): string | undefined {
  const bad = steps.find((s) => !s.ok);
  if (!bad) return undefined;
  return `${bad.request} — ${bad.error ?? bad.failures.join('; ')}`;
}

async function runCase(req: string, c: AcceptanceCase, base: ExecContext, now: () => number): Promise<CaseResult> {
  const ctx: ExecContext = { ...base, vars: { ...base.vars } }; // isolated per-case bag (seeded from setup)
  const steps: StepResult[] = [];
  const start = now();
  for (const step of c.steps) {
    const r = await runStep(step, ctx);
    steps.push(r);
    if (!r.ok) break; // stop the case at the first failing step
  }
  const ok = steps.length === c.steps.length && steps.every((s) => s.ok);
  return { req, name: c.name, ok, steps, durationMs: now() - start, failure: firstFailure(steps) };
}

function tally(cases: CaseResult[]): AcceptanceRunResult {
  const failed = cases.filter((c) => !c.ok).length;
  return { cases, passed: cases.length - failed, failed, total: cases.length };
}

/** Run a list of specs and return per-case results. Never throws on assertion/transport failures. */
export async function runSpecs(specs: AcceptanceSpec[], opts: RunOptions = {}): Promise<AcceptanceRunResult> {
  const now = opts.now ?? Date.now;
  const base: ExecContext = {
    baseUrl: opts.baseUrl,
    headers: opts.headers,
    env: opts.env,
    fetchImpl: opts.fetchImpl,
    vars: { ...(opts.vars ?? {}) },
  };

  let setupFailure: string | undefined;
  if (opts.setup) {
    for (const step of opts.setup.steps) {
      const r = await runStep(step, base); // captures into base.vars
      if (!r.ok) {
        setupFailure = `setup failed: ${r.request} — ${r.error ?? r.failures.join('; ')}`;
        break;
      }
    }
  }

  const cases: CaseResult[] = [];
  for (const spec of specs) {
    for (const c of spec.cases) {
      if (setupFailure) {
        cases.push({ req: spec.req, name: c.name, ok: false, steps: [], durationMs: 0, failure: setupFailure });
      } else {
        cases.push(await runCase(spec.req, c, base, now));
      }
    }
  }
  return tally(cases);
}

/** Read + parse spec FILES matched by globs (relative to repoDir) into specs. Skips unreadable files. */
export function gatherSpecFiles(repoDir: string, globs: string[]): AcceptanceSpec[] {
  const out: AcceptanceSpec[] = [];
  for (const rel of globFiles(repoDir, globs)) {
    let text: string;
    try {
      text = readFileSync(join(repoDir, rel), 'utf8');
    } catch {
      continue;
    }
    out.push(...parseSpecFile(rel, text));
  }
  return out;
}
