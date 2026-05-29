/**
 * Publish a Confluence page from agent-written markdown.
 * Stage 1: delegates to the n8n `markdown-to-confluence` webhook (create-or-update).
 */
import { postWebhook } from './n8n.js';
import { getConfig } from './config.js';
import type { ConfluencePublishInput, ConfluencePublishResult } from './types.js';

const WEBHOOK_PATH = 'markdown-to-confluence';

/** Build the exact body the n8n webhook expects, dropping empty optionals. */
function toWebhookBody(input: ConfluencePublishInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    pageMarkdown: input.pageMarkdown,
  };
  if (input.title) body.title = input.title;
  if (input.sectionMarkdowns?.length) body.sectionMarkdowns = input.sectionMarkdowns;
  if (input.pages?.length) body.pages = input.pages;
  if (input.pageId) body.pageId = input.pageId;
  if (input.parentPageId) body.parentPageId = input.parentPageId;
  if (input.labels?.length) body.labels = input.labels;
  return body;
}

/** Validate input, returning a human-readable error message or null if OK. */
export function validateConfluenceInput(input: ConfluencePublishInput): string | null {
  if (!input.pageMarkdown?.trim()) return 'pageMarkdown is required and must contain content.';
  if (!input.title && !/^#\s+.+/m.test(input.pageMarkdown)) {
    return 'Provide a title, or include a `# Title` line in pageMarkdown.';
  }
  return null;
}

/** Publish (or update) a Confluence page. Throws on validation or transport errors. */
export async function publishConfluence(input: ConfluencePublishInput): Promise<ConfluencePublishResult> {
  const error = validateConfluenceInput(input);
  if (error) throw new Error(error);

  const { backend } = getConfig();
  if (backend === 'direct') {
    throw new Error('ACP_BACKEND=direct is not implemented yet (Stage 2). Use the n8n backend.');
  }

  return postWebhook<ConfluencePublishResult>(WEBHOOK_PATH, toWebhookBody(input));
}
