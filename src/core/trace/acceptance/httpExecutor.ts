/**
 * HTTP step executor — built on global `fetch` (Node ≥20; no new dependency). Interpolates the URL,
 * headers, and body against the capture bag + env, sends the request, snapshots the response, runs the
 * step's assertions, and applies any `capture` (status / header:Name / a $.json.path) into `ctx.vars`
 * for later steps. `fetchImpl` is injectable so tests run against an in-process server (no real network).
 */
import { checkExpect, jsonPath, type Actual } from './assert.js';
import { interpolateHeaders, interpolateString, interpolateValue } from './interpolate.js';
import type { HttpStep } from './model.js';
import type { ExecContext, StepResult } from './execTypes.js';

function joinUrl(base: string | undefined, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!base) return url;
  return `${base.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());
}

function tryParseJson(text: string, contentType: string | undefined): unknown {
  const isJson = contentType?.includes('json') || /^\s*[{[]/.test(text);
  if (!isJson) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function applyCapture(spec: Record<string, string>, actual: Actual): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, src] of Object.entries(spec)) {
    if (src === 'status') out[name] = actual.status;
    else if (src.toLowerCase().startsWith('header:')) out[name] = actual.headers?.[src.slice(7).toLowerCase()];
    else out[name] = jsonPath(actual.json, src);
  }
  return out;
}

export async function executeHttpStep(step: HttpStep, ctx: ExecContext): Promise<StepResult> {
  const env = ctx.env ?? process.env;
  const doFetch = ctx.fetchImpl ?? fetch;
  const url = joinUrl(ctx.baseUrl, interpolateString(step.url, ctx.vars, env));
  const headers = { ...interpolateHeaders(ctx.headers, ctx.vars, env), ...interpolateHeaders(step.headers, ctx.vars, env) };

  let body: string | undefined;
  if (step.body !== undefined) {
    const b = interpolateValue(step.body, ctx.vars, env);
    if (typeof b === 'string') body = b;
    else {
      body = JSON.stringify(b);
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    }
  }

  const request = `${step.method} ${url}`;
  let res: Response;
  try {
    res = await doFetch(url, { method: step.method, headers, body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, failures: [`request failed: ${message}`], request, error: message };
  }

  const text = await res.text();
  const actual: Actual = {
    status: res.status,
    headers: headersToObject(res.headers),
    body: text,
    json: tryParseJson(text, res.headers.get('content-type') ?? undefined),
  };
  const failures = checkExpect(step.expect, actual);
  const captured = step.capture ? applyCapture(step.capture, actual) : undefined;
  if (captured) Object.assign(ctx.vars, captured);
  return { ok: failures.length === 0, failures, request, status: res.status, captured };
}
