/**
 * Minimal, provider-agnostic chat client for `acp analyze`. Supports OpenAI-compatible endpoints
 * (OpenAI, GitHub Models, Azure, local LLMs) and Anthropic, configured from the environment. The
 * analyze orchestrator takes a `ChatFn` so it can be unit-tested with a fake model (no network).
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A single function the orchestrator calls: messages in → assistant text out. */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export interface AiConfig {
  provider?: string; // 'openai' | 'github-models' | 'anthropic' | …
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
}

/** Resolve AI settings from the environment (AI_PROVIDER / AI_BASE_URL / AI_MODEL / *_API_KEY). */
export function aiConfigFromEnv(env = process.env): AiConfig {
  const provider = (env.AI_PROVIDER ?? 'openai').toLowerCase();
  if (provider === 'anthropic' || provider === 'claude') {
    return {
      provider: 'anthropic',
      baseUrl: env.AI_BASE_URL ?? 'https://api.anthropic.com',
      model: env.AI_MODEL ?? 'claude-sonnet-4-6',
      apiKey: env.ANTHROPIC_API_KEY,
      maxTokens: Number(env.AI_MAX_TOKENS ?? 4096),
    };
  }
  return {
    provider,
    baseUrl: env.AI_BASE_URL ?? 'https://api.openai.com/v1',
    model: env.AI_MODEL ?? 'gpt-4o-mini',
    apiKey: env.OPENAI_API_KEY ?? env.GITHUB_TOKEN,
    maxTokens: Number(env.AI_MAX_TOKENS ?? 4096),
  };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI provider ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

/** Build a ChatFn for the resolved config. Throws (at call time) if no API key is set. */
export function defaultChat(cfg: AiConfig = aiConfigFromEnv()): ChatFn {
  return async (messages) => {
    if (!cfg.apiKey) throw new Error('No AI API key set (OPENAI_API_KEY / GITHUB_TOKEN / ANTHROPIC_API_KEY). Set one, or pass a chat function.');
    if (cfg.provider === 'anthropic') {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
      const data = (await postJson(
        `${cfg.baseUrl}/v1/messages`,
        { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        { model: cfg.model, max_tokens: cfg.maxTokens ?? 4096, system: system || undefined, messages: rest },
      )) as { content?: Array<{ text?: string }> };
      return data.content?.map((c) => c.text ?? '').join('') ?? '';
    }
    const data = (await postJson(
      `${cfg.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${cfg.apiKey}` },
      { model: cfg.model, messages, max_tokens: cfg.maxTokens ?? 4096 },
    )) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  };
}

/** Pull the first JSON object/array out of a model reply (tolerates ```json fences + prose). */
export function extractJson(text: string): unknown {
  // Only unwrap a fence that wraps the WHOLE reply (anchored), so a ```mermaid inside the JSON
  // string values isn't mistaken for the wrapper.
  const trimmed = text.trim();
  const wrapped = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = wrapped ? wrapped[1] : trimmed;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error('No JSON found in the model reply.');
  // Walk to the matching close so trailing prose is ignored.
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < candidate.length; i += 1) {
    if (candidate[i] === open) depth += 1;
    else if (candidate[i] === close) {
      depth -= 1;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  return JSON.parse(candidate.slice(start)); // last resort
}
