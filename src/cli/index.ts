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
import { getConfig } from '../core/config.js';
import type { JiraPublishResult } from '../core/types.js';

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

function printJiraResult(result: JiraPublishResult): void {
  process.stdout.write(`\n  Done.\n`);
  process.stdout.write(`  Epic:  [${result.epic.key}] ${result.epic.title} (${result.epic.action})\n`);
  process.stdout.write(`         ${result.epic.url}\n`);
  result.tasks.forEach((t) => process.stdout.write(`  Story: [${t.key}] ${t.title} (${t.action})\n`));
  process.stdout.write(`  Total: ${result.taskCount} stor${result.taskCount === 1 ? 'y' : 'ies'}\n`);
}

program.parseAsync(process.argv).catch(fail);
