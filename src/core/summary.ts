export type SummaryProvider = 'openai' | 'gemini' | 'claude' | 'openrouter';

export type SummaryStatus = 'pending' | 'completed' | 'failed' | 'skipped';

export type PromptSummary = {
  summary: string;
  usage?: SummaryTokenUsage;
};

export type SummaryTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type SummarySettings = {
  enabled: boolean;
  provider: SummaryProvider;
  apiKeys: Partial<Record<SummaryProvider, string>>;
  models: Partial<Record<SummaryProvider, string>>;
  systemPrompt: string;
  autoEnabled: boolean;
  scanIntervalMinutes: number;
  maxPerRun: number;
  timeoutMs: number;
};

export type SummaryRequest = {
  provider: SummaryProvider;
  apiKey: string;
  model: string;
  promptText: string;
  systemPrompt?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export const SUMMARY_PROVIDER_LABELS: Record<SummaryProvider, string> = {
  openai: 'OpenAI API',
  gemini: 'Gemini API',
  claude: 'Claude API',
  openrouter: 'OpenRouter',
};

export const SUMMARY_PROVIDER_MODELS: Record<SummaryProvider, string[]> = {
  openai: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
  gemini: ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
  claude: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'],
  openrouter: ['openai/gpt-5.2', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash'],
};

export const SUMMARY_SYSTEM_PROMPT =
  '你是 prompt 摘要器，負責把使用者保存的 prompt 文字整理成簡短摘要。\n\n請根據原始 prompt 文字，產生一段簡潔、明確、方便搜尋的繁體中文摘要。摘要要讓使用者快速理解這段 prompt 的用途、預期產出，以及原文中明確提到的重要限制或風格要求。\n\n規則：\n1. 只根據原始 prompt 文字摘要，不要改寫原 prompt。\n2. 不要補充原文沒有出現或無法合理判斷的資訊。\n3. 如果用途不明確，摘要開頭直接寫「用途不明確」。\n4. 優先保留對搜尋有幫助的關鍵詞，例如任務類型、輸出格式、平台、風格、限制、角色、工具或模型名稱。\n5. 摘要使用繁體中文，長度控制在 1 到 2 句。\n6. 不要輸出 Markdown、解釋、前言或多餘文字。\n\n只輸出符合 JSON schema 的結果：\n\n{"summary":"這裡放摘要文字"}';

export const DEFAULT_SUMMARY_SETTINGS: SummarySettings = {
  enabled: false,
  provider: 'openai',
  apiKeys: {},
  models: {
    openai: 'gpt-5.4-mini',
    gemini: 'gemini-3.5-flash',
    claude: 'claude-sonnet-5',
    openrouter: 'openai/gpt-5.2',
  },
  systemPrompt: SUMMARY_SYSTEM_PROMPT,
  autoEnabled: false,
  scanIntervalMinutes: 15,
  maxPerRun: 5,
  timeoutMs: 30000,
};

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: '用繁體中文，用一到兩句話說明這段 prompt 的主要用途與預期產出。',
    },
  },
  required: ['summary'],
  additionalProperties: false,
} as const;

export function mergeSummarySettings(stored: Partial<SummarySettings> | undefined): SummarySettings {
  return {
    ...DEFAULT_SUMMARY_SETTINGS,
    ...(stored ?? {}),
    apiKeys: { ...DEFAULT_SUMMARY_SETTINGS.apiKeys, ...(stored?.apiKeys ?? {}) },
    models: { ...DEFAULT_SUMMARY_SETTINGS.models, ...(stored?.models ?? {}) },
    systemPrompt: stored?.systemPrompt?.trim() || DEFAULT_SUMMARY_SETTINGS.systemPrompt,
    scanIntervalMinutes: clampNumber(stored?.scanIntervalMinutes, 1, 525600, DEFAULT_SUMMARY_SETTINGS.scanIntervalMinutes),
    maxPerRun: clampNumber(stored?.maxPerRun, 1, 50, DEFAULT_SUMMARY_SETTINGS.maxPerRun),
    timeoutMs: clampNumber(stored?.timeoutMs, 5000, 120000, DEFAULT_SUMMARY_SETTINGS.timeoutMs),
  };
}

export function selectedSummaryModel(settings: SummarySettings): string {
  return (settings.models[settings.provider] ?? '').trim();
}

export function maskApiKey(value: string | undefined): string {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('EMPTY_SUMMARY_RESPONSE');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('INVALID_SUMMARY_JSON');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function parsePromptSummary(value: unknown): PromptSummary {
  if (!value || typeof value !== 'object') throw new Error('INVALID_SUMMARY_SCHEMA');
  const summary = (value as { summary?: unknown }).summary;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('INVALID_SUMMARY_SCHEMA');
  return { summary: summary.trim().slice(0, 600) };
}

export async function requestPromptSummary(request: SummaryRequest): Promise<PromptSummary> {
  if (!request.promptText.trim()) throw new Error('NO_PROMPT_TEXT');
  if (!request.apiKey.trim()) throw new Error('SUMMARY_API_KEY_REQUIRED');
  if (!request.model.trim()) throw new Error('SUMMARY_MODEL_REQUIRED');

  const fetcher = request.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const result = await callProvider(request, fetcher, controller.signal);
    return {
      ...parsePromptSummary(extractJsonObject(result.text)),
      usage: result.usage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callProvider(
  request: SummaryRequest,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ text: string; usage?: SummaryTokenUsage }> {
  switch (request.provider) {
    case 'openai':
      return callOpenAi(request, fetcher, signal);
    case 'gemini':
      return callGemini(request, fetcher, signal);
    case 'claude':
      return callClaude(request, fetcher, signal);
    case 'openrouter':
      return callOpenRouter(request, fetcher, signal);
  }
}

async function callOpenAi(
  request: SummaryRequest,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ text: string; usage?: SummaryTokenUsage }> {
  const response = await fetcher('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      messages: summaryMessages(request.promptText, request.systemPrompt),
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'prompttrace_summary', strict: true, schema: SUMMARY_SCHEMA },
      },
    }),
  });
  const body = await readJson(response);
  return {
    text: String(body.choices?.[0]?.message?.content ?? ''),
    usage: usageFromOpenAiStyle(body.usage),
  };
}

async function callOpenRouter(
  request: SummaryRequest,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ text: string; usage?: SummaryTokenUsage }> {
  const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      'Content-Type': 'application/json',
      'X-OpenRouter-Title': 'PromptTrace',
    },
    body: JSON.stringify({
      model: request.model,
      messages: summaryMessages(request.promptText, request.systemPrompt),
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'prompttrace_summary', strict: true, schema: SUMMARY_SCHEMA },
      },
    }),
  });
  const body = await readJson(response);
  return {
    text: String(body.choices?.[0]?.message?.content ?? ''),
    usage: usageFromOpenAiStyle(body.usage),
  };
}

async function callGemini(
  request: SummaryRequest,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ text: string; usage?: SummaryTokenUsage }> {
  const systemPrompt = request.systemPrompt?.trim() || SUMMARY_SYSTEM_PROMPT;
  const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    signal,
    headers: {
      'x-goog-api-key': request.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      input: `${systemPrompt}\n\nPrompt:\n${request.promptText}`,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: SUMMARY_SCHEMA,
      },
    }),
  });
  const body = await readJson(response);
  return {
    text: String(body.output_text ?? body.text ?? ''),
    usage: usageFromGemini(body.usageMetadata ?? body.usage_metadata),
  };
}

async function callClaude(
  request: SummaryRequest,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ text: string; usage?: SummaryTokenUsage }> {
  const systemPrompt = request.systemPrompt?.trim() || SUMMARY_SYSTEM_PROMPT;
  const response = await fetcher('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'x-api-key': request.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: 512,
      system: `${systemPrompt}\n請只回傳 JSON：{"summary":"..."}`,
      messages: [{ role: 'user', content: request.promptText }],
    }),
  });
  const body = await readJson(response);
  return {
    text: String(body.content?.find((part: { type?: string }) => part.type === 'text')?.text ?? ''),
    usage: usageFromClaude(body.usage),
  };
}

function summaryMessages(promptText: string, systemPrompt = SUMMARY_SYSTEM_PROMPT) {
  return [
    { role: 'system', content: systemPrompt.trim() || SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: promptText },
  ];
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  let body: any = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    const code = body?.error?.code || body?.error?.type || response.status;
    throw new Error(`SUMMARY_PROVIDER_${code}`);
  }
  return body;
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function asToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function normalizeUsage(inputTokens: unknown, outputTokens: unknown, totalTokens: unknown): SummaryTokenUsage | undefined {
  const input = asToken(inputTokens);
  const output = asToken(outputTokens);
  const explicitTotal = asToken(totalTokens);
  const total = explicitTotal ?? (input != null && output != null ? input + output : null);
  if (input == null && output == null && total == null) return undefined;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function usageFromOpenAiStyle(usage: unknown): SummaryTokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const value = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  return normalizeUsage(value.prompt_tokens, value.completion_tokens, value.total_tokens);
}

function usageFromGemini(usage: unknown): SummaryTokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const value = usage as {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    totalTokenCount?: unknown;
    prompt_token_count?: unknown;
    candidates_token_count?: unknown;
    total_token_count?: unknown;
  };
  return normalizeUsage(
    value.promptTokenCount ?? value.prompt_token_count,
    value.candidatesTokenCount ?? value.candidates_token_count,
    value.totalTokenCount ?? value.total_token_count,
  );
}

function usageFromClaude(usage: unknown): SummaryTokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const value = usage as { input_tokens?: unknown; output_tokens?: unknown };
  return normalizeUsage(value.input_tokens, value.output_tokens, undefined);
}
