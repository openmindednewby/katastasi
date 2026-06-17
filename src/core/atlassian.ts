/**
 * Thin direct-REST client for Atlassian Cloud (Jira + Confluence), Basic-auth from `.env`.
 *
 * Used by the reverse `pull` flow (Jira/Confluence → markdown). Read-only: GET issues, search
 * child issues, GET pages, list child pages. No AI, no n8n.
 */
import { basicAuthHeader, getConfluenceCreds, getJiraCreds, type AtlassianCreds } from './config.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const SEARCH_PAGE_SIZE = 100;

export class AtlassianError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'AtlassianError';
  }
}

/** A Jira issue as returned by the REST API (only the fields we read). */
export interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    description?: unknown; // ADF doc
    labels?: string[];
    priority?: { name?: string } | null;
    issuetype?: { name?: string } | null;
    status?: { name?: string } | null;
    components?: Array<{ name?: string }>;
    parent?: { key?: string } | null;
    subtasks?: Array<{ key?: string }>;
    assignee?: { displayName?: string; emailAddress?: string; accountId?: string } | null;
    [key: string]: unknown;
  };
}

/** A Confluence page as returned by the REST API (only the fields we read). */
export interface ConfluencePage {
  id: string;
  title?: string;
  body?: { storage?: { value?: string } };
  space?: { key?: string };
  version?: { number?: number };
  _links?: { webui?: string; base?: string };
}

const JIRA_FIELDS = 'summary,description,labels,priority,issuetype,status,components,parent,subtasks,assignee';

/** Strip surrounding angle/quote noise and pull the issue key out of a key or browse URL. */
export function parseIssueRef(ref: string): string {
  const trimmed = ref.trim();
  const fromUrl = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/i.exec(trimmed);
  if (fromUrl) return fromUrl[1].toUpperCase();
  const bare = /^[A-Z][A-Z0-9_]+-\d+$/i.exec(trimmed);
  if (bare) return trimmed.toUpperCase();
  throw new Error(`Could not parse a Jira issue key from "${ref}". Expected e.g. PROJ-12 or a /browse/PROJ-12 URL.`);
}

/** Pull the numeric page id out of a page id or a Confluence page URL. */
export function parsePageRef(ref: string): string {
  const trimmed = ref.trim();
  const fromPages = /\/pages\/(\d+)/.exec(trimmed);
  if (fromPages) return fromPages[1];
  const fromQuery = /[?&]pageId=(\d+)/.exec(trimmed);
  if (fromQuery) return fromQuery[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  throw new Error(`Could not parse a Confluence page id from "${ref}". Expected a numeric id or a /pages/<id> URL.`);
}

/** GET a single Jira issue with the fields we convert. */
export async function getIssue(key: string, creds = getJiraCreds()): Promise<JiraIssue> {
  return getJson<JiraIssue>(creds, `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${JIRA_FIELDS}`);
}

/** Return the direct child issues of `parentKey` (stories under an epic, or sub-tasks under a story). */
export async function getChildIssues(parentKey: string, creds = getJiraCreds()): Promise<JiraIssue[]> {
  const jql = `parent = ${parentKey} ORDER BY created ASC`;
  const issues: JiraIssue[] = [];
  let startAt = 0;
  for (;;) {
    const path =
      `/rest/api/3/search?jql=${encodeURIComponent(jql)}` +
      `&fields=${JIRA_FIELDS}&startAt=${startAt}&maxResults=${SEARCH_PAGE_SIZE}`;
    const page = await getJson<{ issues?: JiraIssue[]; total?: number }>(creds, path);
    const batch = page.issues ?? [];
    issues.push(...batch);
    startAt += batch.length;
    if (batch.length < SEARCH_PAGE_SIZE || startAt >= (page.total ?? startAt)) break;
  }
  return issues;
}

/** GET a single Confluence page with its storage body and version. */
export async function getPage(id: string, creds = getConfluenceCreds()): Promise<ConfluencePage> {
  return getJson<ConfluencePage>(
    creds,
    `/wiki/rest/api/content/${encodeURIComponent(id)}?expand=body.storage,version,space`,
  );
}

/** A created/updated issue identifier from a write call. */
export interface IssueRef {
  key: string;
}

/** Create a Jira issue. `fields` is the full `fields` object (project/summary/description/…). */
export async function createIssue(fields: Record<string, unknown>, creds = getJiraCreds()): Promise<IssueRef> {
  return sendJson<IssueRef>(creds, 'POST', '/rest/api/3/issue', { fields });
}

/** Update a Jira issue's fields in place. Returns no body (204). */
export async function updateIssue(key: string, fields: Record<string, unknown>, creds = getJiraCreds()): Promise<void> {
  await sendJson<unknown>(creds, 'PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields }, true);
}

/** Create a Confluence page. `body` is the full content payload. */
export async function createPage(body: Record<string, unknown>, creds = getConfluenceCreds()): Promise<ConfluencePage> {
  return sendJson<ConfluencePage>(creds, 'POST', '/wiki/rest/api/content', body);
}

/** Update a Confluence page in place. `body` must carry the bumped `version.number`. */
export async function updatePage(id: string, body: Record<string, unknown>, creds = getConfluenceCreds()): Promise<ConfluencePage> {
  return sendJson<ConfluencePage>(creds, 'PUT', `/wiki/rest/api/content/${encodeURIComponent(id)}`, body);
}

/** Return the direct child pages of a Confluence page, each with its storage body. */
export async function getChildPages(id: string, creds = getConfluenceCreds()): Promise<ConfluencePage[]> {
  const pages: ConfluencePage[] = [];
  let start = 0;
  for (;;) {
    const path =
      `/wiki/rest/api/content/${encodeURIComponent(id)}/child/page` +
      `?expand=body.storage,space&limit=${SEARCH_PAGE_SIZE}&start=${start}`;
    const page = await getJson<{ results?: ConfluencePage[]; size?: number }>(creds, path);
    const batch = page.results ?? [];
    pages.push(...batch);
    start += batch.length;
    if (batch.length < SEARCH_PAGE_SIZE) break;
  }
  return pages;
}

/** Build the full webui URL for a Confluence page from its `_links`, falling back to the id. */
export function pageWebUrl(page: ConfluencePage, creds: AtlassianCreds): string {
  const webui = page._links?.webui;
  if (webui) return `${creds.baseUrl}/wiki${webui}`;
  return `${creds.baseUrl}/wiki/pages/viewpage.action?pageId=${page.id}`;
}

/** Convenience GET wrapper. */
function getJson<T>(creds: AtlassianCreds, path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return sendJson<T>(creds, 'GET', path, undefined, false, timeoutMs);
}

/**
 * Shared request helper: Basic auth, JSON, timeout, structured errors.
 * `allowEmpty` tolerates an empty/204 body (PUTs that return no content).
 */
async function sendJson<T>(
  creds: AtlassianCreds,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  allowEmpty = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const url = `${creds.baseUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { Authorization: basicAuthHeader(creds), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new AtlassianError(`Failed to reach Atlassian at ${url}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new AtlassianError(`Atlassian ${method} ${path} returned ${res.status}`, res.status, text);
  }
  if (allowEmpty && text.trim() === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (allowEmpty) return undefined as T;
    throw new AtlassianError(`Atlassian ${method} ${path} returned non-JSON`, res.status, text);
  }
}
