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

/* ── Reverse pipeline (pull): Jira / Confluence → markdown folder ───────────── */

/** Options for a reverse pull. */
export interface PullOptions {
  /** Recurse into child issues / child pages (default true). */
  recursive?: boolean;
  /** Overwrite existing files in the target dir (default false → error if non-empty). */
  force?: boolean;
}

/** One Jira issue written to disk during a pull. */
export interface PulledIssue {
  /** Path relative to the target dir, e.g. `epic.md` or `task-01-foo/subtask-01-bar.md`. */
  file: string;
  key: string;
  /** `epic` for the root, otherwise the Jira issue-type name (Story, Sub-task, …). */
  type: string;
  title: string;
  parentKey: string | null;
  url: string;
  status: string | null;
}

/** Result of a Jira pull: the root plus every descendant written, and the manifest path. */
export interface JiraPullResult {
  root: PulledIssue;
  issues: PulledIssue[];
  manifestPath: string;
  dir: string;
}

/** One Confluence page written to disk during a pull. */
export interface PulledPage {
  /** Directory relative to the target dir holding this page's `page.md` (`.` for the root). */
  dir: string;
  pageId: string;
  title: string;
  parentPageId: string | null;
  url: string;
}

/** Result of a Confluence pull: the root plus every descendant written, and the manifest path. */
export interface ConfluencePullResult {
  root: PulledPage;
  pages: PulledPage[];
  manifestPath: string;
  dir: string;
}

/* ── Reverse re-publish (push-folder): markdown folder → Jira / Confluence ───── */

/** Options for `pushFolder`. */
export interface PushOptions {
  /** Resolve markdown + parent links but don't call Atlassian; report intended actions. */
  dryRun?: boolean;
}

/** One issue re-published from a pulled folder. */
export interface PushedIssue {
  file: string;
  key: string;
  action: 'created' | 'updated' | 'would-create' | 'would-update';
  url: string;
}

/** One page re-published from a pulled folder. */
export interface PushedPage {
  dir: string;
  pageId: string;
  action: 'created' | 'updated' | 'would-create' | 'would-update';
  url: string;
}

/** Result of pushing a folder back. `kind` discriminates the populated array. */
export interface PushFolderResult {
  kind: 'jira' | 'confluence';
  dir: string;
  issues?: PushedIssue[];
  pages?: PushedPage[];
}
