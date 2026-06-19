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
]);

const testSourceSchema = z.object({
  tech: z.enum(['playwright', 'jest', 'vitest', 'node', 'xunit', 'generic']),
  globs: z.array(z.string()).min(1),
  /** Result-file globs (JUnit XML / TRX) produced by running this tech's suite. */
  results: z.array(z.string()).optional(),
});

const scopeSchema = z.object({
  name: z.string().optional(),
  requirements: z.array(requirementSourceSchema).min(1),
  tests: z.array(testSourceSchema).default([]),
  mapping: z.string().optional(),
});

export const traceConfigSchema = z.object({
  project: z.string().optional(),
  /** Override the requirement-key regex (default: Jira-style `[A-Z][A-Z0-9]+-\d+`). */
  keyPattern: z.string().optional(),
  /** Repo root the globs + git are resolved against (relative to the config file; default `.`). */
  repoDir: z.string().optional(),
  scopes: z.array(scopeSchema).min(1),
  output: z
    .object({ markdown: z.string().optional(), html: z.string().optional(), json: z.string().optional() })
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
