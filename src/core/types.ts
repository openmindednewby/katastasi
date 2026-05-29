/**
 * Shared types for the ai-confluence-pipeline core.
 *
 * The "publish" model: the calling agent (or human) writes markdown; these payloads
 * are posted to the n8n `markdown-to-jira` / `markdown-to-confluence` webhooks, which
 * convert the markdown to ADF / storage format and create-or-update the issues/pages.
 */

/** Input for publishing a Jira Epic + linked Stories from markdown. */
export interface JiraPublishInput {
  /** Markdown for the Epic. First `# ` line is the summary. */
  epicMarkdown: string;
  /** Markdown for each Story, linked to the Epic. */
  taskMarkdowns?: string[];
  /** Existing Epic key (e.g. `PROJ-12`) or browse URL to UPDATE instead of create. */
  epicKey?: string;
  /** Existing Story keys/URLs, positional to `taskMarkdowns`; empty/missing entries are created. */
  taskKeys?: string[];
  /** Per-task assignee (accountId, email, or profile URL), positional to `taskMarkdowns`. */
  taskAssignees?: string[];
  /** Default component name applied to every issue lacking its own `## Component`. */
  component?: string;
  /** Default assignee (accountId, email, or profile URL). */
  assignee?: string;
  /** Reporter (accountId, email, or profile URL). */
  reporter?: string;
  /** Override the Epic issue type (defaults to JIRA_EPIC_ISSUE_TYPE / "Epic"). */
  issueType?: string;
  /** Parent key for the Epic itself (e.g. nesting under an initiative). */
  parentKey?: string;
}

/** Input for publishing a Confluence page (with optional appended sections) from markdown. */
export interface ConfluencePublishInput {
  /** Page title. If omitted, derived from the first `# ` line of `pageMarkdown`. */
  title?: string;
  /** Markdown body of the page. */
  pageMarkdown: string;
  /** Additional markdown sections appended after the main body, in order. */
  sectionMarkdowns?: string[];
  /** Alternative multi-page payload, when supported by the workflow. */
  pages?: Array<{ title?: string; markdown: string }>;
  /** Existing page id to UPDATE instead of create. */
  pageId?: string;
  /** Parent page id to nest the new page under. */
  parentPageId?: string;
  /** Labels to attach to the page. */
  labels?: string[];
}

/** A created/updated Jira issue in the response. */
export interface JiraResultIssue {
  key: string;
  title: string;
  url: string;
  action: 'created' | 'updated';
}

/** Normalised response from the markdown-to-jira webhook. */
export interface JiraPublishResult {
  success: boolean;
  epic: JiraResultIssue;
  tasks: JiraResultIssue[];
  taskCount: number;
}

/** Normalised response from the markdown-to-confluence webhook. */
export interface ConfluencePublishResult {
  success: boolean;
  page: { id?: string; title?: string; url?: string; action?: string };
  [key: string]: unknown;
}
