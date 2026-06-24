/**
 * `acp-trace.json` schema + loader. One config describes, per scope (product / epic), where its
 * requirements come from, which test sources/results feed it, the optional mapping file, and where
 * the report is written / published. Multiple scopes let one config span many epics or orgs.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const DEFAULT_CONFIG_FILENAME = 'acp-trace.json';

const requirementSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('jira-epic'),
    epic: z.string(),
    includeEpic: z.boolean().optional(),
    recursive: z.boolean().optional(),
    doneStatuses: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('roadmap-html'), path: z.string() }),
  z.object({ type: z.literal('confluence-page'), pageId: z.string() }),
  z.object({ type: z.literal('markdown'), path: z.string() }),
  z.object({
    type: z.literal('github-issues'),
    repo: z.string(), // owner/name
    label: z.string().optional(),
    milestone: z.string().optional(),
    keyPrefix: z.string().optional(),
    baseUrl: z.string().optional(),
    token: z.string().optional(),
  }),
  z.object({
    type: z.literal('gitlab-issues'),
    project: z.string(), // group/name or numeric id
    label: z.string().optional(),
    keyPrefix: z.string().optional(),
    baseUrl: z.string().optional(),
    token: z.string().optional(),
  }),
  z.object({
    type: z.literal('command'),
    command: z.string(), // any script; stdout = JSON array or markdown of requirements
    format: z.enum(['json', 'markdown']).optional(),
    cwd: z.string().optional(),
  }),
]);

const testSourceSchema = z.object({
  tech: z.enum(['playwright', 'jest', 'vitest', 'node', 'xunit', 'generic', 'acceptance']),
  globs: z.array(z.string()).min(1),
  /** Result-file globs (JUnit XML / TRX) produced by running this tech's suite. */
  results: z.array(z.string()).optional(),
  /** Optional command to (re)run this suite with `acp trace --run` (e.g. `npx playwright test`). */
  command: z.string().optional(),
  /** Working dir for `command` (relative to repoDir; default repoDir). */
  cwd: z.string().optional(),
});

const scopeSchema = z.object({
  name: z.string().optional(),
  requirements: z.array(requirementSourceSchema).min(1),
  tests: z.array(testSourceSchema).default([]),
  mapping: z.string().optional(),
  /** Globs of implementation code to scan for `@KEY` tags → "referenced in code?" (gap analysis). */
  code: z.array(z.string()).optional(),
  /** Task ID prefix for this scope (e.g. "WEB" → WEB-1 in .acp/tasks/<scope>/). Omit → global TASK ids. */
  taskPrefix: z.string().optional(),
});

/** Task-tracking settings (Phase 1). All fields optional; resolve via `resolveTasksConfig`. */
const tasksConfigSchema = z
  .object({
    mode: z.enum(['local', 'jira', 'hybrid']).optional(),
    dir: z.string().optional(),
    idPrefix: z.string().optional(),
    statuses: z.array(z.string()).min(1).optional(),
    doneStatuses: z.array(z.string()).min(1).optional(),
    verifyDone: z.boolean().optional(),
    driftRule: z.enum(['unverified', 'strict', 'failing']).optional(),
    jira: z.object({ epic: z.string() }).optional(),
  })
  .refine(
    (t) => !t.statuses || !t.doneStatuses || t.doneStatuses.every((s) => t.statuses!.includes(s)),
    { message: 'tasks.doneStatuses must all be members of tasks.statuses' },
  );

export const traceConfigSchema = z.object({
  project: z.string().optional(),
  /** Override the requirement-key regex (default: Jira-style `[A-Z][A-Z0-9]+-\d+`). */
  keyPattern: z.string().optional(),
  /** Repo root the globs + git are resolved against (relative to the config file; default `.`). */
  repoDir: z.string().optional(),
  scopes: z.array(scopeSchema).min(1),
  /** Task tracking (Phase 1). Optional; defaults filled by `resolveTasksConfig`. */
  tasks: tasksConfigSchema.optional(),
  /**
   * Acceptance test runner (Phase 2). `baseUrl`/`headers` apply to every HTTP step; `setup` is a
   * one-time case (e.g. login) whose captured variables seed all cases. Secrets come from env via
   * `{{env.NAME}}` interpolation — never stored here. Steps use the same authoring shape as specs.
   */
  runner: z
    .object({
      baseUrl: z.string().optional(),
      headers: z.record(z.string()).optional(),
      setup: z.object({ name: z.string().optional(), steps: z.array(z.unknown()).min(1) }).optional(),
    })
    .optional(),
  /**
   * Feature wizard settings. `baseUrl` is woven into the generated curls; `fixtures` maps id-placeholder
   * names (e.g. `{id}` / `:id` / `{{id}}` in a path) to REAL values that have data, so the curls are
   * copy-paste-runnable. Unresolved placeholders are kept with a note telling you which fixture to set.
   */
  wizard: z
    .object({
      baseUrl: z.string().optional(),
      fixtures: z.record(z.string()).optional(),
    })
    .optional(),
  /**
   * Bidirectional sync (Phase 3). Each binding reconciles a local record set (`.acp/tasks`) with a
   * remote (GitHub issues / Jira). Credentials come from env (GITHUB_TOKEN, JIRA_*); `statusMap` maps
   * local status → remote (e.g. `{ "done": "closed" }`). Preview by default; `--apply` to write.
   */
  sync: z
    .object({
      /** conflict-flag (v1, default) flags every both-changed record; field-merge (v2) auto-merges disjoint-field edits. */
      mergeStrategy: z.enum(['conflict-flag', 'field-merge']).optional(),
      bindings: z
        .array(
          z.object({
            id: z.string(),
            dir: z.string().optional(), // local tasks dir (default .acp/tasks)
            idPrefix: z.string().optional(), // id prefix for pulled-in tasks (default TASK)
            statusMap: z.record(z.string()).optional(),
            remote: z.discriminatedUnion('type', [
              z.object({
                type: z.literal('github'),
                repo: z.string(), // owner/name
                labelFilter: z.string().optional(),
                baseUrl: z.string().optional(),
              }),
              z.object({
                type: z.literal('jira'),
                jql: z.string(),
                projectKey: z.string().optional(),
                issueType: z.string().optional(),
              }),
            ]),
          }),
        )
        .min(1),
    })
    .optional(),
  /** Run history: where git-stamped snapshots are stored + an optional named baseline to diff against. */
  history: z
    .object({ dir: z.string().optional(), baseline: z.string().optional(), keep: z.number().optional() })
    .optional(),
  /** Built-in web portal (`acp trace serve`) settings. */
  portal: z.object({ port: z.number().default(8787) }).optional(),
  /** Post a message to a webhook (Slack/Teams/generic) after a run. */
  notify: z
    .object({
      webhook: z.string(),
      on: z.enum(['regression', 'failing', 'stale', 'always']).default('regression'),
    })
    .optional(),
  output: z
    .object({
      markdown: z.string().optional(),
      html: z.string().optional(),
      json: z.string().optional(),
      /** POST the full report JSON to a company's own endpoint/collector (string URL or {url, headers}). */
      post: z.union([z.string(), z.object({ url: z.string(), headers: z.record(z.string()).optional() })]).optional(),
    })
    .optional(),
  publish: z
    .object({
      confluence: z.object({ pageId: z.string(), title: z.string().optional() }).optional(),
      roadmap: z.object({ path: z.string(), sectionId: z.string().default('rtm') }).optional(),
      jira: z.object({ verifiedLabel: z.string().optional() }).optional(),
    })
    .optional(),
});

export type TraceConfig = z.infer<typeof traceConfigSchema>;
export type RequirementSource = z.infer<typeof requirementSourceSchema>;
export type TestSourceConfig = z.infer<typeof testSourceSchema>;
export type TraceScope = z.infer<typeof scopeSchema>;
export type TasksConfig = z.infer<typeof tasksConfigSchema>;

/** Task drift rule: when a `done` task counts as ⚠️ drift. */
export type TaskDriftRule = 'unverified' | 'strict' | 'failing';

/** Fully-resolved task settings (every field present). */
export interface ResolvedTasksConfig {
  mode: 'local' | 'jira' | 'hybrid';
  dir: string;
  idPrefix: string;
  statuses: string[];
  doneStatuses: string[];
  verifyDone: boolean;
  driftRule: TaskDriftRule;
  jira?: { epic: string };
}

export const DEFAULT_TASKS_CONFIG: ResolvedTasksConfig = {
  mode: 'local',
  dir: '.acp/tasks',
  idPrefix: 'TASK',
  statuses: ['todo', 'in-progress', 'blocked', 'done'],
  doneStatuses: ['done'],
  verifyDone: true,
  driftRule: 'unverified',
};

/** Merge a config's `tasks` block over the defaults → a fully-resolved task config. */
export function resolveTasksConfig(config: TraceConfig): ResolvedTasksConfig {
  const t = config.tasks ?? {};
  const d = DEFAULT_TASKS_CONFIG;
  return {
    mode: t.mode ?? d.mode,
    dir: t.dir ?? d.dir,
    idPrefix: t.idPrefix ?? d.idPrefix,
    statuses: t.statuses ?? d.statuses,
    doneStatuses: t.doneStatuses ?? d.doneStatuses,
    verifyDone: t.verifyDone ?? d.verifyDone,
    driftRule: t.driftRule ?? d.driftRule,
    ...(t.jira ? { jira: t.jira } : {}),
  };
}

/** The task ID prefix for a scope: its `taskPrefix` if set, else the global `tasks.idPrefix`. */
export function scopeTaskPrefix(resolved: ResolvedTasksConfig, scope?: TraceScope): string {
  return scope?.taskPrefix ?? resolved.idPrefix;
}

/** Parse + validate config from a JSON string. Throws a readable error on a bad shape. */
export function parseTraceConfig(json: string): TraceConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`acp-trace config is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = traceConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`acp-trace config is invalid:\n${issues}`);
  }
  return result.data;
}

/** Options for scaffolding a starter config via `acp trace init`. */
export interface StarterOptions {
  project?: string;
  jiraEpic?: string;
  markdownPath?: string;
  roadmapPath?: string;
  confluencePageId?: string;
  testGlobs?: string[];
}

/** Build a sensible starter `acp-trace.json` (pretty JSON string) from optional hints. */
export function starterConfig(opts: StarterOptions = {}): string {
  const requirements: RequirementSource[] = [];
  if (opts.jiraEpic) requirements.push({ type: 'jira-epic', epic: opts.jiraEpic });
  if (opts.roadmapPath) requirements.push({ type: 'roadmap-html', path: opts.roadmapPath });
  if (opts.confluencePageId) requirements.push({ type: 'confluence-page', pageId: opts.confluencePageId });
  if (opts.markdownPath || requirements.length === 0) {
    requirements.push({ type: 'markdown', path: opts.markdownPath ?? 'docs/requirements.md' });
  }

  const globs = opts.testGlobs ?? ['e2e/**/*.spec.ts', 'src/**/*.test.ts', 'Services/**/*Tests.cs'];
  const config: TraceConfig = {
    project: opts.project ?? 'My Product',
    scopes: [
      {
        name: 'default',
        requirements,
        tests: [
          { tech: 'playwright', globs: [globs[0]], results: ['e2e/results/*.xml'] },
          { tech: 'jest', globs: [globs[1] ?? 'src/**/*.test.ts'], results: ['coverage/junit.xml'] },
          { tech: 'xunit', globs: [globs[2] ?? 'Services/**/*Tests.cs'], results: ['Services/**/TestResults/*.trx'] },
        ],
        mapping: 'docs/traceability.yml',
      },
    ],
    output: { markdown: 'docs/RTM.md', html: 'docs/rtm.html', json: 'docs/rtm.json' },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Load + validate a config file from disk. */
export function loadTraceConfig(path: string): TraceConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`acp-trace config not found: ${path}`);
  }
  return parseTraceConfig(text);
}
