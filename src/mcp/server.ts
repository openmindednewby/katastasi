#!/usr/bin/env node
/**
 * ai-confluence-pipeline MCP server (stdio).
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
import { dirname, resolve } from 'node:path';
import { publishJira } from '../core/jira.js';
import { publishConfluence } from '../core/confluence.js';
import { pullJira, pullConfluence } from '../core/pull.js';
import { pushFolder } from '../core/push.js';
import { loadTraceConfig } from '../core/trace/config.js';
import { runTrace, renderAll } from '../core/trace/index.js';

const server = new McpServer({ name: 'ai-confluence-pipeline', version: '0.1.0' });

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
      'drift (declared done but not verified) and orphan tests. Returns the markdown report + stats.',
    inputSchema: {
      configPath: z.string().optional().describe('Path to acp-trace.json (default: ./acp-trace.json).'),
      format: z.enum(['markdown', 'json']).optional().describe('Return the markdown report (default) or raw JSON.'),
    },
  },
  async (args) => {
    try {
      const configPath = resolve(args.configPath ?? 'acp-trace.json');
      const config = loadTraceConfig(configPath);
      const report = await runTrace(config, dirname(configPath));
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

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('ai-confluence-pipeline MCP server running on stdio\n');
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
