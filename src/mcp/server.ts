#!/usr/bin/env node
/**
 * katastasi MCP server (stdio).
 *
 * Exposes two tools so a Claude agent can publish the markdown it has written:
 *   - markdown_to_jira:        create/update a Jira Epic + linked Stories
 *   - markdown_to_confluence:  create/update a Confluence page
 *
 * The agent writes the markdown; these tools post it to the n8n publish webhooks
 * (no AI happens here). Configure via `.env` (WEBHOOK_URL, ACP_BACKEND).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { dirname, resolve, relative } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { publishJira } from '../core/jira.js';
import { publishConfluence } from '../core/confluence.js';
import { pullJira, pullConfluence } from '../core/pull.js';
import { pushFolder } from '../core/push.js';
import { loadTraceConfig } from '../core/trace/config.js';
import { runTrace, renderAll, requirementStatus, gatherRequirements } from '../core/trace/index.js';
import { runAcceptance } from '../core/trace/acceptance/orchestrate.js';
import { resolveStoreDir } from '../core/trace/store.js';
import { resolveTasksConfig } from '../core/trace/config.js';
import { addTask, listTasksFiltered, getTask, setTaskStatus, linkTask } from '../core/trace/tasks/ops.js';
import { verifyTasks, summarizeDrift, type TaskVerification } from '../core/trace/tasks/verify.js';
import { renderBoard, boardPath } from '../core/trace/tasks/board.js';
import { reportForTasks } from '../core/trace/tasks/report.js';
import { importJiraTasks } from '../core/trace/tasks/importJira.js';
import type { Task } from '../core/trace/tasks/model.js';
import { scaffoldTest } from '../core/trace/scaffoldTest.js';
import { writeRequirementsFolder } from '../core/trace/requirements/folder.js';
import { analyze } from '../core/analyze/analyze.js';
import { generateQuestions } from '../core/questions/generate.js';

const server = new McpServer({ name: 'katastasi', version: '0.3.0' });

const TASK_MD_DESC =
  'Markdown for each Story (one string per Story). First `# ` line becomes the summary; ' +
  '`## Acceptance Criteria`, `## Priority`, `## Component`, `## Labels` are recognised sections.';

server.registerTool(
  'markdown_to_jira',
  {
    title: 'Markdown to Jira (Epic + Stories)',
    description:
      'Create or update a Jira Epic and its linked Stories from markdown you have written. ' +
      'Pass `epicKey`/`taskKeys` to UPDATE existing issues instead of creating new ones. ' +
      'Returns the created/updated issue keys and URLs.',
    inputSchema: {
      epicMarkdown: z
        .string()
        .describe('Markdown for the Epic. The first `# ` line is used as the Epic summary.'),
      taskMarkdowns: z.array(z.string()).optional().describe(TASK_MD_DESC),
      epicKey: z
        .string()
        .optional()
        .describe('Existing Epic key (e.g. PROJ-12) or browse URL to update instead of create.'),
      taskKeys: z
        .array(z.string())
        .optional()
        .describe('Existing Story keys/URLs, positional to taskMarkdowns. Empty entries are created.'),
      taskAssignees: z
        .array(z.string())
        .optional()
        .describe('Per-task assignee (accountId, email, or profile URL), positional to taskMarkdowns.'),
      component: z.string().optional().describe('Default Jira component applied to every issue.'),
      assignee: z.string().optional().describe('Default assignee (accountId, email, or profile URL).'),
      reporter: z.string().optional().describe('Reporter (accountId, email, or profile URL).'),
      issueType: z.string().optional().describe('Override the Epic issue type (default: Epic).'),
      parentKey: z.string().optional().describe('Parent key for the Epic itself (e.g. an initiative).'),
    },
  },
  async (args) => {
    try {
      const result = await publishJira(args);
      const lines = [
        `Epic [${result.epic.key}] ${result.epic.title} (${result.epic.action})`,
        `  ${result.epic.url}`,
        ...result.tasks.map((t) => `Story [${t.key}] ${t.title} (${t.action}) — ${t.url}`),
        `Total: ${result.taskCount} stories.`,
      ];
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'markdown_to_confluence',
  {
    title: 'Markdown to Confluence (page)',
    description:
      'Create or update a Confluence page from markdown you have written. ' +
      'Pass `pageId` to UPDATE an existing page. Returns the page URL.',
    inputSchema: {
      pageMarkdown: z.string().describe('Markdown body of the page.'),
      title: z
        .string()
        .optional()
        .describe('Page title. Defaults to the first `# ` line of pageMarkdown.'),
      sectionMarkdowns: z
        .array(z.string())
        .optional()
        .describe('Additional markdown sections appended after the body, in order.'),
      pageId: z.string().optional().describe('Existing page id to update instead of create.'),
      parentPageId: z.string().optional().describe('Parent page id to nest the new page under.'),
      labels: z.array(z.string()).optional().describe('Labels to attach to the page.'),
    },
  },
  async (args) => {
    try {
      const result = await publishConfluence(args);
      const url = result.page?.url ?? '(no url returned)';
      const action = result.page?.action ?? 'published';
      return {
        content: [{ type: 'text' as const, text: `Confluence page ${action}: ${url}` }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'jira_to_markdown',
  {
    title: 'Jira to Markdown (Epic → folder)',
    description:
      'Reverse of markdown_to_jira. Pull a Jira Epic and (recursively) its Stories and Sub-tasks ' +
      'into a round-trippable markdown folder (epic.md + task-*.md + nested sub-task folders + an ' +
      'acp-pull.json manifest). Read-only; uses JIRA_* creds from .env via direct REST.',
    inputSchema: {
      epic: z.string().describe('Epic key (e.g. PROJ-12) or a /browse/PROJ-12 URL.'),
      dir: z.string().describe('Target directory to write the markdown folder into.'),
      recursive: z.boolean().optional().describe('Pull child issues too (default true).'),
      force: z.boolean().optional().describe('Overwrite a non-empty target directory (default false).'),
    },
  },
  async (args) => {
    try {
      const result = await pullJira(args.epic, args.dir, { recursive: args.recursive, force: args.force });
      const lines = [
        `Pulled ${result.issues.length} issue(s) to ${result.dir}`,
        ...result.issues.map((i) => `[${i.key}] ${i.type}: ${i.file}`),
        `Manifest: ${result.manifestPath}`,
      ];
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'confluence_to_markdown',
  {
    title: 'Confluence to Markdown (page → folder)',
    description:
      'Reverse of markdown_to_confluence. Pull a Confluence page and (recursively) its descendant ' +
      'pages into a round-trippable markdown folder (page.md + nested subfolders + an acp-pull.json ' +
      'manifest). Read-only; uses CONFLUENCE_* creds from .env via direct REST.',
    inputSchema: {
      page: z.string().describe('Page id (e.g. 123456) or a Confluence page URL.'),
      dir: z.string().describe('Target directory to write the markdown folder into.'),
      recursive: z.boolean().optional().describe('Pull child pages too (default true).'),
      force: z.boolean().optional().describe('Overwrite a non-empty target directory (default false).'),
    },
  },
  async (args) => {
    try {
      const result = await pullConfluence(args.page, args.dir, { recursive: args.recursive, force: args.force });
      const lines = [
        `Pulled ${result.pages.length} page(s) to ${result.dir}`,
        ...result.pages.map((p) => `[${p.pageId}] ${p.title} -> ${p.dir}/page.md`),
        `Manifest: ${result.manifestPath}`,
      ];
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'push_folder',
  {
    title: 'Push folder (markdown → Jira/Confluence, recursive)',
    description:
      'Re-publish a folder previously produced by jira_to_markdown / confluence_to_markdown back to ' +
      'Atlassian, recursively (incl. sub-tasks / child pages). Reads acp-pull.json, converts each ' +
      'markdown file to ADF / storage, and updates the matching issue/page in place via direct REST. ' +
      'Entries without a key/id are created. Needs the matching JIRA_* / CONFLUENCE_* creds in .env.',
    inputSchema: {
      dir: z.string().describe('Folder containing acp-pull.json (from a previous pull).'),
      dryRun: z.boolean().optional().describe('Report intended create/update actions without calling Atlassian.'),
    },
  },
  async (args) => {
    try {
      const result = await pushFolder(args.dir, { dryRun: args.dryRun });
      const rows =
        result.kind === 'jira'
          ? (result.issues ?? []).map((i) => `[${i.key}] ${i.action}: ${i.file}`)
          : (result.pages ?? []).map((p) => `[${p.pageId}] ${p.action}: ${p.dir}/page.md`);
      return {
        content: [{ type: 'text' as const, text: [`Pushed ${rows.length} item(s) from ${result.dir}`, ...rows].join('\n') }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'requirements_trace',
  {
    title: 'Requirements traceability (tests ↔ requirements ↔ status)',
    description:
      'Build a Requirements Traceability Matrix from an acp-trace.json config: pull requirements ' +
      '(Jira epic / roadmap HTML / Confluence page / markdown), scan the configured test sources for ' +
      '`@KEY` tags + xUnit `[Trait]` + a mapping file, ingest JUnit/TRX results, and report — at the ' +
      'current git commit — which requirements are verified / failing / unverified / specified, plus ' +
      'drift (declared done but not verified), orphan tests, and regressions vs the previous run. ' +
      'Set `run: true` to (re)execute each configured suite command before tracing. Returns the ' +
      'markdown report + stats.',
    inputSchema: {
      configPath: z.string().optional().describe('Path to acp-trace.json (default: ./acp-trace.json).'),
      format: z.enum(['markdown', 'json']).optional().describe('Return the markdown report (default) or raw JSON.'),
      run: z.boolean().optional().describe('Execute each test group\'s command before tracing (re-run the suites).'),
    },
  },
  async (args) => {
    try {
      const configPath = resolve(args.configPath ?? 'acp-trace.json');
      const config = loadTraceConfig(configPath);
      const report = await runTrace(config, dirname(configPath), { run: args.run });
      const rendered = renderAll(report);
      const text = args.format === 'json' ? rendered.json : rendered.markdown;
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: report as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'test_run',
  {
    title: 'Run requirement-first acceptance tests (HTTP + CLI)',
    description:
      'Execute acceptance tests authored as `.acp/tests/*.acp.{json,yml,md}` spec files and inline ' +
      '```acp-test blocks in markdown requirements, then write JUnit results keyed by requirement so ' +
      'a subsequent requirements_trace flips each passing requirement to ✅ verified (and clears task ' +
      'drift). Steps are HTTP requests (status / JSON-path / header / body assertions, with capture for ' +
      'chaining) or `run` CLI commands; baseUrl/headers/login come from the config `runner` block, with ' +
      'secrets supplied via {{env.NAME}}. Returns per-case pass/fail + the results path.',
    inputSchema: {
      configPath: z.string().optional().describe('Path to acp-trace.json (default: ./acp-trace.json).'),
      req: z.string().optional().describe('Run only the cases for this requirement key.'),
      baseUrl: z.string().optional().describe('Override runner.baseUrl.'),
      out: z.string().optional().describe('JUnit output path (relative to repoDir).'),
    },
  },
  async (args) => {
    try {
      const configPath = resolve(args.configPath ?? 'acp-trace.json');
      const config = loadTraceConfig(configPath);
      const summary = await runAcceptance(dirname(configPath), config, { req: args.req, baseUrl: args.baseUrl, out: args.out });
      const lines = summary.total === 0
        ? ['No acceptance cases found (add .acp/tests specs or inline ```acp-test blocks).']
        : [
            ...summary.cases.map((c) => `${c.ok ? '✓' : '✗'} ${c.req}  ${c.name}${c.ok ? '' : `  — ${c.failure ?? 'failed'}`}`),
            `${summary.passed}/${summary.total} passed · results → ${summary.outPath}`,
            'Run requirements_trace to fold these into requirement status.',
          ];
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: { passed: summary.passed, failed: summary.failed, total: summary.total, outPath: summary.outPath, specCount: summary.specCount },
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'questions_to_html',
  {
    title: 'Open questions → interactive decision HTML',
    description:
      'Generate a self-contained interactive decision/Q&A page from an open-questions markdown file ' +
      '(a `## Flow overview` mermaid diagram + a `## Open questions (QA)` checklist whose questions ' +
      'carry `Q<n>` tokens that also appear on diagram nodes). Stakeholders answer in a browser; the ' +
      'bound nodes recolour, rejected branches dim, and answers export to markdown/JSON (which then ' +
      'publish via markdown_to_confluence / markdown_to_jira). Writes the HTML and returns a summary.',
    inputSchema: {
      input: z.string().describe('Path to the open-questions markdown file.'),
      out: z.string().optional().describe('Output HTML path (default: <input>.html).'),
      cdn: z.boolean().optional().describe('Load mermaid from a CDN instead of inlining it (smaller file).'),
    },
  },
  async (args) => {
    try {
      const md = readFileSync(args.input, 'utf8');
      const outPath = args.out ?? args.input.replace(/\.md$/i, '.html');
      const { html, data, unmapped } = generateQuestions(md, { mermaid: args.cdn ? 'cdn' : 'inline', outPath });
      writeFileSync(outPath, html, 'utf8');
      const lines = [
        `Wrote ${outPath} — ${data.questions.length} question(s), ${data.edges.length} edges`,
        unmapped.length ? `Unmapped: ${unmapped.map((n) => `Q${n}`).join(', ')}` : 'All questions mapped to a node.',
        'Answer in a browser, Export .md, then publish with markdown_to_confluence.',
      ];
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: { out: outPath, questions: data.questions.length, edges: data.edges.length, unmapped },
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'scaffold_test',
  {
    title: 'Scaffold a key-tagged test stub for a requirement',
    description:
      'Create a framework-correct test stub (Playwright/Jest/Vitest/node/xUnit) tagged with a ' +
      'requirement key, in the right test directory, from acp-trace.json. Use this when implementing a ' +
      'ticket: scaffold the test for `key`, implement it, then call requirements_trace to confirm it is ' +
      'verified. Never clobbers an existing file. The stub fails until implemented (a red definition of done).',
    inputSchema: {
      key: z.string().describe('Requirement key, e.g. PROJ-1.'),
      configPath: z.string().optional().describe('Path to acp-trace.json (default: ./acp-trace.json).'),
      tech: z.string().optional().describe('Which test group to scaffold into (playwright|jest|vitest|node|xunit); default the first.'),
      title: z.string().optional().describe('Test title (default: the key).'),
    },
  },
  async (args) => {
    try {
      const configPath = resolve(args.configPath ?? 'acp-trace.json');
      const config = loadTraceConfig(configPath);
      const r = scaffoldTest(config, dirname(configPath), { key: args.key, tech: args.tech, title: args.title });
      return {
        content: [{ type: 'text' as const, text: `${r.created ? 'Wrote' : 'Kept existing'} ${r.path} (${r.tech}) tagged @${args.key.toUpperCase()}. Implement it, then run requirements_trace.` }],
        structuredContent: r as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'requirement_status',
  {
    title: 'Status of one requirement',
    description:
      'Return one requirement\'s current state (verified / failing / unverified / specified, plus drift ' +
      '/ stale, the covering tests, and last run) from acp-trace.json — the quick "is KEY done?" check ' +
      'before closing a ticket. For the full matrix use requirements_trace.',
    inputSchema: {
      key: z.string().describe('Requirement key, e.g. PROJ-1.'),
      configPath: z.string().optional().describe('Path to acp-trace.json (default: ./acp-trace.json).'),
    },
  },
  async (args) => {
    try {
      const configPath = resolve(args.configPath ?? 'acp-trace.json');
      const config = loadTraceConfig(configPath);
      const r = await requirementStatus(config, dirname(configPath), args.key);
      if (!r) return { content: [{ type: 'text' as const, text: `${args.key.toUpperCase()} not found in the requirements.` }] };
      const text = `${r.key}: ${r.state}${r.drift ? ' (drift)' : ''}${r.stale ? ' (stale)' : ''} — ${r.tests.length} test(s), ${r.result.passed}/${r.result.failed}/${r.result.skipped} pass/fail/skip`;
      return { content: [{ type: 'text' as const, text }], structuredContent: r as unknown as Record<string, unknown> };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'pull_requirements',
  {
    title: 'Gather requirements from all sources into a local folder',
    description:
      'Collect business requirements from EVERY source configured in acp-trace.json (Jira / Confluence / ' +
      'markdown / GitHub or GitLab issues / a command script — a mix is fine) into one local folder: a ' +
      'markdown file per requirement (with frontmatter + an acceptance-criteria section) plus manifest.json. ' +
      'This is step 1 of the technical-analysis flow — the local source of truth to analyse against the code.',
    inputSchema: {
      configPath: z.string().optional().describe('Path to acp-trace.json (default: ./acp-trace.json).'),
      dir: z.string().optional().describe('Output folder (default: requirements).'),
      force: z.boolean().optional().describe('Overwrite an existing folder.'),
    },
  },
  async (args) => {
    try {
      const configPath = resolve(args.configPath ?? 'acp-trace.json');
      const baseDir = dirname(configPath);
      const config = loadTraceConfig(configPath);
      const reqs = await gatherRequirements(config, baseDir);
      const dir = args.dir ? resolve(baseDir, args.dir) : resolveStoreDir(baseDir, 'requirements');
      const dirRel = relative(baseDir, dir) || '.';
      const out = writeRequirementsFolder(reqs, dir, args.force);
      return {
        content: [{ type: 'text' as const, text: `Wrote ${out.files.length} requirement(s) to ${dirRel}/ (+ manifest.json).` }],
        structuredContent: { dir: dirRel, count: out.files.length, keys: out.files.map((f) => f.key) },
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'analyze',
  {
    title: 'Technical gap analysis → tech doc + Jira tasks + scaffolded tests',
    description:
      'Run the technical-analysis flow over acp-trace.json: gather requirements, compare against the ' +
      'codebase, and write (to a local folder) a GAP ANALYSIS, a Confluence-ready TECHNICAL ANALYSIS ' +
      'page (architecture/contracts/endpoints/mermaid flows), and JIRA TASKS — each story with ' +
      'acceptance criteria, a use-case flow, and tagged unit/e2e test stubs scaffolded into the repo. ' +
      'Uses the configured AI provider (AI_PROVIDER / *_API_KEY). Publish the outputs with ' +
      'markdown_to_confluence / markdown_to_jira.',
    inputSchema: {
      configPath: z.string().optional().describe('Path to acp-trace.json (default: ./acp-trace.json).'),
      out: z.string().optional().describe('Output folder (default: tech-analysis).'),
      scaffold: z.boolean().optional().describe('Scaffold the per-task test stubs (default true).'),
      ask: z.boolean().optional().describe('First pass: produce an open-questions form for unresolved decisions instead of the final docs.'),
      answers: z.string().optional().describe('Second pass: filled-in stakeholder answers (markdown) to incorporate.'),
    },
  },
  async (args) => {
    try {
      const configPath = resolve(args.configPath ?? 'acp-trace.json');
      const config = loadTraceConfig(configPath);
      const r = await analyze(config, dirname(configPath), { outDir: args.out, scaffold: args.scaffold, ask: args.ask, answers: args.answers });
      if (r.mode === 'ask') {
        return { content: [{ type: 'text' as const, text: `Wrote an open-questions form: ${r.questionsHtml}. Share it, collect answers, then call analyze again with { answers }.` }], structuredContent: { mode: 'ask', files: r.files, questionsHtml: r.questionsHtml } };
      }
      const lines = [
        `Wrote ${r.files.length} file(s) to ${relative(dirname(configPath), r.outDir) || '.'}/: gap-analysis.md, technical-analysis.md, tasks/`,
        `${r.tasks.length} task(s): ${r.tasks.map((t) => t.key).join(', ')}`,
        `${r.scaffolded.length} test stub(s) scaffolded; ${r.nativeTasks.length} native .acp/tasks created.`,
        'Publish with markdown_to_confluence (technical-analysis.md) + markdown_to_jira (tasks/).',
      ];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent: { outDir: r.outDir, files: r.files, tasks: r.tasks.map((t) => t.key), scaffolded: r.scaffolded } };
    } catch (err) {
      return errorResult(err);
    }
  },
);

// ── Task tools (Phase 1) ──────────────────────────────────────────────────────────────────────

function taskCtx(configPath?: string): { baseDir: string; config: ReturnType<typeof loadTraceConfig> } {
  const p = resolve(configPath ?? 'acp-trace.json');
  return { baseDir: dirname(p), config: loadTraceConfig(p) };
}

async function verificationsForMcp(
  baseDir: string,
  config: ReturnType<typeof loadTraceConfig>,
  tasks: Task[],
  opts: { run?: boolean },
): Promise<{ vs: TaskVerification[]; staleNote: string | null; hadReport: boolean }> {
  const resolved = resolveTasksConfig(config);
  const src = await reportForTasks(baseDir, config, { run: opts.run });
  if (!src.report) {
    const vs = tasks.map((t) => ({ task: t, done: resolved.doneStatuses.includes(t.status), drift: false, reason: null, requirements: [] }));
    return { vs, staleNote: null, hadReport: false };
  }
  return { vs: verifyTasks(tasks, src.report, resolved), staleNote: src.staleNote, hadReport: true };
}

server.registerTool(
  'task_add',
  {
    title: 'Create a task',
    description:
      'Create a local task in .acp/tasks, linked to requirement keys (many-to-many). Blocked when ' +
      'tasks.mode is not "local". Status defaults to the first configured status and is validated.',
    inputSchema: {
      title: z.string().describe('Task title.'),
      requirements: z.array(z.string()).optional().describe('Linked requirement key(s), e.g. ["PROJ-1"].'),
      tests: z.array(z.string()).optional().describe('Explicit test ref(s); coverage is otherwise derived via requirements.'),
      status: z.string().optional().describe('Initial status (default: first configured).'),
      assignee: z.string().optional(),
      scope: z.string().optional().describe('Scope name (uses its taskPrefix + subfolder if it sets one).'),
      configPath: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const { baseDir, config } = taskCtx(args.configPath);
      const t = addTask(baseDir, config, { title: args.title, requirements: args.requirements, tests: args.tests, status: args.status, assignee: args.assignee, scope: args.scope });
      return { content: [{ type: 'text' as const, text: `Created ${t.id} [${t.status}] ${t.title}` }], structuredContent: t as unknown as Record<string, unknown> };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'task_list',
  {
    title: 'List tasks (optionally drift-checked)',
    description:
      'List tasks, optionally filtered by status/requirement. With drift=true, cross-checks done tasks ' +
      'against the latest trace run (run=true re-runs the suites first) and flags ⚠️ done-but-unproven.',
    inputSchema: {
      status: z.string().optional(),
      req: z.string().optional().describe('Filter by a linked requirement key.'),
      drift: z.boolean().optional().describe('Cross-check done tasks for drift.'),
      run: z.boolean().optional().describe('Re-run suites before the drift check.'),
      configPath: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const { baseDir, config } = taskCtx(args.configPath);
      const tasks = listTasksFiltered(baseDir, config, { status: args.status, req: args.req });
      if (!args.drift) {
        return {
          content: [{ type: 'text' as const, text: tasks.map((t) => `${t.id} [${t.status}] ${t.title}`).join('\n') || '(no tasks)' }],
          structuredContent: { tasks } as unknown as Record<string, unknown>,
        };
      }
      const { vs, staleNote, hadReport } = await verificationsForMcp(baseDir, config, tasks, { run: args.run });
      const lines = vs.map((v) => `${v.drift ? '⚠️ ' : ''}${v.task.id} [${v.task.status}] ${v.task.title}`);
      if (!hadReport) lines.unshift('(no trace run found — drift not computed)');
      if (staleNote) lines.unshift(`stale: ${staleNote}`);
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') || '(no tasks)' }],
        structuredContent: { tasks: vs.map((v) => ({ ...v.task, drift: v.drift, reason: v.reason })) } as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'task_set_status',
  {
    title: 'Set a task’s status',
    description: 'Move a task to a new status (validated against tasks.statuses). Blocked when tasks.mode is not "local".',
    inputSchema: {
      id: z.string().describe('Task id, e.g. TASK-1.'),
      status: z.string().describe('New status (must be in tasks.statuses).'),
      configPath: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const { baseDir, config } = taskCtx(args.configPath);
      const t = setTaskStatus(baseDir, config, args.id, args.status);
      return { content: [{ type: 'text' as const, text: `${t.id} → [${t.status}]` }], structuredContent: t as unknown as Record<string, unknown> };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'task_link',
  {
    title: 'Link a task to requirement(s)/test(s)',
    description: 'Add requirement keys and/or test refs to a task (deduped). Blocked when tasks.mode is not "local".',
    inputSchema: {
      id: z.string(),
      requirements: z.array(z.string()).optional(),
      tests: z.array(z.string()).optional(),
      configPath: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const { baseDir, config } = taskCtx(args.configPath);
      const t = linkTask(baseDir, config, args.id, { requirements: args.requirements, tests: args.tests });
      return { content: [{ type: 'text' as const, text: `${t.id} requirements: ${t.requirements.join(', ') || '(none)'} · tests: ${t.tests.join(', ') || '(none)'}` }], structuredContent: t as unknown as Record<string, unknown> };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'task_board',
  {
    title: 'Render the task board',
    description:
      'Render the markdown kanban (columns by status, ⚠️ drift markers) to .acp/BOARD.md and return it. ' +
      'run=true re-runs the suites before the drift check.',
    inputSchema: {
      out: z.string().optional().describe('Output path (default: .acp/BOARD.md).'),
      run: z.boolean().optional(),
      configPath: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const { baseDir, config } = taskCtx(args.configPath);
      const tasks = listTasksFiltered(baseDir, config);
      const { vs, staleNote } = await verificationsForMcp(baseDir, config, tasks, { run: args.run });
      const md = renderBoard(vs, resolveTasksConfig(config), { title: config.project ? `${config.project} — Board` : 'Task Board' });
      const out = args.out ? resolve(baseDir, args.out) : boardPath(baseDir);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, md, 'utf8');
      const sum = summarizeDrift(vs);
      const note = staleNote ? `stale: ${staleNote}\n` : '';
      return {
        content: [{ type: 'text' as const, text: `${note}Board → ${relative(baseDir, out) || '.'} (${sum.total} task(s) · ${sum.done} done · ${sum.drift} ⚠️ drift)\n\n${md}` }],
        structuredContent: { path: relative(baseDir, out), total: sum.total, done: sum.done, drift: sum.drift } as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  'task_import',
  {
    title: 'Import Jira issues as read-only tasks',
    description:
      'Pull issues under tasks.jira.epic into .acp/tasks (source: jira) — requires tasks.mode: "jira". ' +
      'Idempotent: overwrites the cache and prunes issues no longer in the epic; local tasks untouched.',
    inputSchema: { configPath: z.string().optional() },
  },
  async (args) => {
    try {
      const { baseDir, config } = taskCtx(args.configPath);
      const r = await importJiraTasks(baseDir, config);
      return {
        content: [{ type: 'text' as const, text: `Imported ${r.imported.length} Jira issue(s)${r.pruned.length ? `, pruned ${r.pruned.length} stale` : ''}.` }],
        structuredContent: r as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('katastasi MCP server running on stdio\n');
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
