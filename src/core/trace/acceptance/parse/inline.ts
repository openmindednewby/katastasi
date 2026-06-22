/**
 * Inline acceptance tests authored inside a requirement's markdown, in fenced ` ```acp-test ` blocks.
 * Two forms are accepted in the same block:
 *   • JSON  — the full `{ req?, cases }` / `{ steps }` / single-step object (same model as spec files).
 *   • terse — one case per line:  `METHOD /path [jsonBody] -> STATUS [contains "x"]`
 *                                 `run <command> -> <exit> [contains "x"]`
 * The requirement key comes from the block's own `req` (JSON) or the enclosing requirement (`reqKey`).
 */
import { AcceptanceParseError, normalizeSpec, type AcceptanceSpec } from '../model.js';
import { DEFAULT_KEY_PATTERN } from '../../testScanner.js';

const BLOCK_PATTERN = '```+[ \\t]*acp-test\\b[^\\n]*\\n([\\s\\S]*?)```+';

/** Parse the `-> ...` right-hand side into an expect blob (status|exit + optional contains). */
function parseExpect(right: string, codeKey: 'status' | 'exit'): Record<string, unknown> {
  const expect: Record<string, unknown> = {};
  const num = /^\s*(\d+)/.exec(right);
  if (num) expect[codeKey] = Number(num[1]);
  const contains = /contains\s+(?:"([^"]*)"|(\S+))/.exec(right);
  if (contains) expect.bodyContains = [contains[1] ?? contains[2]];
  return expect;
}

/** Parse one terse line into a `{ name, step }` raw authoring pair. */
function parseTerseLine(line: string): { name: string; step: Record<string, unknown> } {
  const arrow = line.lastIndexOf('->');
  if (arrow === -1) throw new AcceptanceParseError(`terse acp-test line needs '-> <status>': ${line}`);
  const left = line.slice(0, arrow).trim();
  const right = line.slice(arrow + 2).trim();

  if (/^run\b/.test(left)) {
    return { name: left, step: { run: left.replace(/^run\s+/, ''), expect: parseExpect(right, 'exit') } };
  }
  const sp = left.indexOf(' ');
  if (sp === -1) throw new AcceptanceParseError(`terse acp-test line needs 'METHOD /path': ${line}`);
  const method = left.slice(0, sp).trim();
  const afterMethod = left.slice(sp).trim();
  const bodyAt = afterMethod.search(/[{[]/);
  const url = (bodyAt === -1 ? afterMethod : afterMethod.slice(0, bodyAt)).trim();
  const step: Record<string, unknown> = { [method.toUpperCase()]: url, expect: parseExpect(right, 'status') };
  if (bodyAt !== -1) {
    const bodyStr = afterMethod.slice(bodyAt).trim();
    try {
      step.body = JSON.parse(bodyStr);
    } catch {
      throw new AcceptanceParseError(`terse acp-test body is not valid JSON: ${bodyStr}`);
    }
  }
  return { name: left, step };
}

function looksJson(content: string): boolean {
  const t = content.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

/** Normalise an inline JSON block, which may be a spec, an array of specs, a bare case, or a single step. */
function fromJson(content: string, source: string, reqKey?: string): AcceptanceSpec[] {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new AcceptanceParseError(`${source}: acp-test block is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const isStep = (v: unknown): boolean =>
    !!v && typeof v === 'object' && !Array.isArray(v) &&
    (Object.keys(v as object).some((k) => /^(get|post|put|patch|delete|head|options)$/i.test(k)) || 'run' in (v as object));
  if (Array.isArray(raw)) {
    if (raw.length && isStep(raw[0])) return [normalizeSpec({ steps: raw }, source, reqKey)];
    return raw.map((s, i) => normalizeSpec(s, `${source}[${i}]`, reqKey));
  }
  if (isStep(raw)) return [normalizeSpec({ steps: [raw] }, source, reqKey)];
  return [normalizeSpec(raw, source, reqKey)];
}

function fromTerse(content: string, source: string, reqKey?: string): AcceptanceSpec[] {
  if (!reqKey) throw new AcceptanceParseError(`${source}: terse acp-test block has no requirement key (needs an enclosing requirement)`);
  const cases = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const { name, step } = parseTerseLine(l);
      return { name, steps: [step] };
    });
  if (cases.length === 0) return [];
  return [normalizeSpec({ req: reqKey, cases }, source)];
}

/** Normalise one block's content (JSON or terse) against an optional enclosing requirement key. */
export function parseBlockContent(content: string, reqKey: string | undefined, source: string): AcceptanceSpec[] {
  return looksJson(content) ? fromJson(content, source, reqKey) : fromTerse(content, source, reqKey);
}

/** Extract every ` ```acp-test ` block from a requirement markdown string (single known key). */
export function parseInlineBlocks(markdown: string, reqKey?: string, source = 'inline'): AcceptanceSpec[] {
  const out: AcceptanceSpec[] = [];
  let blockIdx = 0;
  const re = new RegExp(BLOCK_PATTERN, 'g'); // fresh per call — a shared /g regex keeps stale lastIndex
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) {
    out.push(...parseBlockContent(m[1], reqKey, `${source}:${reqKey ?? '?'}#${++blockIdx}`));
  }
  return out;
}

/**
 * Extract acp-test blocks from a whole requirements document, attributing each block to the nearest
 * preceding requirement key (a line containing `keyPattern`, e.g. a `## PROJ-1 …` heading). A block's
 * own JSON `req` still overrides. This is how a requirement "verifies itself" — author the test under it.
 */
export function parseInlineFromDoc(markdown: string, keyPattern: string = DEFAULT_KEY_PATTERN, source = 'inline'): AcceptanceSpec[] {
  const keyRe = new RegExp(keyPattern);
  const fenceOpen = /^```+[ \t]*acp-test\b/;
  const fenceClose = /^```+[ \t]*$/;
  const out: AcceptanceSpec[] = [];
  let currentKey: string | undefined;
  let inBlock = false;
  let buf: string[] = [];
  let blockKey: string | undefined;
  let blockIdx = 0;

  for (const line of markdown.split(/\r?\n/)) {
    if (inBlock) {
      if (fenceClose.test(line)) {
        inBlock = false;
        out.push(...parseBlockContent(buf.join('\n'), blockKey, `${source}:${blockKey ?? '?'}#${++blockIdx}`));
      } else buf.push(line);
      continue;
    }
    if (fenceOpen.test(line)) {
      inBlock = true;
      buf = [];
      blockKey = currentKey;
      continue;
    }
    const km = keyRe.exec(line);
    if (km) currentKey = km[0].toUpperCase();
  }
  return out;
}
