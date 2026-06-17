#!/usr/bin/env node
/**
 * `ai-confluence-pipeline` (alias `acp`) CLI.
 *
 * Publishes markdown files to Jira / Confluence via the n8n publish webhooks.
 * The agent-facing equivalent is the MCP server (src/mcp/server.ts), which takes raw markdown.
 */
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { publishJira } from '../core/jira.js';
import { publishConfluence } from '../core/confluence.js';
import { pullJira, pullConfluence } from '../core/pull.js';
import { pushFolder } from '../core/push.js';
import { getConfig } from '../core/config.js';
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
