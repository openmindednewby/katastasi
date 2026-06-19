/**
 * Jira epic → requirements. The epic's child issues (stories, optionally their sub-tasks) ARE the
 * requirements; their Jira status decides "declared complete" (→ drift detection when not verified).
 */
import {
  getChildIssues,
  getIssue,
  parseIssueRef,
  type JiraIssue,
} from '../../atlassian.js';
import { getJiraCreds, type AtlassianCreds } from '../../config.js';
import type { Requirement } from '../types.js';

/** Status names (case-insensitive) that count as "done" → declaredComplete. */
export const DEFAULT_DONE_STATUSES = [
  'done',
  'closed',
  'resolved',
  'complete',
  'completed',
  'deployed',
  'live',
  'shipped',
];

export interface JiraRequirementsOptions {
  /** Include the epic issue itself as a requirement (default false — children are the requirements). */
  includeEpic?: boolean;
  /** Also pull each child's sub-tasks as requirements (default false). */
  recursive?: boolean;
  /** Override the set of status names that mean "done". */
  doneStatuses?: string[];
  /** Scope/group label stamped on every requirement. */
  scope?: string;
}

/** Map one Jira issue to a Requirement. Pure — unit-tested without a network. */
export function jiraIssueToRequirement(
  issue: JiraIssue,
  baseUrl: string,
  doneStatuses = DEFAULT_DONE_STATUSES,
  scope?: string,
): Requirement {
  const statusName = issue.fields.status?.name ?? null;
  const done = new Set(doneStatuses.map((s) => s.toLowerCase()));
  return {
    key: issue.key.toUpperCase(),
    title: issue.fields.summary ?? issue.key,
    declaredStatus: statusName,
    declaredComplete: statusName ? done.has(statusName.toLowerCase()) : false,
    source: 'jira-epic',
    url: `${baseUrl}/browse/${issue.key}`,
    scope,
  };
}

/** Fetch an epic's requirements (children, optionally sub-tasks) via the direct REST client. */
export async function fetchJiraRequirements(
  epicRef: string,
  opts: JiraRequirementsOptions = {},
  creds: AtlassianCreds = getJiraCreds(),
): Promise<Requirement[]> {
  const epicKey = parseIssueRef(epicRef);
  const map = (issue: JiraIssue) => jiraIssueToRequirement(issue, creds.baseUrl, opts.doneStatuses, opts.scope);
  const out: Requirement[] = [];

  if (opts.includeEpic) out.push(map(await getIssue(epicKey, creds)));

  const children = await getChildIssues(epicKey, creds);
  out.push(...children.map(map));

  if (opts.recursive) {
    for (const child of children) {
      const subtasks = await getChildIssues(child.key, creds);
      out.push(...subtasks.map(map));
    }
  }
  return dedupeByKey(out);
}

function dedupeByKey(reqs: Requirement[]): Requirement[] {
  const seen = new Set<string>();
  return reqs.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}
