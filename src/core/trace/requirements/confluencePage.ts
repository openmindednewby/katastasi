/**
 * Confluence spec page → requirements. The page's storage body is converted to markdown (reusing
 * the existing converter) and parsed with the markdown requirement parser, so a spec written as a
 * table or checklist on a Confluence page becomes the requirement universe.
 */
import { getPage, pageWebUrl, parsePageRef } from '../../atlassian.js';
import { getConfluenceCreds, type AtlassianCreds } from '../../config.js';
import { storageToMarkdown } from '../../storageToMarkdown.js';
import { DEFAULT_KEY_PATTERN } from '../testScanner.js';
import type { Requirement } from '../types.js';
import { parseMarkdownRequirements } from './markdown.js';

/** Convert a Confluence storage body to requirements. Pure — unit-tested without a network. */
export function confluenceStorageToRequirements(
  storage: string,
  keyPattern = DEFAULT_KEY_PATTERN,
  url?: string,
  scope?: string,
): Requirement[] {
  const md = storageToMarkdown(storage);
  return parseMarkdownRequirements(md, keyPattern, 'confluence-page', scope).map((r) => ({ ...r, url }));
}

export interface ConfluenceRequirementsOptions {
  keyPattern?: string;
  scope?: string;
}

/** Fetch a Confluence page's requirements via the direct REST client. */
export async function fetchConfluenceRequirements(
  pageRef: string,
  opts: ConfluenceRequirementsOptions = {},
  creds: AtlassianCreds = getConfluenceCreds(),
): Promise<Requirement[]> {
  const id = parsePageRef(pageRef);
  const page = await getPage(id, creds);
  const storage = page.body?.storage?.value ?? '';
  return confluenceStorageToRequirements(storage, opts.keyPattern, pageWebUrl(page, creds), opts.scope);
}
