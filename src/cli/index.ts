#!/usr/bin/env node
/**
 * `ai-confluence-pipeline` (alias `acp`) CLI.
 *
 * Publishes markdown files to Jira / Confluence via the n8n publish webhooks.
 * The agent-facing equivalent is the MCP server (src/mcp/server.ts), which takes raw markdown.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { Command } from 'commander';
import { publishJira } from '../core/jira.js';
import { publishConfluence } from '../core/confluence.js';
import { pullJira, pullConfluence } from '../core/pull.js';
import { pushFolder } from '../core/push.js';
import { getConfig } from '../core/config.js';
import { loadTraceConfig, starterConfig, DEFAULT_CONFIG_FILENAME } from '../core/trace/config.js';
import { autodetect, REQUIREMENTS_STUB } from '../core/trace/autodetect.js';
import { scaffoldOrg } from '../core/trace/scaffold.js';
import { scaffoldTest } from '../core/trace/scaffoldTest.js';
import { runTrace, requirementStatus, gatherRequirements } from '../core/trace/index.js';
import { writeRequirementsFolder } from '../core/trace/requirements/folder.js';
import { analyze } from '../core/analyze/analyze.js';
import { resolveStoreDir, migrateStore } from '../core/trace/store.js';
import { resolveTasksConfig } from '../core/trace/config.js';
import { addTask, listTasksFiltered, getTask, setTaskStatus, linkTask } from '../core/trace/tasks/ops.js';
import { verifyTasks, summarizeDrift } from '../core/trace/tasks/verify.js';
import { renderBoard, boardPath } from '../core/trace/tasks/board.js';
import { reportForTasks } from '../core/trace/tasks/report.js';
import type { TaskVerification } from '../core/trace/tasks/verify.js';
import type { Task } from '../core/trace/tasks/model.js';
import { serve } from '../core/trace/serve.js';
import { serveCollector } from '../core/trace/collector.js';
import { generateQuestions } from '../core/questions/generate.js';
import { writeOutputs, updateRoadmapSection, publishConfluenceReport, stampJiraLabels, postReport } from '../core/trace/publish.js';
import { shouldNotify, sendNotification } from '../core/trace/notify.js';
import type { TraceReport } from '../core/trace/types.js';
import type {
  JiraPublishResult,
  JiraPullResult,
  ConfluencePullResult,
  PushFolderResult,
} from '../core/types.js';

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`File not found or unreadable: ${path}`);
  }
}

function firstHeading(md: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '(untitled)';
}

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n  Error: ${msg}\n`);
  process.exit(1);
}

const program = new Command();
program
  .name('katastasi')
  .description('Katastasi — documentation, task-tracking & testing framework. Local-first markdown; syncs to Jira/Confluence/issues/CI. (aliases: kat, acp)')
  .version('0.2.0');

program
  .command('jira')
  .description('Create or update a Jira Epic + linked Stories from markdown files.')
  .requiredOption('--epic <file>', 'markdown file for the Epic')
  .option('--task <file...>', 'markdown file(s) for Stories (repeatable / space-separated)', [])
  .option('--epic-key <key>', 'existing Epic key/URL to update instead of create')
  .option('--component <name>', 'default component for all issues')
  .option('--assignee <id>', 'default assignee (accountId, email, or profile URL)')
  .option('--reporter <id>', 'reporter (accountId, email, or profile URL)')
  .option('--dry-run', 'print the resolved payload without calling n8n', false)
  .action(async (opts) => {
    try {
      const epicMarkdown = read(opts.epic);
      const taskFiles: string[] = opts.task ?? [];
      const taskMarkdowns = taskFiles.map(read);

      const input = {
        epicMarkdown,
        taskMarkdowns,
        epicKey: opts.epicKey,
        component: opts.component,
        assignee: opts.assignee,
        reporter: opts.reporter,
      };

      process.stdout.write(`\n  Markdown -> Jira (via ${getConfig().webhookUrl})\n`);
      process.stdout.write(`  Epic:  ${opts.epic} -> ${firstHeading(epicMarkdown)}\n`);
      taskFiles.forEach((f, i) => process.stdout.write(`  Task:  ${f} -> ${firstHeading(taskMarkdowns[i])}\n`));

      if (opts.dryRun) {
        process.stdout.write(`\n  [DRY RUN] payload:\n${JSON.stringify(input, null, 2)}\n`);
        return;
      }

      const result = await publishJira(input);
      printJiraResult(result);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('confluence')
  .description('Create or update a Confluence page from markdown files.')
  .requiredOption('--page <file>', 'markdown file for the main page body')
  .option('--section <file...>', 'additional section markdown file(s) appended in order', [])
  .option('--title <title>', 'page title (defaults to the first heading in --page)')
  .option('--page-id <id>', 'existing page id to update instead of create')
  .option('--parent-page-id <id>', 'parent page id to nest under')
  .option('--label <label...>', 'label(s) to attach', [])
  .option('--dry-run', 'print the resolved payload without calling n8n', false)
  .action(async (opts) => {
    try {
      const pageMarkdown = read(opts.page);
      const sectionFiles: string[] = opts.section ?? [];
      const sectionMarkdowns = sectionFiles.map(read);

      const input = {
        pageMarkdown,
        sectionMarkdowns,
        title: opts.title,
        pageId: opts.pageId,
        parentPageId: opts.parentPageId,
        labels: opts.label,
      };

      process.stdout.write(`\n  Markdown -> Confluence (via ${getConfig().webhookUrl})\n`);
      process.stdout.write(`  Page:  ${opts.page} -> ${opts.title || firstHeading(pageMarkdown)}\n`);
      sectionFiles.forEach((f) => process.stdout.write(`  Section: ${f}\n`));

      if (opts.dryRun) {
        process.stdout.write(`\n  [DRY RUN] payload:\n${JSON.stringify(input, null, 2)}\n`);
        return;
      }

      const result = await publishConfluence(input);
      process.stdout.write(`\n  Done. ${result.page?.url ? result.page.url : JSON.stringify(result)}\n`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('pull-jira')
  .description('Reverse: pull a Jira Epic (+ stories + sub-tasks) into a markdown folder.')
  .argument('<epic>', 'Epic key (e.g. PROJ-12) or browse URL')
  .argument('<dir>', 'target directory to write the markdown folder into')
  .option('--no-recursive', 'pull only the epic, not its children')
  .option('--force', 'overwrite a non-empty target directory', false)
  .action(async (epic: string, dir: string, opts) => {
    try {
      process.stdout.write(`\n  Jira -> Markdown\n  Epic: ${epic} -> ${dir}\n`);
      const result = await pullJira(epic, dir, { recursive: opts.recursive, force: opts.force });
      printJiraPullResult(result);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('pull-confluence')
  .description('Reverse: pull a Confluence page (+ descendant pages) into a markdown folder.')
  .argument('<page>', 'Page id (e.g. 123456) or page URL')
  .argument('<dir>', 'target directory to write the markdown folder into')
  .option('--no-recursive', 'pull only the page, not its children')
  .option('--force', 'overwrite a non-empty target directory', false)
  .action(async (page: string, dir: string, opts) => {
    try {
      process.stdout.write(`\n  Confluence -> Markdown\n  Page: ${page} -> ${dir}\n`);
      const result = await pullConfluence(page, dir, { recursive: opts.recursive, force: opts.force });
      printConfluencePullResult(result);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('push-folder')
  .description('Reverse re-publish: push a pulled markdown folder (+ acp-pull.json) back to Jira/Confluence.')
  .argument('<dir>', 'folder produced by pull-jira / pull-confluence (must contain acp-pull.json)')
  .option('--dry-run', 'show the intended create/update actions without calling Atlassian', false)
  .action(async (dir: string, opts) => {
    try {
      process.stdout.write(`\n  Markdown folder -> Atlassian\n  Dir: ${dir}${opts.dryRun ? '  [DRY RUN]' : ''}\n`);
      const result = await pushFolder(dir, { dryRun: opts.dryRun });
      printPushResult(result);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('pipeline')
  .description('Run the whole BA→dev pipeline in one go: gather requirements → gaps → analyze (→ tech docs + Jira tasks + tagged tests).')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--reqs-dir <path>', 'requirements folder (default: .acp/requirements)')
  .option('--out <dir>', 'analysis output folder (default: .acp/tech-analysis)')
  .option('--ask', 'stop after producing the open-questions form (resolve decisions first)', false)
  .option('--answers <file>', 'incorporate filled-in stakeholder answers (markdown)')
  .option('--no-scaffold', 'do not scaffold the per-task test stubs')
  .option('--publish-confluence', 'publish technical-analysis.md to Confluence', false)
  .option('--publish-jira', 'publish the tasks (epic + stories) to Jira', false)
  .option('--force', 'overwrite an existing requirements folder', false)
  .action(async (opts) => {
    try {
      const configPath = resolve(opts.config);
      const baseDir = dirname(configPath);
      const config = loadTraceConfig(configPath);

      process.stdout.write('\n  [1/3] Gathering requirements…\n');
      const reqsDir = opts.reqsDir ? resolve(baseDir, opts.reqsDir) : resolveStoreDir(baseDir, 'requirements');
      const folder = writeRequirementsFolder(await gatherRequirements(config, baseDir), reqsDir, opts.force);
      process.stdout.write(`        ${folder.files.length} requirement(s) → ${relative(baseDir, reqsDir) || '.'}/\n`);

      process.stdout.write('  [2/3] Implementation gaps…\n');
      const report = await runTrace(config, baseDir, { save: false });
      const scanned = report.requirements.some((r) => r.inCode !== null);
      const notInCode = report.requirements.filter((r) => r.inCode === false).length;
      process.stdout.write(scanned
        ? `        ${report.stats.implemented} in code · ${notInCode} not started · ${report.stats.verified} verified\n`
        : '        (no `code` globs configured — add scope.code to see implementation gaps)\n');

      process.stdout.write(`  [3/3] Technical analysis (AI)…${opts.ask ? '  [ask: surfacing decisions]' : ''}\n`);
      const answers = opts.answers ? read(resolve(opts.answers)) : undefined;
      const r = await analyze(config, baseDir, { outDir: opts.out, scaffold: opts.scaffold, ask: opts.ask, answers });
      if (r.mode === 'ask') {
        process.stdout.write(`\n  Open the form, collect answers, then:  katastasi pipeline --answers <answers>.md\n  (form: ${r.questionsHtml})\n`);
        return;
      }
      const outRel = relative(baseDir, r.outDir) || '.';
      process.stdout.write(`        ${r.tasks.length} task(s), ${r.scaffolded.length} test stub(s) → ${outRel}/\n`);

      if (opts.publishConfluence) {
        const res = await publishConfluence({ pageMarkdown: read(join(r.outDir, 'technical-analysis.md')) });
        process.stdout.write(`  Confluence: ${res.page?.url ?? 'published'}\n`);
      }
      if (opts.publishJira) {
        const taskMarkdowns = r.tasks.map((t) => read(join(r.outDir, 'tasks', `${t.key}.md`)));
        printJiraResult(await publishJira({ epicMarkdown: read(join(r.outDir, 'tasks', 'epic.md')), taskMarkdowns }));
      }
      process.stdout.write(`\n  Done. Implement against ${outRel}/tasks/, then verify:  katastasi trace --run --fail-on regression\n`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('analyze')
  .description('AI: requirements + codebase → gap analysis + technical-analysis (Confluence) + Jira tasks + scaffolded tests.')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--out <dir>', 'output folder (default: .acp/tech-analysis)')
  .option('--ask', 'first pass: produce an open-questions form for the decisions to resolve', false)
  .option('--answers <file>', 'second pass: incorporate filled-in stakeholder answers (markdown)')
  .option('--no-scaffold', 'do not scaffold the per-task test stubs')
  .option('--publish-confluence', 'also publish technical-analysis.md to Confluence', false)
  .option('--publish-jira', 'also publish the tasks (epic + stories) to Jira', false)
  .action(async (opts) => {
    try {
      const configPath = resolve(opts.config);
      const baseDir = dirname(configPath);
      const config = loadTraceConfig(configPath);
      const answers = opts.answers ? read(resolve(opts.answers)) : undefined;
      process.stdout.write(`\n  Analysing requirements vs codebase (AI)…${opts.ask ? '  [ask: surfacing open decisions]' : ''}\n`);
      const r = await analyze(config, baseDir, { outDir: opts.out, scaffold: opts.scaffold, ask: opts.ask, answers });
      const outRel = relative(baseDir, r.outDir) || '.';
      if (r.mode === 'ask') {
        r.files.forEach((f) => process.stdout.write(`    + ${f}\n`));
        process.stdout.write(`\n  Open the form, collect answers, then:  katastasi analyze --answers <answers>.md\n  (form: ${r.questionsHtml})\n`);
        return;
      }
      process.stdout.write(`  Wrote ${r.files.length} file(s) → ${outRel}/  ·  ${r.tasks.length} task(s)  ·  ${r.scaffolded.length} test stub(s)\n`);
      r.files.forEach((f) => process.stdout.write(`    + ${f}\n`));
      r.scaffolded.forEach((f) => process.stdout.write(`    + ${f} (test stub)\n`));

      if (opts.publishConfluence) {
        const res = await publishConfluence({ pageMarkdown: read(join(r.outDir, 'technical-analysis.md')) });
        process.stdout.write(`  Confluence: ${res.page?.url ?? 'published'}\n`);
      }
      if (opts.publishJira) {
        const epicMarkdown = read(join(r.outDir, 'tasks', 'epic.md'));
        const taskMarkdowns = r.tasks.map((t) => read(join(r.outDir, 'tasks', `${t.key}.md`)));
        printJiraResult(await publishJira({ epicMarkdown, taskMarkdowns }));
      }
      if (!opts.publishConfluence && !opts.publishJira) {
        process.stdout.write(`  Publish:  katastasi confluence --page ${outRel}/technical-analysis.md  ·  katastasi jira --epic ${outRel}/tasks/epic.md --task ${outRel}/tasks/*.md\n`);
      }
    } catch (err) {
      fail(err);
    }
  });

function taskCtx(configPath: string): { baseDir: string; config: ReturnType<typeof loadTraceConfig> } {
  const p = resolve(configPath);
  return { baseDir: dirname(p), config: loadTraceConfig(p) };
}

function printTaskRows(rows: Array<{ task: Task; drift?: boolean }>): void {
  if (!rows.length) {
    process.stdout.write('  (no tasks)\n');
    return;
  }
  const idW = Math.max(2, ...rows.map((r) => r.task.id.length));
  const stW = Math.max(6, ...rows.map((r) => r.task.status.length));
  for (const { task, drift } of rows) {
    const reqs = task.requirements.length ? `  · ${task.requirements.join(', ')}` : '';
    process.stdout.write(`  ${task.id.padEnd(idW)}  ${task.status.padEnd(stW)}  ${task.title}${reqs}${drift ? ' ⚠️' : ''}\n`);
  }
}

/** Build verifications for board/verify/list --drift; tolerates "no run yet" (drift off, board still renders). */
async function verificationsFor(
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

const taskCmd = program.command('task').description('Local task tracking (.acp/tasks): add / list / show / set / link / board / verify.');

taskCmd
  .command('add <title>')
  .description('Create a task.')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--req <keys...>', 'linked requirement key(s)')
  .option('--test <refs...>', 'explicit test ref(s)')
  .option('--status <status>', 'initial status (default: first configured)')
  .option('--assignee <who>', 'assignee')
  .option('--scope <name>', 'scope (uses its taskPrefix + subfolder if it sets one)')
  .action((title, opts) => {
    try {
      const { baseDir, config } = taskCtx(opts.config);
      const t = addTask(baseDir, config, { title, requirements: opts.req, tests: opts.test, status: opts.status, assignee: opts.assignee, scope: opts.scope });
      process.stdout.write(`\n  Created ${t.id} [${t.status}] ${t.title}${t.requirements.length ? `  · ${t.requirements.join(', ')}` : ''}\n`);
    } catch (err) {
      fail(err);
    }
  });

taskCmd
  .command('list')
  .description('List tasks (optionally cross-checked for drift).')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--status <status>', 'filter by status')
  .option('--req <key>', 'filter by linked requirement')
  .option('--drift', 'cross-check done tasks against the latest run', false)
  .option('--run', 'refresh: re-run suites before the drift check', false)
  .action(async (opts) => {
    try {
      const { baseDir, config } = taskCtx(opts.config);
      const tasks = listTasksFiltered(baseDir, config, { status: opts.status, req: opts.req });
      process.stdout.write('\n');
      if (!opts.drift) {
        printTaskRows(tasks.map((t) => ({ task: t })));
        return;
      }
      const { vs, staleNote, hadReport } = await verificationsFor(baseDir, config, tasks, { run: opts.run });
      if (!hadReport) process.stdout.write('  (no trace run found — drift not computed; run `katastasi trace` or pass --run)\n');
      if (staleNote) process.stdout.write(`  ⚠️ ${staleNote}\n`);
      printTaskRows(vs.map((v) => ({ task: v.task, drift: v.drift })));
    } catch (err) {
      fail(err);
    }
  });

taskCmd
  .command('show <id>')
  .description('Show one task.')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .action((id, opts) => {
    try {
      const { baseDir, config } = taskCtx(opts.config);
      const t = getTask(baseDir, config, id);
      if (!t) {
        fail(new Error(`Task not found: ${id}`));
        return;
      }
      process.stdout.write(
        `\n  ${t.id}  [${t.status}]  ${t.title}\n` +
          `  requirements: ${t.requirements.join(', ') || '(none)'}\n` +
          `  tests:        ${t.tests.join(', ') || '(derived via requirements)'}\n` +
          `  assignee:     ${t.assignee ?? '(none)'}\n` +
          `  source:       ${t.source}   created ${t.created}  ·  updated ${t.updated}\n` +
          (t.body ? `\n${t.body}\n` : ''),
      );
    } catch (err) {
      fail(err);
    }
  });

taskCmd
  .command('set <id> <status>')
  .description('Set a task’s status.')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .action((id, status, opts) => {
    try {
      const { baseDir, config } = taskCtx(opts.config);
      const t = setTaskStatus(baseDir, config, id, status);
      process.stdout.write(`\n  ${t.id} → [${t.status}]\n`);
    } catch (err) {
      fail(err);
    }
  });

taskCmd
  .command('link <id>')
  .description('Link a task to requirement(s) / test(s).')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--req <keys...>', 'requirement key(s) to add')
  .option('--test <refs...>', 'test ref(s) to add')
  .action((id, opts) => {
    try {
      const { baseDir, config } = taskCtx(opts.config);
      const t = linkTask(baseDir, config, id, { requirements: opts.req, tests: opts.test });
      process.stdout.write(`\n  ${t.id} requirements: ${t.requirements.join(', ') || '(none)'}  ·  tests: ${t.tests.join(', ') || '(none)'}\n`);
    } catch (err) {
      fail(err);
    }
  });

taskCmd
  .command('board')
  .description('Render the markdown task board (with drift markers).')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--out <path>', 'output path (default: .acp/BOARD.md)')
  .option('--run', 'refresh: re-run suites before the drift check', false)
  .action(async (opts) => {
    try {
      const { baseDir, config } = taskCtx(opts.config);
      const tasks = listTasksFiltered(baseDir, config);
      const { vs, staleNote } = await verificationsFor(baseDir, config, tasks, { run: opts.run });
      if (staleNote) process.stdout.write(`\n  ⚠️ ${staleNote}\n`);
      const md = renderBoard(vs, resolveTasksConfig(config), { title: config.project ? `${config.project} — Board` : 'Task Board' });
      const out = opts.out ? resolve(baseDir, opts.out) : boardPath(baseDir);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, md, 'utf8');
      const sum = summarizeDrift(vs);
      process.stdout.write(`  Board → ${relative(baseDir, out) || '.'}  (${sum.total} task(s) · ${sum.done} done · ${sum.drift} ⚠️ drift)\n`);
    } catch (err) {
      fail(err);
    }
  });

taskCmd
  .command('verify')
  .description('Cross-check done tasks against requirement verification (the honesty gate).')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--run', 'refresh: re-run suites first', false)
  .option('--fail-on <what>', 'exit 1 on: drift')
  .action(async (opts) => {
    try {
      const { baseDir, config } = taskCtx(opts.config);
      const tasks = listTasksFiltered(baseDir, config);
      const { vs, staleNote, hadReport } = await verificationsFor(baseDir, config, tasks, { run: opts.run });
      process.stdout.write('\n');
      if (!hadReport) {
        process.stdout.write('  No trace run found — pass --run to compute, or run `katastasi trace` first.\n');
        process.exit(opts.failOn === 'drift' ? 1 : 0);
      }
      if (staleNote) process.stdout.write(`  ⚠️ ${staleNote}\n`);
      const sum = summarizeDrift(vs);
      process.stdout.write(`  ${sum.total} task(s) · ${sum.done} done · ${sum.drift} ⚠️ drift\n`);
      for (const v of sum.drifted) process.stdout.write(`    ⚠️ ${v.task.id} ${v.task.title} — ${v.reason}\n`);
      process.exit(opts.failOn === 'drift' && sum.drift > 0 ? 1 : 0);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('migrate')
  .description('Move legacy root store dirs (requirements/, runs/, tech-analysis/) into the tidy .acp/ store.')
  .option('--config <path>', 'config file (locates the repo root)', DEFAULT_CONFIG_FILENAME)
  .action((opts) => {
    try {
      const baseDir = dirname(resolve(opts.config));
      const r = migrateStore(baseDir);
      if (!r.moved.length && !r.skipped.length) {
        process.stdout.write('\n  Nothing to migrate — no legacy root store dirs found.\n');
        return;
      }
      process.stdout.write('\n  .acp/ store migration:\n');
      r.moved.forEach((n) => process.stdout.write(`    moved   ${n}/ → .acp/${n}/\n`));
      r.skipped.forEach((s) => process.stdout.write(`    skipped ${s}\n`));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('questions')
  .description('Generate an interactive decision/Q&A HTML from an open-questions markdown (mermaid flow + QA list).')
  .argument('<input>', 'open-questions markdown file (see docs/QUESTIONS.md for the conventions)')
  .option('--out <file>', 'output HTML path (default: <input>.html)')
  .option('--cdn', 'load mermaid from a CDN instead of inlining it (smaller file, needs internet)', false)
  .option('--link', 'reference the vendored mermaid by relative path instead of inlining', false)
  .action((input: string, opts) => {
    try {
      const md = read(input);
      const outPath = opts.out ?? input.replace(/\.md$/i, '.html');
      const mermaid = opts.cdn ? 'cdn' : opts.link ? 'link' : 'inline';
      const { html, data, unmapped } = generateQuestions(md, { mermaid, outPath });
      writeFileSync(outPath, html, 'utf8');
      const branched = data.questions.filter((q) => q.targets.some(Boolean)).length;
      process.stdout.write(`\n  Wrote ${outPath}\n`);
      process.stdout.write(`  ${data.questions.length} question(s) (${branched} branched), ${data.edges.length} edges, mermaid=${mermaid}\n`);
      process.stdout.write(unmapped.length ? `  ⚠️  unmapped: ${unmapped.map((n) => `Q${n}`).join(', ')}\n` : '  all questions mapped to a node\n');
      process.stdout.write('  Answer in a browser, Export .md, then publish:  acp confluence --page <answers>.md\n');
    } catch (err) {
      fail(err);
    }
  });

const traceCmd = program
  .command('trace')
  .description('Build a Requirements Traceability report (tests ↔ requirements ↔ status) from acp-trace.json.')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--md <path>', 'also write the markdown report to this path')
  .option('--html <path>', 'also write the HTML dashboard to this path')
  .option('--json <path>', 'also write the JSON report to this path')
  .option('--roadmap <path>', 'fold the report into this existing doc (between acp:trace markers)')
  .option('--section <id>', 'section id used with --roadmap', 'rtm')
  .option('--publish-confluence', 'update the Confluence page from config.publish.confluence', false)
  .option('--stamp-jira', 'stamp config.publish.jira.verifiedLabel onto verified Jira issues', false)
  .option('--post <url>', 'POST the full report JSON to this endpoint (your own server); else config.output.post')
  .option('--notify <url>', 'POST a summary to this webhook (Slack/Teams/generic); else config.notify.webhook')
  .option('--notify-on <level>', 'when to notify: regression | failing | stale | always')
  .option('--run', 'execute each test group\'s command before tracing (re-run the suites)', false)
  .option('--no-save', 'do not persist this run to the history dir')
  .option('--no-compare', 'do not diff against the previous run / baseline')
  .option('--fail-on <level>', 'exit non-zero on: none | regression | stale | drift | failing', 'none')
  .action(async (opts) => {
    try {
      const configPath = resolve(opts.config);
      const baseDir = dirname(configPath);
      const config = loadTraceConfig(configPath);
      process.stdout.write(`\n  Tracing requirements (config: ${opts.config})${opts.run ? '  [running suites]' : ''}\n`);

      const report = await runTrace(config, baseDir, { run: opts.run, save: opts.save, compare: opts.compare });

      // File outputs: config.output merged with CLI overrides.
      const output = {
        markdown: opts.md ?? config.output?.markdown,
        html: opts.html ?? config.output?.html,
        json: opts.json ?? config.output?.json,
      };
      const written = writeOutputs(report, output, baseDir);

      // Roadmap section: CLI flag wins, else config.publish.roadmap.
      const roadmap = opts.roadmap
        ? { path: opts.roadmap, sectionId: opts.section }
        : config.publish?.roadmap;
      if (roadmap) written.push(updateRoadmapSection(report, roadmap, baseDir));

      printTraceSummary(report, written);

      if (opts.publishConfluence && config.publish?.confluence) {
        const url = await publishConfluenceReport(report, config.publish.confluence);
        process.stdout.write(`  Published to Confluence: ${url}\n`);
      }

      if (opts.stampJira && config.publish?.jira?.verifiedLabel) {
        const { added, removed } = await stampJiraLabels(report, config.publish.jira);
        process.stdout.write(`  Stamped Jira "${config.publish.jira.verifiedLabel}": +${added} / -${removed}\n`);
      }

      const postTarget = opts.post ?? config.output?.post;
      if (postTarget) {
        const ok = await postReport(report, postTarget);
        process.stdout.write(`  Posted report to server: ${ok ? 'ok' : 'failed'}\n`);
      }

      const notifyUrl = opts.notify ?? config.notify?.webhook;
      const notifyOn = opts.notifyOn ?? config.notify?.on ?? 'regression';
      if (notifyUrl && shouldNotify(report, notifyOn)) {
        const ok = await sendNotification(notifyUrl, report);
        process.stdout.write(`  Notified webhook (on ${notifyOn}): ${ok ? 'sent' : 'failed'}\n`);
      }

      process.exit(exitCode(report, opts.failOn));
    } catch (err) {
      fail(err);
    }
  });

traceCmd
  .command('serve')
  .description('Start the web portal: live RTM dashboard + Run button + history + JSON API.')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--port <n>', 'port to listen on', (v) => parseInt(v, 10))
  .option('--host <host>', 'bind host (default 127.0.0.1; use 0.0.0.0 in a container)')
  .option('--read-only', 'git-backed central dashboard: show the latest committed run, disable running', false)
  .option('--pull', 'in --read-only mode, git pull on an interval to pick up newly committed runs', false)
  .option('--pull-interval <sec>', 'seconds between pulls (default 60)', (v) => parseInt(v, 10))
  .option('--watch', 're-trace on an interval and live-update open dashboards (SSE)', false)
  .option('--interval <sec>', 'seconds between watch re-traces (default 5)', (v) => parseInt(v, 10))
  .option('--token <secret>', 'require this shared secret on every request (or set RTM_TOKEN)')
  .option('--public', 'with a token, still allow read-only dashboard views without it', false)
  .action(async (opts) => {
    try {
      const configPath = resolve(opts.config);
      await serve(configPath, dirname(configPath), {
        port: opts.port,
        host: opts.host,
        readOnly: opts.readOnly,
        pull: opts.pull,
        pullIntervalSec: opts.pullInterval,
        watch: opts.watch,
        watchIntervalSec: opts.interval,
        token: opts.token ?? process.env.RTM_TOKEN,
        public: opts.public,
      });
    } catch (err) {
      fail(err);
    }
  });

traceCmd
  .command('gaps')
  .description('Implementation gap report: which requirements are not in code, coded-but-untested, or unverified.')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--fail-on-gap', 'exit 1 if any requirement is not referenced in code', false)
  .action(async (opts) => {
    try {
      const configPath = resolve(opts.config);
      const config = loadTraceConfig(configPath);
      const report = await runTrace(config, dirname(configPath), { save: false });
      const scanned = report.requirements.some((r) => r.inCode !== null);
      const notInCode = report.requirements.filter((r) => r.inCode === false);
      const codedNoTest = report.requirements.filter((r) => r.inCode === true && r.tests.length === 0);
      const codedNotVerified = report.requirements.filter((r) => r.inCode === true && r.tests.length > 0 && r.state !== 'verified');

      process.stdout.write('\n  Implementation gaps\n');
      if (!scanned) process.stdout.write('  (no `code` globs configured — add scope.code to scan implementation code)\n');
      const group = (label: string, rows: typeof report.requirements) => {
        process.stdout.write(`\n  ${label} (${rows.length})\n`);
        rows.forEach((r) => process.stdout.write(`    [${r.key}] ${r.title}\n`));
      };
      if (scanned) group('📋 Not referenced in code (not started)', notInCode);
      group('🧪 In code but no test', codedNoTest);
      group('❌ Tested but not verified', codedNotVerified);
      process.exit(opts.failOnGap && notInCode.length > 0 ? 1 : 0);
    } catch (err) {
      fail(err);
    }
  });

traceCmd
  .command('pull-requirements')
  .description('Gather requirements from ALL configured sources (Jira/Confluence/markdown/issues/command) into one local folder.')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--dir <path>', 'output folder (default: .acp/requirements)')
  .option('--force', 'overwrite an existing requirements folder', false)
  .action(async (opts) => {
    try {
      const configPath = resolve(opts.config);
      const baseDir = dirname(configPath);
      const config = loadTraceConfig(configPath);
      const dir = opts.dir ? resolve(baseDir, opts.dir) : resolveStoreDir(baseDir, 'requirements');
      const dirRel = relative(baseDir, dir) || '.';
      process.stdout.write(`\n  Gathering requirements (config: ${opts.config})\n`);
      const reqs = await gatherRequirements(config, baseDir);
      const out = writeRequirementsFolder(reqs, dir, opts.force);
      const bySource = out.files.reduce<Record<string, number>>((m, r) => ((m[r.source] = (m[r.source] ?? 0) + 1), m), {});
      process.stdout.write(`  Wrote ${out.files.length} requirement(s) → ${dirRel}/ (${Object.entries(bySource).map(([s, n]) => `${s}:${n}`).join(', ')})\n`);
      process.stdout.write(`  Manifest: ${dirRel}/manifest.json\n  Next: run the technical-analysis flow over this folder (see docs/AGENT_PROMPT.md).\n`);
    } catch (err) {
      fail(err);
    }
  });

traceCmd
  .command('scaffold-test')
  .description('Write a framework-correct, key-tagged test stub for a requirement (agent/dashboard test creation).')
  .argument('<key>', 'requirement key, e.g. PROJ-1')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .option('--tech <tech>', 'which test group to scaffold into (playwright|jest|vitest|node|xunit); default the first')
  .option('--title <title>', 'test title (default: the key)')
  .action((key: string, opts) => {
    try {
      const configPath = resolve(opts.config);
      const config = loadTraceConfig(configPath);
      const r = scaffoldTest(config, dirname(configPath), { key, tech: opts.tech, title: opts.title });
      process.stdout.write(`\n  ${r.created ? 'Wrote' : 'Kept existing'} ${r.path} (${r.tech}) — tagged @${key.toUpperCase()}\n  Implement it, then:  acp trace --run --config ${opts.config}\n`);
    } catch (err) {
      fail(err);
    }
  });

traceCmd
  .command('status')
  .description('Print one requirement\'s current state (is KEY verified?).')
  .argument('<key>', 'requirement key, e.g. PROJ-1')
  .option('--config <path>', 'config file', DEFAULT_CONFIG_FILENAME)
  .action(async (key: string, opts) => {
    try {
      const configPath = resolve(opts.config);
      const config = loadTraceConfig(configPath);
      const r = await requirementStatus(config, dirname(configPath), key);
      if (!r) {
        process.stdout.write(`\n  ${key.toUpperCase()} not found in the requirements.\n`);
        process.exit(2);
      }
      process.stdout.write(`\n  ${r.key}: ${r.state}${r.drift ? ' ⚠️ drift' : ''}${r.stale ? ' ⏳ stale' : ''}\n`);
      process.stdout.write(`  ${r.title}\n  tests: ${r.tests.length}  ·  passed/failed/skipped: ${r.result.passed}/${r.result.failed}/${r.result.skipped}${r.result.lastRun ? `  ·  last run ${r.result.lastRun.slice(0, 16)}` : ''}\n`);
      process.exit(r.state === 'verified' ? 0 : 1);
    } catch (err) {
      fail(err);
    }
  });

traceCmd
  .command('collector')
  .description('Run a shared results backend: receives reports (POST /ingest) from every dev/CI and serves an aggregated dashboard.')
  .option('--port <n>', 'port (default 9000)', (v) => parseInt(v, 10))
  .option('--host <host>', 'bind host (default 0.0.0.0)')
  .option('--dir <path>', 'where to store posted reports (default collector-data)')
  .option('--token <secret>', 'require this secret to POST /ingest (and to view, unless --public); or RTM_TOKEN')
  .option('--public', 'allow viewing without the token (ingest still requires it)', false)
  .option('--keep <n>', 'cap stored runs per project', (v) => parseInt(v, 10))
  .action(async (opts) => {
    try {
      await serveCollector({
        port: opts.port,
        host: opts.host,
        dir: opts.dir,
        token: opts.token ?? process.env.RTM_TOKEN,
        public: opts.public,
        keep: opts.keep,
      });
    } catch (err) {
      fail(err);
    }
  });

traceCmd
  .command('init')
  .description('Scaffold acp-trace.json. Autodetects test frameworks + a requirements source by default.')
  .option('--out <path>', 'output path', DEFAULT_CONFIG_FILENAME)
  .option('--project <name>', 'project label')
  .option('--jira-epic <key>', 'requirement source: a Jira epic key/URL (skips autodetect)')
  .option('--markdown <path>', 'requirement source: a markdown spec file (skips autodetect)')
  .option('--roadmap <path>', 'requirement source: a roadmap HTML file (skips autodetect)')
  .option('--confluence-page <id>', 'requirement source: a Confluence page id (skips autodetect)')
  .option('--profile <stack>', 'preset the requirement source: github | gitlab | jira | confluence | markdown | command')
  .option('--template', 'write a plain template instead of autodetecting', false)
  .option('--all', 'org setup: also generate a portal token (.env) + compose service + PR GitHub Action', false)
  .option('--force', 'overwrite an existing config', false)
  .action((opts) => {
    try {
      const out = resolve(opts.out);
      if (existsSync(out) && !opts.force) {
        throw new Error(`${opts.out} already exists. Use --force to overwrite.`);
      }
      const hinted = !opts.profile && (opts.jiraEpic || opts.markdown || opts.roadmap || opts.confluencePage || opts.template);
      if (hinted) {
        const content = starterConfig({
          project: opts.project,
          jiraEpic: opts.jiraEpic,
          markdownPath: opts.markdown,
          roadmapPath: opts.roadmap,
          confluencePageId: opts.confluencePage,
        });
        writeFileSync(out, content, 'utf8');
        process.stdout.write(`\n  Wrote ${opts.out}\n  Edit it, then run:  acp trace --config ${opts.out}\n`);
        return;
      }
      // Autodetect (default), optionally with a stack profile presetting the requirement source.
      const repoDir = process.cwd();
      const plan = autodetect(repoDir, opts.project, opts.profile);
      plan.notes.forEach((n) => process.stdout.write(`  ${n}\n`));
      if (plan.createRequirementsStub) {
        const stubPath = resolve(repoDir, plan.createRequirementsStub);
        if (!existsSync(stubPath)) {
          mkdirSync(dirname(stubPath), { recursive: true });
          writeFileSync(stubPath, REQUIREMENTS_STUB, 'utf8');
        }
      }
      writeFileSync(out, `${JSON.stringify(plan.config, null, 2)}\n`, 'utf8');
      process.stdout.write(`\n  Wrote ${opts.out}\n`);

      if (opts.all) {
        const s = scaffoldOrg(repoDir, opts.force);
        s.written.forEach((f) => process.stdout.write(`  + ${f.replace(`${repoDir}\\`, '').replace(`${repoDir}/`, '')}\n`));
        s.skipped.forEach((f) => process.stdout.write(`  · kept existing ${f.replace(`${repoDir}\\`, '').replace(`${repoDir}/`, '')}\n`));
        process.stdout.write(`  + .env RTM_TOKEN (${s.tokenCreated ? 'generated' : 'existing'})\n`);
        process.stdout.write('\n  Org setup ready. Start the always-on portal:\n');
        process.stdout.write('    docker compose -f docker-compose.trace.yml up -d\n');
        process.stdout.write(`    open  http://localhost:8787/?token=${s.token}\n`);
        process.stdout.write('  PR checks: commit .github/workflows/rtm.yml. Local dev: acp trace serve\n');
        return;
      }

      process.stdout.write(`  Next:  acp trace serve --config ${opts.out}   (or: acp trace --config ${opts.out} --run)\n`);
      process.stdout.write('  Org setup (token + compose + CI) in one go:  acp trace init --all\n');
    } catch (err) {
      fail(err);
    }
  });

function printTraceSummary(report: TraceReport, written: string[]): void {
  const s = report.stats;
  const g = report.git;
  const commit = g.shortSha ? `${g.shortSha}${g.branch ? ` (${g.branch})` : ''}${g.dirty ? ' +dirty' : ''}` : '(no git)';
  process.stdout.write(`\n  Commit: ${commit}\n`);
  process.stdout.write(
    `  ✅ ${s.verified} verified  ❌ ${s.failing} failing  🧪 ${s.unverified} unverified  📋 ${s.specified} specified\n`,
  );
  process.stdout.write(`  ⚠️  ${s.drift} drift   ⏳ ${s.stale} stale   👻 ${s.orphanTests} orphan tests   Coverage: ${s.coveragePct}%\n`);
  if (report.comparedTo) {
    process.stdout.write(`  vs ${report.comparedTo.ref ?? 'prior'} (${report.comparedTo.generatedAt}) — ⛔ ${s.regressions} regression(s)\n`);
  }
  if (written.length) process.stdout.write(`  Wrote: ${written.join(', ')}\n`);
  const regressions = report.regressions ?? [];
  if (regressions.length) {
    process.stdout.write('\n  ⛔ Regressions since the last run:\n');
    regressions.forEach((c) => process.stdout.write(`    [${c.key}] ${c.title} — ${c.from} → ${c.to}\n`));
  }
  const drifted = report.requirements.filter((r) => r.drift);
  if (drifted.length) {
    process.stdout.write('\n  Drift (declared done, not verified):\n');
    drifted.forEach((r) => process.stdout.write(`    [${r.key}] ${r.title} — ${r.state}\n`));
  }
}

function exitCode(report: TraceReport, failOn: string): number {
  const { failing, drift, regressions, stale } = report.stats;
  if (failOn === 'failing' && failing > 0) return 1;
  if (failOn === 'regression' && regressions > 0) return 1;
  if (failOn === 'stale' && (failing > 0 || stale > 0)) return 1;
  if (failOn === 'drift' && (failing > 0 || drift > 0)) return 1;
  return 0;
}

function printPushResult(result: PushFolderResult): void {
  if (result.kind === 'jira') {
    const issues = result.issues ?? [];
    process.stdout.write(`\n  Done. ${issues.length} issue(s)\n`);
    issues.forEach((i) => process.stdout.write(`  [${i.key}] ${i.action}: ${i.file}${i.url ? ` — ${i.url}` : ''}\n`));
  } else {
    const pages = result.pages ?? [];
    process.stdout.write(`\n  Done. ${pages.length} page(s)\n`);
    pages.forEach((p) => process.stdout.write(`  [${p.pageId}] ${p.action}: ${p.dir}/page.md${p.url ? ` — ${p.url}` : ''}\n`));
  }
}

function printJiraPullResult(result: JiraPullResult): void {
  process.stdout.write(`\n  Done. ${result.issues.length} issue(s) written to ${result.dir}\n`);
  result.issues.forEach((i) => process.stdout.write(`  [${i.key}] ${i.type}: ${i.file}\n`));
  process.stdout.write(`  Manifest: ${result.manifestPath}\n`);
}

function printConfluencePullResult(result: ConfluencePullResult): void {
  process.stdout.write(`\n  Done. ${result.pages.length} page(s) written to ${result.dir}\n`);
  result.pages.forEach((p) => process.stdout.write(`  [${p.pageId}] ${p.title} -> ${p.dir}/page.md\n`));
  process.stdout.write(`  Manifest: ${result.manifestPath}\n`);
}

function printJiraResult(result: JiraPublishResult): void {
  process.stdout.write(`\n  Done.\n`);
  process.stdout.write(`  Epic:  [${result.epic.key}] ${result.epic.title} (${result.epic.action})\n`);
  process.stdout.write(`         ${result.epic.url}\n`);
  result.tasks.forEach((t) => process.stdout.write(`  Story: [${t.key}] ${t.title} (${t.action})\n`));
  process.stdout.write(`  Total: ${result.taskCount} stor${result.taskCount === 1 ? 'y' : 'ies'}\n`);
}

program.parseAsync(process.argv).catch(fail);
