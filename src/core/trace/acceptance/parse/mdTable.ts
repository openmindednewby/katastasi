/**
 * Markdown-table spec front-end: each table row is one single-step case — readable in a PR diff, ideal
 * for simple "call → expect status" checks. Recognised columns (case-insensitive): name/case, req,
 * method, path/url, body (JSON), status, contains/bodyContains, run/cmd, exit. The requirement key comes
 * from a `req` column, a leading `req: KEY` line, or the `fallbackReq` argument. Complex chained/captured
 * cases should be authored as JSON or YAML instead.
 */
import { AcceptanceParseError, normalizeSpec, type AcceptanceSpec } from '../model.js';

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function isSeparator(line: string): boolean {
  return cells(line).every((c) => /^:?-{1,}:?$/.test(c));
}

const HEADER_ALIASES: Record<string, string> = {
  name: 'name', case: 'name',
  req: 'req', requirement: 'req', key: 'req',
  method: 'method', verb: 'method',
  path: 'url', url: 'url', endpoint: 'url',
  body: 'body',
  status: 'status', expectstatus: 'status',
  contains: 'contains', bodycontains: 'contains',
  run: 'run', cmd: 'run', command: 'run',
  exit: 'exit', exitcode: 'exit',
};

function parseBody(cell: string): unknown {
  const t = cell.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return t;
}

/** Build the raw authoring step for one row (an HTTP step unless a `run` column is present). */
function rowStep(row: Record<string, string>, where: string): Record<string, unknown> {
  const expect: Record<string, unknown> = {};
  if (row.status) expect.status = Number(row.status);
  if (row.exit) expect.exit = Number(row.exit);
  if (row.contains) expect.bodyContains = [row.contains];
  if (row.run) return { run: row.run, expect };
  if (!row.method || !row.url) {
    throw new AcceptanceParseError(`${where}: row needs method+path (or a run command)`);
  }
  const step: Record<string, unknown> = { [row.method.toUpperCase()]: row.url, expect };
  if (row.body) step.body = parseBody(row.body);
  return step;
}

export function parseTableSpec(text: string, source: string, fallbackReq?: string): AcceptanceSpec[] {
  const lines = text.split(/\r?\n/);
  const leadReq = lines.map((l) => /^req:\s*(\S+)/i.exec(l.trim())).find(Boolean);
  const defaultReq = leadReq ? leadReq[1] : fallbackReq;

  const tableLines = lines.filter((l) => l.trim().startsWith('|'));
  if (tableLines.length < 2) throw new AcceptanceParseError(`${source}: no markdown table found`);
  const headers = cells(tableLines[0]).map((h) => HEADER_ALIASES[h.toLowerCase().replace(/[\s_-]/g, '')] ?? h.toLowerCase());
  const dataRows = tableLines.slice(1).filter((l) => !isSeparator(l));

  const byReq = new Map<string, Array<{ name: string; steps: unknown[] }>>();
  dataRows.forEach((line, idx) => {
    const vals = cells(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (vals[i]) row[h] = vals[i];
    });
    const req = row.req || defaultReq;
    if (!req) throw new AcceptanceParseError(`${source}: row ${idx + 1} has no requirement key (add a "req" column or a "req:" line)`);
    const step = rowStep(row, `${source} row ${idx + 1}`);
    const name = row.name || `${row.run ? 'run' : `${(row.method ?? '').toUpperCase()} ${row.url ?? ''}`}`.trim();
    if (!byReq.has(req)) byReq.set(req, []);
    byReq.get(req)!.push({ name, steps: [step] });
  });

  return [...byReq.entries()].map(([req, cases]) => normalizeSpec({ req, cases }, source));
}
