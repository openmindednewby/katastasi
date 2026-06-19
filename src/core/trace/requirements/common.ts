/**
 * Shared helpers for the requirement providers — key extraction and "is this declared done?"
 * heuristics reused by the markdown and roadmap-HTML parsers.
 */
import { DEFAULT_KEY_PATTERN } from '../testScanner.js';

const COMPLETE_RE = /\b(done|complete|completed|shipped|live|closed|resolved|deployed)\b|✅|✓|☑/i;
const IN_PROGRESS_RE = /\b(in[\s-]?progress|wip|started|building|ongoing)\b/i;
const CHECKED_RE = /\[\s*[xX]\s*\]/;
const UNCHECKED_RE = /\[\s*\]/;

/** A non-global and a global RegExp for the configured key pattern. */
export function keyRegexes(keyPattern = DEFAULT_KEY_PATTERN): { one: RegExp; all: RegExp } {
  return { one: new RegExp(keyPattern), all: new RegExp(keyPattern, 'g') };
}

/** True when the text declares completion (checkbox ticked or a done-ish word). */
export function isComplete(text: string): boolean {
  if (CHECKED_RE.test(text)) return true;
  if (UNCHECKED_RE.test(text)) return false;
  return COMPLETE_RE.test(text);
}

/** Best-effort declared status string for a line, or null. */
export function declaredStatusOf(text: string): string | null {
  if (CHECKED_RE.test(text) || COMPLETE_RE.test(text)) return 'Done';
  if (UNCHECKED_RE.test(text)) return 'To Do';
  if (IN_PROGRESS_RE.test(text)) return 'In Progress';
  return null;
}

/** Remove the key token and tidy a candidate title string. */
export function cleanTitle(text: string, keyPattern = DEFAULT_KEY_PATTERN): string {
  return text
    .replace(new RegExp(`@?${keyPattern}`, 'g'), '')
    .replace(/^\s*[-*+]\s*/, '')
    .replace(/\[\s*[xX ]\s*\]/g, '')
    .replace(/^#+\s*/, '')
    .replace(/[*_`]/g, '')
    .replace(/^[\s:–—-]+/, '')
    .replace(/\s*\((?:done|complete|completed|to[\s-]?do|in[\s-]?progress|wip|shipped|live|closed|resolved)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
