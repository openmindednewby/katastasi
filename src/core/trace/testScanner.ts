/**
 * Static scan of test SOURCES → which requirement keys each test claims to cover.
 *
 * Hybrid linking:
 *   - inline tags in titles/comments:  `@PROJ-123`, `@req PROJ-123`, `@covers PROJ-123`
 *   - xUnit traits:                     `[Trait("req", "PROJ-123")]`
 *   - an external mapping file:         key → file(s)  (JSON, or a minimal `key:\n  - file` YAML)
 *
 * Works on unrun tests (it reads files, not results) so it answers "is there a test for this?"
 */
import { readFileSync } from 'node:fs';
import { globFiles } from './glob.js';
import type { TestRef, TestTech } from './types.js';

/** Default key shape: a Jira-style issue key (PROJ-123). Override per project. */
export const DEFAULT_KEY_PATTERN = '[A-Z][A-Z0-9]+-\\d+';

/** One configured test-source group: a tech family + the globs that select its files. */
export interface TestSourceSpec {
  tech: TestTech;
  globs: string[];
}

/** Build the three extraction regexes for a given key pattern. */
function buildMatchers(keyPattern: string): { tag: RegExp; named: RegExp; trait: RegExp } {
  return {
    tag: new RegExp(`@(${keyPattern})\\b`, 'g'),
    named: new RegExp(`@(?:req|requirement|covers|trace)\\s*:?\\s*(${keyPattern})\\b`, 'gi'),
    trait: new RegExp(`Trait\\s*\\(\\s*"(?:req|requirement|requirements|requirementid)"\\s*,\\s*"(${keyPattern})"`, 'gi'),
  };
}

/** The longest quoted string on a line (the likely test title), or the trimmed line. */
function lineTitle(line: string): string {
  const quotes = [...line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
  const longest = quotes.sort((a, b) => b.length - a.length)[0];
  return (longest ?? line.trim()).slice(0, 200);
}

/** Extract every (key, line, via) reference from one file's text. */
export function extractRefs(
  text: string,
  file: string,
  tech: TestTech,
  keyPattern = DEFAULT_KEY_PATTERN,
): TestRef[] {
  const { tag, named, trait } = buildMatchers(keyPattern);
  const lines = text.split(/\r?\n/);
  const refs: TestRef[] = [];
  const seen = new Set<string>(); // key|line — dedup overlapping matchers

  lines.forEach((line, idx) => {
    const add = (key: string, via: TestRef['via']) => {
      const norm = key.toUpperCase();
      const dedup = `${norm}|${idx}`;
      if (seen.has(dedup)) return;
      seen.add(dedup);
      refs.push({ key: norm, file, title: lineTitle(line), tech, line: idx + 1, via });
    };
    for (const m of line.matchAll(trait)) add(m[1], 'trait');
    for (const m of line.matchAll(named)) add(m[1], 'tag');
    for (const m of line.matchAll(tag)) add(m[1], 'tag');
  });
  return refs;
}

/** Scan all configured test-source groups under `root` and return every requirement reference. */
export function scanTestSources(
  root: string,
  sources: TestSourceSpec[],
  keyPattern = DEFAULT_KEY_PATTERN,
): TestRef[] {
  const refs: TestRef[] = [];
  for (const src of sources) {
    for (const file of globFiles(root, src.globs)) {
      let text: string;
      try {
        text = readFileSync(`${root}/${file}`, 'utf8');
      } catch {
        continue;
      }
      refs.push(...extractRefs(text, file, src.tech, keyPattern));
    }
  }
  return refs;
}

/** Guess a tech family from a file path (used for mapping-file entries). */
export function techForFile(file: string): TestTech {
  if (/\.cs$/i.test(file)) return 'xunit';
  if (/\.(spec|e2e)\.[jt]sx?$/i.test(file)) return 'playwright';
  if (/\.test\.[jt]sx?$/i.test(file)) return 'jest';
  return 'generic';
}

/** Parse an external mapping (JSON object, or a minimal `KEY:\n  - file` / `KEY: file` YAML). */
export function parseMapping(text: string, file: string): Record<string, string[]> {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || file.endsWith('.json')) {
    const obj = JSON.parse(trimmed) as Record<string, string | string[]>;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toUpperCase(), Array.isArray(v) ? v : [v]]));
  }
  return parseMiniYaml(text);
}

/** Minimal YAML for the mapping shape only: `KEY:` then `  - item` lines, or `KEY: item`. */
function parseMiniYaml(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && current) {
      out[current].push(stripQuotes(item[1]));
      continue;
    }
    const kv = /^(\S[^:]*):\s*(.*)$/.exec(line);
    if (kv) {
      current = kv[1].trim().toUpperCase();
      out[current] = out[current] ?? [];
      if (kv[2].trim()) out[current].push(stripQuotes(kv[2].trim()));
    }
  }
  return out;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '').trim();
}

/** Turn a parsed mapping into test references. */
export function mappingToRefs(mapping: Record<string, string[]>): TestRef[] {
  const refs: TestRef[] = [];
  for (const [key, files] of Object.entries(mapping)) {
    for (const file of files) {
      refs.push({ key: key.toUpperCase(), file, title: file, tech: techForFile(file), via: 'mapping' });
    }
  }
  return refs;
}

/** Read + parse a mapping file from disk; missing file → empty mapping. */
export function readMappingFile(path: string): TestRef[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return mappingToRefs(parseMapping(text, path));
}
