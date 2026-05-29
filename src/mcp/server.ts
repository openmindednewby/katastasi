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
import { publishJira } from '../core/jira.js';
import { publishConfluence } from '../core/confluence.js';

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
