/**
 * Parse requirements out of a roadmap HTML dashboard.
 *
 * Preferred: structured `data-req` attributes —
 *   `<div data-req="PROJ-1" data-title="Login" data-status="Done" data-complete="true">…</div>`
 * Fallback (no data-req anywhere): strip tags and parse the visible text like a markdown spec,
 * so an unannotated roadmap still yields a best-effort requirement list.
 */
import { DEFAULT_KEY_PATTERN } from '../testScanner.js';
import type { Requirement } from '../types.js';
import { isComplete } from './common.js';
import { parseMarkdownRequirements } from './markdown.js';

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
}

/** Text node immediately following an opening tag, used as a title fallback. */
function followingText(html: string, afterIndex: number): string {
  const slice = html.slice(afterIndex);
  const m = /^\s*([^<]+?)\s*</.exec(slice);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Parse a roadmap HTML string into requirements. */
export function parseRoadmapHtml(
  html: string,
  keyPattern = DEFAULT_KEY_PATTERN,
  scope?: string,
): Requirement[] {
  const tagRe = new RegExp(`<[^>]*\\bdata-req\\s*=\\s*"(${keyPattern})"[^>]*>`, 'gi');
  const out: Requirement[] = [];
  const seen = new Set<string>();

  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    const tag = m[0];
    const key = m[1].toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const status = attr(tag, 'data-status');
    const completeAttr = attr(tag, 'data-complete');
    const title = attr(tag, 'data-title') || followingText(html, m.index + tag.length) || key;
    const declaredComplete = completeAttr === 'true' || (status ? isComplete(status) : false);
    out.push({ key, title, declaredStatus: status, declaredComplete, source: 'roadmap-html', scope });
  }

  if (out.length) return out;

  // Fallback: no structured attributes — parse the visible text.
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return parseMarkdownRequirements(text, keyPattern, 'roadmap-html', scope);
}
