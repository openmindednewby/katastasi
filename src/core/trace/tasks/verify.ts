/**
 * The honesty cross-check — the Katastasi differentiator. A task linked to requirements is checked
 * against those requirements' real verification state (from a trace report). A `done` task whose
 * requirements aren't proven is flagged ⚠️ drift, per the configured `driftRule`. Pure: callers supply
 * the trace report (latest saved run, or a fresh `--run`).
 */
import type { ResolvedTasksConfig, TaskDriftRule } from '../config.js';
import type { RequirementState, TraceReport } from '../types.js';
import type { Task } from './model.js';

/** A linked requirement's resolved state ('unknown' = the task links a key the report doesn't know). */
export type LinkedReqState = RequirementState | 'unknown';

export interface LinkedRequirement {
  key: string;
  state: LinkedReqState;
}

export interface TaskVerification {
  task: Task;
  done: boolean;
  drift: boolean;
  reason: string | null;
  requirements: LinkedRequirement[];
}

const isDone = (task: Task, resolved: ResolvedTasksConfig): boolean => resolved.doneStatuses.includes(task.status);

/** Resolve each of a task's linked requirement keys to its state in the report. */
function linkedStates(task: Task, report: TraceReport): LinkedRequirement[] {
  const byKey = new Map<string, RequirementState>(report.requirements.map((r) => [r.key.toUpperCase(), r.state]));
  return task.requirements.map((key) => ({ key, state: byKey.get(key.toUpperCase()) ?? 'unknown' }));
}

/** Whether a done task drifts, given its linked requirement states + the rule. */
export function computeDrift(reqs: LinkedRequirement[], rule: TaskDriftRule): boolean {
  switch (rule) {
    case 'failing':
      return reqs.some((r) => r.state === 'failing');
    case 'strict':
      return reqs.length === 0 || reqs.some((r) => r.state !== 'verified');
    case 'unverified':
    default:
      return reqs.length > 0 && reqs.some((r) => r.state !== 'verified');
  }
}

function driftReason(reqs: LinkedRequirement[], rule: TaskDriftRule): string {
  if (rule === 'strict' && reqs.length === 0) return 'marked done but links no requirements';
  if (rule === 'failing') {
    const failing = reqs.filter((r) => r.state === 'failing').map((r) => r.key);
    return `marked done but failing: ${failing.join(', ')}`;
  }
  const unproven = reqs.filter((r) => r.state !== 'verified').map((r) => `${r.key} (${r.state})`);
  return `marked done but not verified: ${unproven.join(', ')}`;
}

/** Cross-check every task against the report. No-op (drift=false) when `verifyDone` is off. */
export function verifyTasks(tasks: Task[], report: TraceReport, resolved: ResolvedTasksConfig): TaskVerification[] {
  return tasks.map((task) => {
    const requirements = linkedStates(task, report);
    const done = isDone(task, resolved);
    const drift = resolved.verifyDone && done && computeDrift(requirements, resolved.driftRule);
    return { task, done, drift, reason: drift ? driftReason(requirements, resolved.driftRule) : null, requirements };
  });
}

export interface DriftSummary {
  total: number;
  done: number;
  drift: number;
  drifted: TaskVerification[];
}

export function summarizeDrift(verifications: TaskVerification[]): DriftSummary {
  const drifted = verifications.filter((v) => v.drift);
  return {
    total: verifications.length,
    done: verifications.filter((v) => v.done).length,
    drift: drifted.length,
    drifted,
  };
}
