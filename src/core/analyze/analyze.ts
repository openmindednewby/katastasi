/**
 * `acp analyze` — turn the gathered requirements + the codebase into development-ready artifacts:
 * a technical GAP ANALYSIS, a Confluence-ready TECHNICAL ANALYSIS page (architecture, contracts,
 * endpoints, mermaid flow diagrams), and a set of JIRA TASKS — each story with acceptance criteria,
 * a use-case flow, and tagged unit/e2e test stubs scaffolded into the repo. So an implementation agent
 * knows exactly what to build and how to verify it. The AI call is injectable for deterministic tests.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { TraceConfig } from '../trace/config.js';
import { gatherRequirements } from '../trace/index.js';
import { globFiles } from '../trace/glob.js';
import { scaffoldTest } from '../trace/scaffoldTest.js';
import { generateQuestions } from '../questions/generate.js';
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
  /** 'ask' (produced an open-questions form) or 'full' (produced the tech docs + tasks). */
  mode: 'ask' | 'full';
  /** In ask mode, the path of the generated interactive form. */
  questionsHtml?: string;
}

export interface AnalyzeOptions {
  /** Inject the model (tests pass a fake); default resolves from the environment. */
  chat?: ChatFn;
  /** Output folder for the analysis artifacts (default `tech-analysis`). */
  outDir?: string;
  /** Cap how many code files are read as context. */
  maxFiles?: number;
  /** Cap total bytes of code context sent to the model (default ~60 KB). */
  maxContextBytes?: number;
  /** Scaffold the per-task test stubs into the repo (default true). */
  scaffold?: boolean;
  /** Ask mode: produce an open-questions form (decisions to resolve) instead of the final docs. */
  ask?: boolean;
  /** Full mode: stakeholder answers (markdown) to incorporate into the analysis. */
  answers?: string;
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

/** Read the code files' CONTENTS into one capped context block (so the gap analysis sees real code). */
export function collectCodeContext(
  repoDir: string,
  files: string[],
  opts: { maxBytesPerFile?: number; maxTotalBytes?: number } = {},
): { context: string; included: number; omitted: number } {
  const perFile = opts.maxBytesPerFile ?? 6000;
  const total = opts.maxTotalBytes ?? 60000;
  let out = '';
  let used = 0;
  let included = 0;
  for (const f of files) {
    if (used >= total) break;
    let content: string;
    try {
      content = readFileSync(join(repoDir, f), 'utf8');
    } catch {
      continue;
    }
    if (content.length > perFile) content = `${content.slice(0, perFile)}\n…(truncated)`;
    const block = `=== ${f} ===\n${content}\n\n`;
    out += block;
    used += block.length;
    included += 1;
  }
  return { context: out || '(no code files)', included, omitted: Math.max(0, files.length - included) };
}

/** Build the prompt from requirements + code context (file contents). */
export function buildPrompt(
  requirements: Array<{ key: string; title: string; declaredStatus: string | null }>,
  codeContext: string,
  codeFileCount = 0,
): ChatMessage[] {
  const reqList = requirements.map((r) => `- ${r.key}: ${r.title} [${r.declaredStatus ?? 'unknown'}]`).join('\n');
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `REQUIREMENTS (reuse these keys for tasks):\n${reqList}\n\n` +
        `CODEBASE (${codeFileCount} file(s); contents below, some truncated):\n${codeContext}\n\n` +
        `Compare the requirements against the actual code above. For each requirement say whether it is ` +
        `implemented, partial, or missing (cite files), then output the JSON.`,
    },
  ];
}

const ASK_SYSTEM = `You are a senior software architect. Given business requirements and a codebase, do a
gap analysis and then surface the OPEN DECISIONS a stakeholder must resolve before implementation.
Respond with ONLY a JSON object:
{
  "gapAnalysis": "<markdown: implemented vs missing vs partial, citing files>",
  "openQuestionsMarkdown": "<a markdown doc with EXACTLY this structure so it renders as an interactive form:\\n# <Title>\\n\\n## Flow overview\\n\\\`\\\`\\\`mermaid\\nflowchart TD\\n  START[\\"Start\\"] --> Q1{\\"Q1 · <decision?>\\"}\\n  Q1 -->|<Option A>| ...\\n  Q1 -->|<Option B>| ...\\n  classDef pending fill:#ffe8b3,stroke:#e6a700;\\n  class Q1 pending;\\n\\\`\\\`\\\`\\n\\n## Open questions (QA)\\n- **Q1 — <decision?>:**\\n  - [ ] <Option A>\\n  - [ ] <Option B>\\n(one Q per real decision; each decision node tagged Q<n> in the diagram label AND in the QA list, options in the same order as the node's outgoing edges)>"
}`;

/** Build the ASK prompt (produce an open-questions form for the unclear decisions). */
export function buildAskPrompt(
  requirements: Array<{ key: string; title: string; declaredStatus: string | null }>,
  codeContext: string,
  codeFileCount = 0,
): ChatMessage[] {
  const reqList = requirements.map((r) => `- ${r.key}: ${r.title} [${r.declaredStatus ?? 'unknown'}]`).join('\n');
  return [
    { role: 'system', content: ASK_SYSTEM },
    {
      role: 'user',
      content: `REQUIREMENTS:\n${reqList}\n\nCODEBASE (${codeFileCount} file(s)):\n${codeContext}\n\nSurface the open decisions, then output the JSON.`,
    },
  ];
}

/** Coerce the ask-mode reply. */
export function validateAsk(raw: unknown): { gapAnalysis: string; openQuestionsMarkdown: string } {
  const o = (raw ?? {}) as { gapAnalysis?: unknown; openQuestionsMarkdown?: unknown };
  return {
    gapAnalysis: typeof o.gapAnalysis === 'string' ? o.gapAnalysis : '(none)',
    openQuestionsMarkdown:
      typeof o.openQuestionsMarkdown === 'string' && o.openQuestionsMarkdown.includes('## Open questions')
        ? o.openQuestionsMarkdown
        : '# Open questions\n\n## Flow overview\n\n```mermaid\nflowchart TD\n  START["Start"] --> DONE["No open decisions"]\n```\n\n## Open questions (QA)\n\n- **Q1 — Proceed?:**\n  - [ ] Yes\n',
  };
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
  const { context } = collectCodeContext(repoDir, codeFiles, { maxTotalBytes: opts.maxContextBytes });
  const outDirRel = opts.outDir ?? 'tech-analysis';
  const outDir = resolve(baseDir, outDirRel);
  const files: string[] = [];
  const write = (rel: string, content: string) => {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), content, 'utf8');
    files.push(join(outDirRel, rel));
  };

  // ── ASK mode: surface the open decisions as an interactive form ──────────────
  if (opts.ask) {
    const ask = validateAsk(extractJson(await chat(buildAskPrompt(requirements, context, codeFiles.length))));
    write('gap-analysis.md', `# Gap Analysis\n\n${ask.gapAnalysis}\n`);
    write('open-questions.md', ask.openQuestionsMarkdown);
    const { html } = generateQuestions(ask.openQuestionsMarkdown, { mermaid: 'cdn', outPath: join(outDir, 'open-questions.html') });
    writeFileSync(join(outDir, 'open-questions.html'), html, 'utf8');
    files.push(join(outDirRel, 'open-questions.html'));
    return { outDir, files, tasks: [], scaffolded: [], mode: 'ask', questionsHtml: join(outDirRel, 'open-questions.html') };
  }

  // ── FULL mode: produce the tech docs + tasks (+ stakeholder answers if supplied) ──
  const messages = buildPrompt(requirements, context, codeFiles.length);
  if (opts.answers && opts.answers.trim()) {
    messages[1].content += `\n\nSTAKEHOLDER ANSWERS (incorporate these resolved decisions):\n${opts.answers}`;
  }
  const out = validateOutput(extractJson(await chat(messages)));

  mkdirSync(join(outDir, 'tasks'), { recursive: true });

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
  return { outDir, files, tasks: out.tasks, scaffolded, mode: 'full' };
}
