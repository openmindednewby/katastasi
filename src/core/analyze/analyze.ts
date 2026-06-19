/**
 * `acp analyze` — turn the gathered requirements + the codebase into development-ready artifacts:
 * a technical GAP ANALYSIS, a Confluence-ready TECHNICAL ANALYSIS page (architecture, contracts,
 * endpoints, mermaid flow diagrams), and a set of JIRA TASKS — each story with acceptance criteria,
 * a use-case flow, and tagged unit/e2e test stubs scaffolded into the repo. So an implementation agent
 * knows exactly what to build and how to verify it. The AI call is injectable for deterministic tests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { TraceConfig } from '../trace/config.js';
import { gatherRequirements } from '../trace/index.js';
import { globFiles } from '../trace/glob.js';
import { scaffoldTest } from '../trace/scaffoldTest.js';
import { defaultChat, extractJson, type ChatFn, type ChatMessage } from './ai.js';

export interface AnalyzeTaskTest {
  tech: string;
  title: string;
}
export interface AnalyzeTask {
  key: string;
  title: string;
  acceptanceCriteria: string[];
  flowMermaid?: string;
  tests: AnalyzeTaskTest[];
}
export interface AnalyzeOutput {
  gapAnalysis: string;
  technicalAnalysis: string;
  tasks: AnalyzeTask[];
}
export interface AnalyzeResult {
  outDir: string;
  files: string[];
  tasks: AnalyzeTask[];
  scaffolded: string[];
}

export interface AnalyzeOptions {
  /** Inject the model (tests pass a fake); default resolves from the environment. */
  chat?: ChatFn;
  /** Output folder for the analysis artifacts (default `tech-analysis`). */
  outDir?: string;
  /** Cap how many code file paths are sent as context. */
  maxFiles?: number;
  /** Scaffold the per-task test stubs into the repo (default true). */
  scaffold?: boolean;
}

const SYSTEM = `You are a senior software architect. Given business requirements and a codebase file list,
produce a precise technical gap analysis and a development-ready breakdown. Respond with ONLY a JSON object
(no prose) of the exact shape:
{
  "gapAnalysis": "<markdown: which requirements appear implemented vs missing vs partial, and why>",
  "technicalAnalysis": "<markdown Confluence page: architecture, API endpoints + contracts, data flow; include mermaid diagrams in \\\`\\\`\\\`mermaid fences>",
  "tasks": [
    { "key": "<requirement key, reuse the given keys>", "title": "<short>",
      "acceptanceCriteria": ["<testable criterion>", "..."],
      "flowMermaid": "<a use-case flow as a mermaid 'flowchart TD' body>",
      "tests": [ { "tech": "playwright", "title": "<e2e test name>" }, { "tech": "jest", "title": "<unit test name>" } ] }
  ]
}`;

/** Build the prompt from requirements + code context. */
export function buildPrompt(
  requirements: Array<{ key: string; title: string; declaredStatus: string | null }>,
  codeFiles: string[],
): ChatMessage[] {
  const reqList = requirements.map((r) => `- ${r.key}: ${r.title} [${r.declaredStatus ?? 'unknown'}]`).join('\n');
  const fileList = codeFiles.length ? codeFiles.join('\n') : '(no code globs configured)';
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `REQUIREMENTS (reuse these keys for tasks):\n${reqList}\n\n` +
        `CODEBASE FILES:\n${fileList}\n\n` +
        `Analyse the gap between the requirements and the codebase, then output the JSON.`,
    },
  ];
}

/** Coerce the model's JSON into a valid AnalyzeOutput. */
export function validateOutput(raw: unknown): AnalyzeOutput {
  const o = (raw ?? {}) as Partial<AnalyzeOutput>;
  const tasks = Array.isArray(o.tasks) ? o.tasks : [];
  return {
    gapAnalysis: typeof o.gapAnalysis === 'string' ? o.gapAnalysis : '(none)',
    technicalAnalysis: typeof o.technicalAnalysis === 'string' ? o.technicalAnalysis : '(none)',
    tasks: tasks.map((t) => ({
      key: String((t as AnalyzeTask).key ?? '').toUpperCase(),
      title: String((t as AnalyzeTask).title ?? ''),
      acceptanceCriteria: Array.isArray((t as AnalyzeTask).acceptanceCriteria) ? (t as AnalyzeTask).acceptanceCriteria.map(String) : [],
      flowMermaid: (t as AnalyzeTask).flowMermaid ? String((t as AnalyzeTask).flowMermaid) : undefined,
      tests: Array.isArray((t as AnalyzeTask).tests)
        ? (t as AnalyzeTask).tests.map((x) => ({ tech: String(x.tech ?? 'playwright'), title: String(x.title ?? '') }))
        : [],
    })).filter((t) => t.key),
  };
}

/** Render one Jira-publishable story markdown (first `#` = summary; AC + flow + tests sections). */
export function taskMarkdown(t: AnalyzeTask): string {
  const ac = t.acceptanceCriteria.length ? t.acceptanceCriteria.map((c) => `- ${c}`).join('\n') : '- (define)';
  const flow = t.flowMermaid ? `\n\n## Flow\n\n\`\`\`mermaid\n${t.flowMermaid.trim()}\n\`\`\`` : '';
  const tests = t.tests.length ? t.tests.map((x) => `- ${x.tech}: ${x.title} \`@${t.key}\``).join('\n') : `- add tests tagged \`@${t.key}\``;
  return `# ${t.title}\n\n\`${t.key}\`\n\n## Acceptance Criteria\n\n${ac}${flow}\n\n## Tests (tag with @${t.key})\n\n${tests}\n`;
}

/** Run the analysis end to end. */
export async function analyze(config: TraceConfig, baseDir: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const chat = opts.chat ?? defaultChat();
  const repoDir = isAbsolute(config.repoDir ?? '.') ? (config.repoDir as string) : resolve(baseDir, config.repoDir ?? '.');
  const requirements = await gatherRequirements(config, baseDir);
  const codeGlobs = config.scopes.flatMap((s) => s.code ?? []);
  const codeFiles = codeGlobs.length ? globFiles(repoDir, codeGlobs).slice(0, opts.maxFiles ?? 200) : [];

  const reply = await chat(buildPrompt(requirements, codeFiles));
  const out = validateOutput(extractJson(reply));

  const outDir = resolve(baseDir, opts.outDir ?? 'tech-analysis');
  mkdirSync(join(outDir, 'tasks'), { recursive: true });
  const files: string[] = [];
  const write = (rel: string, content: string) => {
    writeFileSync(join(outDir, rel), content, 'utf8');
    files.push(join(opts.outDir ?? 'tech-analysis', rel));
  };

  write('gap-analysis.md', `# Gap Analysis\n\n${out.gapAnalysis}\n`);
  write('technical-analysis.md', out.technicalAnalysis.startsWith('#') ? `${out.technicalAnalysis}\n` : `# Technical Analysis\n\n${out.technicalAnalysis}\n`);
  const epic = `# Technical Analysis — Tasks\n\n${out.tasks.map((t) => `- **${t.key}** ${t.title}`).join('\n')}\n`;
  write(join('tasks', 'epic.md'), epic);
  for (const t of out.tasks) write(join('tasks', `${t.key}.md`), taskMarkdown(t));

  const scaffolded: string[] = [];
  if (opts.scaffold !== false) {
    for (const t of out.tasks) {
      for (const tt of t.tests) {
        try {
          scaffolded.push(scaffoldTest(config, baseDir, { key: t.key, tech: tt.tech, title: tt.title }).path);
        } catch {
          /* tech not in config / etc. — skip */
        }
      }
    }
  }
  return { outDir, files, tasks: out.tasks, scaffolded };
}
