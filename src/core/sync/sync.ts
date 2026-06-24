/**
 * Sync orchestrator — wires a config binding to its adapter + status mapper + local tasks, runs the
 * plan, executes the safe subset, and persists the state. Credentials come from env (GITHUB_TOKEN,
 * JIRA_*). Adapters are injectable per binding so the whole flow is tested with the fake (no network).
 */
import { join } from 'node:path';
import type { TraceConfig } from '../trace/config.js';
import { makeStatusMapper } from './statusMapper.js';
import { listLocalRecords } from './localTasks.js';
import { planSync } from './plan.js';
import { executeSync, type Direction, type SyncResult } from './execute.js';
import { bindingRecords, loadState, saveState, syncStatePath } from './state.js';
import { GithubAdapter } from './adapters/github.js';
import { JiraAdapter } from './adapters/jira.js';
import type { SyncAdapter } from './model.js';

const DEFAULT_GITHUB_STATUS_MAP = { todo: 'open', 'in-progress': 'open', blocked: 'open', done: 'closed' };

export interface SyncRunOptions {
  apply?: boolean; // default false (preview)
  direction?: Direction; // default 'both'
  binding?: string; // run only this binding id
  today?: string; // injectable date (default today)
  env?: NodeJS.ProcessEnv; // credential source (default process.env)
  adapters?: Record<string, SyncAdapter>; // inject per binding id (tests)
}

export interface BindingResult extends SyncResult {
  bindingId: string;
  remoteType: string;
  error?: string; // set when the binding could not run (e.g. missing creds)
}

type Binding = NonNullable<TraceConfig['sync']>['bindings'][number];

function buildAdapter(binding: Binding, env: NodeJS.ProcessEnv): SyncAdapter {
  if (binding.remote.type === 'github') {
    const token = env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is not set (see docs/SOURCES_SETUP.md)');
    return new GithubAdapter({ repo: binding.remote.repo, token, labelFilter: binding.remote.labelFilter, baseUrl: binding.remote.baseUrl });
  }
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) throw new Error('JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN are not set (see docs/SOURCES_SETUP.md)');
  return new JiraAdapter({ baseUrl: JIRA_BASE_URL, email: JIRA_EMAIL, apiToken: JIRA_API_TOKEN, jql: binding.remote.jql, projectKey: binding.remote.projectKey, issueType: binding.remote.issueType });
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Run every configured binding (or one). Returns a per-binding result; never throws on a binding error. */
export async function runSync(config: TraceConfig, baseDir: string, opts: SyncRunOptions = {}): Promise<BindingResult[]> {
  const bindings = (config.sync?.bindings ?? []).filter((b) => !opts.binding || b.id === opts.binding);
  if (bindings.length === 0) throw new Error(opts.binding ? `no sync binding "${opts.binding}"` : 'no sync bindings configured (add config.sync.bindings)');

  const env = opts.env ?? process.env;
  const today = opts.today ?? isoToday();
  const apply = opts.apply ?? false;
  const direction = opts.direction ?? 'both';
  const statePath = syncStatePath(baseDir);
  const state = loadState(statePath);
  const out: BindingResult[] = [];

  for (const binding of bindings) {
    const blank: SyncResult = { applied: apply, summary: { skip: 0, push: 0, pull: 0, 'create-remote': 0, 'pull-create': 0, converged: 0, merge: 0, conflict: 0, 'local-deleted': 0, 'remote-deleted': 0 }, conflicts: [], links: [], flags: [], errors: [] };
    try {
      const adapter = opts.adapters?.[binding.id] ?? buildAdapter(binding, env);
      const mapper = makeStatusMapper(binding.statusMap ?? (binding.remote.type === 'github' ? DEFAULT_GITHUB_STATUS_MAP : undefined));
      const tasksRoot = join(baseDir, binding.dir ?? '.acp/tasks');
      const idPrefix = binding.idPrefix ?? 'TASK';
      const records = bindingRecords(state, binding.id);

      const locals = listLocalRecords(baseDir, tasksRoot, mapper);
      const remotes = await adapter.list();
      const plan = planSync(locals, remotes, records, config.sync?.mergeStrategy ?? 'conflict-flag');
      const res = await executeSync(plan, adapter, records, { baseDir, bindingId: binding.id, tasksRoot, idPrefix, today, apply, direction, mapper });
      out.push({ ...res, bindingId: binding.id, remoteType: binding.remote.type });
    } catch (err) {
      out.push({ ...blank, bindingId: binding.id, remoteType: binding.remote.type, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (apply) saveState(statePath, state);
  return out;
}

/** Read-only view of the recorded links per binding (for `katastasi sync status`). */
export function syncLinks(config: TraceConfig, baseDir: string): Array<{ bindingId: string; links: Array<{ key: string; remoteId: string; lastSyncedAt?: string }> }> {
  const state = loadState(syncStatePath(baseDir));
  return (config.sync?.bindings ?? []).map((b) => ({
    bindingId: b.id,
    links: Object.entries(state.bindings[b.id]?.records ?? {}).map(([key, r]) => ({ key, remoteId: r.remoteId, lastSyncedAt: r.lastSyncedAt })),
  }));
}
