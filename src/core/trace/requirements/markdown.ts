/**
 * Parse a markdown spec into requirements. Tolerant of two common shapes:
 *   - tables:  `| PROJ-1 | Login flow | Done |`
 *   - lists:   `- [x] PROJ-1 Login flow`  /  `- PROJ-1: Login flow (In Progress)`
 * One requirement per line; the first key on a line is its key. First occurrence of a key wins.
 */
import { DEFAULT_KEY_PATTERN } from '../testScanner.js';
import type { Requirement, RequirementSourceKind } from '../types.js';
import { cleanTitle, declaredStatusOf, isComplete, keyRegexes } from './common.js';

const SEPARATOR_ROW = /^\s*\|?[\s:|-]+\|?\s*$/;

function fromTableRow(cells: string[], key: string, keyOne: RegExp, line: string): { title: string; status: string | null } {
  const nonKey = cells.filter((c) => !keyOne.test(c));
  const title = nonKey.sort((a, b) => b.length - a.length)[0] ?? '';
  const statusCell = cells.find((c) => declaredStatusOf(c));
  return { title: cleanTitle(title), status: statusCell ? declaredStatusOf(statusCell) : declaredStatusOf(line) };
}

/** Parse markdown text into requirements. */
export function parseMarkdownRequirements(
  md: string,
  keyPattern = DEFAULT_KEY_PATTERN,
  source: RequirementSourceKind = 'markdown',
  scope?: string,
): Requirement[] {
  const { one, all } = keyRegexes(keyPattern);
  const out: Requirement[] = [];
  const seen = new Set<string>();

  for (const line of md.split(/\r?\n/)) {
    if (SEPARATOR_ROW.test(line) && line.includes('|') && !one.test(line)) continue;
    const keyMatch = line.match(all);
    if (!keyMatch) continue;
    const key = keyMatch[0].toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let title: string;
    let status: string | null;
    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      ({ title, status } = fromTableRow(cells, key, one, line));
    } else {
      title = cleanTitle(line, keyPattern);
      status = declaredStatusOf(line);
    }
    out.push({ key, title: title || key, declaredStatus: status, declaredComplete: isComplete(line), source, scope });
  }
  return out;
}
