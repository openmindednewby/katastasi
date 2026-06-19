#!/usr/bin/env node
/**
 * `ai-confluence-pipeline` (alias `acp`) CLI.
 *
 * Publishes markdown files to Jira / Confluence via the n8n publish webhooks.
 * The agent-facing equivalent is the MCP server (src/mcp/server.ts), which takes raw markdown.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { publishJira } from '../core/jira.js';
import { publishConfluence } from '../core/confluence.js';
import { pullJira, pullConfluence } from '../core/pull.js';
import { pushFolder } from '../core/push.js';
import { getConfig } from '../core/config.js';
import { loadTraceConfig, starterConfig, DEFAULT_CONFIG_FILENAME } from '../core/trace/config.js';
import { autodetect, REQUIREMENTS_STUB } from '../core/trace/autodetect.js';
import { runTrace } from '../core/trace/index.js';
import { serve } from '../core/trace/serve.js';
import { writeOutputs, updateRoadmapSection, publishConfluenceReport, stampJiraLabels } from '../core/trace/publish.js';
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
  .name('acp')
  .description('Publish markdown to Jira / Confluence via the ai-confluence-pipeline n8n workflows.')
  .version('0.1.0');

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
  .option('--run', 'execute each test group\'s command before tracing (re-run the suites)', false)
  .option('--no-save', 'do not persist this run to the history dir')
  .option('--no-compare', 'do not diff against the previous run / baseline')
  .option('--fail-on <level>', 'exit non-zero on: none | regression | drift | failing', 'none')
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
  .option('--template', 'write a plain template instead of autodetecting', false)
  .option('--force', 'overwrite an existing config', false)
  .action((opts) => {
    try {
      const out = resolve(opts.out);
      if (existsSync(out) && !opts.force) {
        throw new Error(`${opts.out} already exists. Use --force to overwrite.`);
      }
      const hinted = opts.jiraEpic || opts.markdown || opts.roadmap || opts.confluencePage || opts.template;
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
      // Autodetect (default).
      const repoDir = process.cwd();
      const plan = autodetect(repoDir, opts.project);
      plan.notes.forEach((n) => process.stdout.write(`  ${n}\n`));
      if (plan.createRequirementsStub) {
        const stubPath = resolve(repoDir, plan.createRequirementsStub);
        if (!existsSync(stubPath)) {
          mkdirSync(dirname(stubPath), { recursive: true });
          writeFileSync(stubPath, REQUIREMENTS_STUB, 'utf8');
        }
      }
      writeFileSync(out, `${JSON.stringify(plan.config, null, 2)}\n`, 'utf8');
      process.stdout.write(`\n  Wrote ${opts.out}\n  Next:  acp trace serve --config ${opts.out}   (or: acp trace --config ${opts.out} --run)\n`);
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
  process.stdout.write(`  ⚠️  ${s.drift} drift   👻 ${s.orphanTests} orphan tests   Coverage: ${s.coveragePct}%\n`);
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
  const { failing, drift, regressions } = report.stats;
  if (failOn === 'failing' && failing > 0) return 1;
  if (failOn === 'regression' && regressions > 0) return 1;
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
