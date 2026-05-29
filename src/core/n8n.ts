/**
 * Thin n8n webhook client. Posts a JSON body to `{webhookUrl}/{path}` and returns the
 * parsed JSON response. The publish workflows respond with a JSON node, so we expect JSON.
 */
import { getConfig } from './config.js';

const DEFAULT_TIMEOUT_MS = 60_000;

export class N8nError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'N8nError';
  }
}

/** POST `body` to the n8n webhook at `path` (e.g. `markdown-to-jira`) and parse the JSON reply. */
export async function postWebhook<T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const { webhookUrl } = getConfig();
  const url = `${webhookUrl}/${path.replace(/^\/+/, '')}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new N8nError(`Failed to reach n8n webhook at ${url}: ${reason}. Is n8n running (docker compose up)?`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new N8nError(`n8n webhook ${path} returned ${res.status}`, res.status, text);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new N8nError(`n8n webhook ${path} returned non-JSON response`, res.status, text);
  }
}
