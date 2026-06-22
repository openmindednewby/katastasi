/**
 * A deliberately small YAML-lite reader — just enough for acceptance specs (no anchors, tags, multi-doc,
 * block scalars). It supports indentation-based maps/lists, inline flow `{a: b}` / `[x, y]`, quoted and
 * bare scalars with type coercion, and `#` comments. Hand-rolled on purpose (the repo avoids a YAML dep).
 * Anything fancier should be written as JSON instead.
 */
import { AcceptanceParseError } from '../model.js';

interface Line {
  indent: number;
  text: string;
}

/** Strip a `#` comment that starts outside any quotes. */
function stripComment(raw: string): string {
  let q: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) return raw.slice(0, i);
  }
  return raw;
}

function lex(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const noComment = stripComment(raw);
    const trimmed = noComment.trim();
    if (!trimmed) continue;
    out.push({ indent: noComment.length - noComment.trimStart().length, text: trimmed });
  }
  return out;
}

// ── flow scalars: { … } / [ … ] / "quoted" / bare ──────────────────────────────────────────

interface Cursor {
  s: string;
  i: number;
}

function skipWs(p: Cursor): void {
  while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++;
}

function coerce(token: string): unknown {
  const t = token.trim();
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  return t;
}

function parseQuoted(p: Cursor): string {
  const q = p.s[p.i++];
  let out = '';
  while (p.i < p.s.length && p.s[p.i] !== q) {
    if (p.s[p.i] === '\\' && q === '"' && p.i + 1 < p.s.length) {
      const next = p.s[++p.i];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
    } else out += p.s[p.i];
    p.i++;
  }
  if (p.s[p.i] !== q) throw new AcceptanceParseError(`unterminated string in flow: ${p.s}`);
  p.i++;
  return out;
}

function parseFlowValue(p: Cursor): unknown {
  skipWs(p);
  const c = p.s[p.i];
  if (c === '{') return parseFlowMap(p);
  if (c === '[') return parseFlowList(p);
  if (c === '"' || c === "'") return parseQuoted(p);
  let token = '';
  while (p.i < p.s.length && !',}]'.includes(p.s[p.i])) token += p.s[p.i++];
  return coerce(token);
}

function parseFlowKey(p: Cursor): string {
  skipWs(p);
  if (p.s[p.i] === '"' || p.s[p.i] === "'") return parseQuoted(p);
  let token = '';
  while (p.i < p.s.length && p.s[p.i] !== ':' && !',}'.includes(p.s[p.i])) token += p.s[p.i++];
  return token.trim();
}

function parseFlowMap(p: Cursor): Record<string, unknown> {
  p.i++; // {
  const out: Record<string, unknown> = {};
  skipWs(p);
  if (p.s[p.i] === '}') {
    p.i++;
    return out;
  }
  for (;;) {
    const key = parseFlowKey(p);
    skipWs(p);
    if (p.s[p.i] !== ':') throw new AcceptanceParseError(`expected ':' in flow map: ${p.s}`);
    p.i++;
    out[key] = parseFlowValue(p);
    skipWs(p);
    if (p.s[p.i] === ',') {
      p.i++;
      continue;
    }
    if (p.s[p.i] === '}') {
      p.i++;
      break;
    }
    throw new AcceptanceParseError(`expected ',' or '}' in flow map: ${p.s}`);
  }
  return out;
}

function parseFlowList(p: Cursor): unknown[] {
  p.i++; // [
  const out: unknown[] = [];
  skipWs(p);
  if (p.s[p.i] === ']') {
    p.i++;
    return out;
  }
  for (;;) {
    out.push(parseFlowValue(p));
    skipWs(p);
    if (p.s[p.i] === ',') {
      p.i++;
      continue;
    }
    if (p.s[p.i] === ']') {
      p.i++;
      break;
    }
    throw new AcceptanceParseError(`expected ',' or ']' in flow list: ${p.s}`);
  }
  return out;
}

/** Parse a single-line value: a flow collection, a quoted string, or a bare scalar. */
function parseInlineValue(s: string): unknown {
  const t = s.trim();
  if (t.startsWith('{') || t.startsWith('[')) return parseFlowValue({ s: t, i: 0 });
  if (t.startsWith('"') || t.startsWith("'")) return parseQuoted({ s: t, i: 0 });
  return coerce(t);
}

// ── block structure ─────────────────────────────────────────────────────────────────────────

function splitKey(text: string): { key: string; rest: string } {
  const idx = text.indexOf(':');
  if (idx === -1) throw new AcceptanceParseError(`expected 'key: value', got: ${text}`);
  return { key: text.slice(0, idx).trim(), rest: text.slice(idx + 1).trim() };
}

class BlockReader {
  private i = 0;
  constructor(private lines: Line[]) {}

  parse(): unknown {
    if (this.lines.length === 0) return null;
    return this.node(this.lines[0].indent);
  }

  private node(indent: number): unknown {
    return this.lines[this.i].text.startsWith('- ') ? this.list(indent) : this.map(indent);
  }

  private list(indent: number): unknown[] {
    const out: unknown[] = [];
    while (this.i < this.lines.length && this.lines[this.i].indent === indent && this.lines[this.i].text.startsWith('- ')) {
      const rest = this.lines[this.i].text.slice(2).trim();
      if (rest === '') {
        this.i++;
        out.push(this.i < this.lines.length && this.lines[this.i].indent > indent ? this.node(this.lines[this.i].indent) : null);
      } else if (/^[^:{[]+:/.test(rest)) {
        // map item: pull the first key onto a virtual line at the post-dash column, then read the map
        this.lines[this.i] = { indent: indent + 2, text: rest };
        out.push(this.map(indent + 2));
      } else {
        out.push(parseInlineValue(rest));
        this.i++;
      }
    }
    return out;
  }

  private map(indent: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    while (this.i < this.lines.length && this.lines[this.i].indent === indent && !this.lines[this.i].text.startsWith('- ')) {
      const { key, rest } = splitKey(this.lines[this.i].text);
      if (rest === '') {
        this.i++;
        out[key] = this.i < this.lines.length && this.lines[this.i].indent > indent ? this.node(this.lines[this.i].indent) : null;
      } else {
        out[key] = parseInlineValue(rest);
        this.i++;
      }
    }
    return out;
  }
}

export function parseYamlLite(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseInlineValue(trimmed);
  return new BlockReader(lex(text)).parse();
}
