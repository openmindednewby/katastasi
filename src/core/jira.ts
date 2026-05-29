/**
 * Publish a Jira Epic + linked Stories from agent-written markdown.
 * Stage 1: delegates to the n8n `markdown-to-jira` webhook (create-or-update, ADF conversion).
 */
import { postWebhook } from './n8n.js';
import { getConfig } from './config.js';
import type { JiraPublishInput, JiraPublishResult } from './types.js';

const WEBHOOK_PATH = 'markdown-to-jira';

/** Build the exact body the n8n webhook expects, dropping empty optionals. */
function toWebhookBody(input: JiraPublishInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    epicMarkdown: input.epicMarkdown,
    taskMarkdowns: input.taskMarkdowns ?? [],
  };
  if (input.epicKey) body.epicKey = input.epicKey;
  if (input.taskKeys?.length) body.taskKeys = input.taskKeys;
  if (input.taskAssignees?.length) body.taskAssignees = input.taskAssignees;
  if (input.component) body.component = input.component;
  if (input.assignee) body.assignee = input.assignee;
  if (input.reporter) body.reporter = input.reporter;
  if (input.issueType) body.issueType = input.issueType;
  if (input.parentKey) body.parentKey = input.parentKey;
  return body;
}

/** Validate input, returning a human-readable error message or null if OK. */
export function validateJiraInput(input: JiraPublishInput): string | null {
  if (!input.epicMarkdown?.trim()) return 'epicMarkdown is required and must contain content.';
  if (!/^#\s+.+/m.test(input.epicMarkdown)) return 'epicMarkdown must contain a `# Title` line (used as the Epic summary).';
  return null;
}

/** Publish (or update) a Jira Epic + Stories. Throws on validation or transport errors. */
export async function publishJira(input: JiraPublishInput): Promise<JiraPublishResult> {
  const error = validateJiraInput(input);
  if (error) throw new Error(error);

  const { backend } = getConfig();
  if (backend === 'direct') {
    throw new Error('ACP_BACKEND=direct is not implemented yet (Stage 2). Use the n8n backend.');
  }

  return postWebhook<JiraPublishResult>(WEBHOOK_PATH, toWebhookBody(input));
}
