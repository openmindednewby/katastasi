/**
 * Ingest test RESULT files and map outcomes back to requirement keys.
 *
 * Supports JUnit XML (Playwright / Jest / Vitest reporters) and dotnet TRX. Keys are read from the
 * testcase name + classname (so a `@PROJ-123` tag in the test title flows straight through), then
 * aggregated per key into pass/fail/skip counts. This is what turns "a test exists" into "it passes".
 */
import { readFileSync, statSync } from 'node:fs';
import { DEFAULT_KEY_PATTERN } from './testScanner.js';
import type { KeyResult } from './types.js';

export type Outcome = 'passed' | 'failed' | 'skipped';

/** One result occurrence tied to a key — kept for orphan reporting. */
export interface ResultOccurrence {
  key: string;
  file: string;
  status: Outcome;
}

/** Everything ingested from a set of result files. */
export interface IngestedResults {
  byKey: Map<string, KeyResult>;
  occurrences: ResultOccurrence[];
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m]);
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? decode(m[1]) : '';
}

/** Pull every key from a test name/classname (bare pattern — a `@KEY` tag matches too). */
function keysIn(text: string, keyPattern: string): string[] {
  const matches = text.match(new RegExp(keyPattern, 'g')) ?? [];
  return [...new Set(matches.map((k) => k.toUpperCase()))];
}

function blankResult(): KeyResult {
  return { passed: 0, failed: 0, skipped: 0, lastRun: null };
}

/** Fold one occurrence into the aggregate map. */
function record(byKey: Map<string, KeyResult>, key: string, status: Outcome, when: string | null): void {
  const r = byKey.get(key) ?? blankResult();
  r[status] += 1;
  if (when && (!r.lastRun || when > r.lastRun)) r.lastRun = when;
  byKey.set(key, r);
}

/** Parse a JUnit XML string into (testName, status) pairs. */
export function parseJUnit(xml: string): Array<{ name: string; status: Outcome }> {
  const out: Array<{ name: string; status: Outcome }> = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const tag = m[1];
    const inner = m[3] ?? '';
    const name = `${attr(tag, 'name')} ${attr(tag, 'classname')}`.trim();
    let status: Outcome = 'passed';
    if (/<(failure|error)\b/i.test(inner)) status = 'failed';
    else if (/<skipped\b/i.test(inner)) status = 'skipped';
    out.push({ name, status });
  }
  return out;
}

const TRX_OUTCOME: Record<string, Outcome> = {
  passed: 'passed',
  failed: 'failed',
  error: 'failed',
  timeout: 'failed',
  notexecuted: 'skipped',
  skipped: 'skipped',
  inconclusive: 'skipped',
  pending: 'skipped',
};

/** Parse a dotnet TRX string into (testName, status) pairs. */
export function parseTrx(xml: string): Array<{ name: string; status: Outcome }> {
  const out: Array<{ name: string; status: Outcome }> = [];
  const re = /<UnitTestResult\b([^>]*?)\/?>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const tag = m[1];
    const name = attr(tag, 'testName');
    const status = TRX_OUTCOME[attr(tag, 'outcome').toLowerCase()] ?? 'skipped';
    if (name) out.push({ name, status });
  }
  return out;
}

/** Pick the parser by extension/content. */
function parse(text: string, file: string): Array<{ name: string; status: Outcome }> {
  if (/\.trx$/i.test(file) || /<TestRun\b/.test(text)) return parseTrx(text);
  return parseJUnit(text);
}

/** Ingest result files and aggregate outcomes per requirement key. */
export function ingestResults(files: string[], keyPattern = DEFAULT_KEY_PATTERN): IngestedResults {
  const byKey = new Map<string, KeyResult>();
  const occurrences: ResultOccurrence[] = [];

  for (const file of files) {
    let text: string;
    let when: string | null = null;
    try {
      text = readFileSync(file, 'utf8');
      when = statSync(file).mtime.toISOString();
    } catch {
      continue;
    }
    for (const tc of parse(text, file)) {
      for (const key of keysIn(tc.name, keyPattern)) {
        record(byKey, key, tc.status, when);
        occurrences.push({ key, file, status: tc.status });
      }
    }
  }
  return { byKey, occurrences };
}
