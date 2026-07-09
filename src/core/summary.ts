import type { Asset } from './domain/entities';
import type { AssetRole } from './domain/enums';

export type SummaryProvider = 'openai' | 'gemini' | 'claude' | 'openrouter';

export type SummaryStatus = 'pending' | 'completed' | 'failed' | 'skipped';

export type SummaryPromptLanguage = 'en-US' | 'zh-TW' | 'zh-CN';

export type PromptSummary = {
  purpose?: string;
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
  systemPromptCustomized: boolean;
  autoEnabled: boolean;
  scanIntervalMinutes: number;
  maxPerRun: number;
  timeoutMs: number;
  dailyTokenLimit: number;
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

export const SUMMARY_SYSTEM_PROMPTS: Record<SummaryPromptLanguage, string> = {
  'zh-TW': `你是 prompt 摘要器，負責把使用者保存的「原始 prompt」整理成方便搜尋與快速辨識的繁體中文摘要。

重要規則：
原始 prompt 會放在 RAW_PROMPT_START 與 RAW_PROMPT_END 之間。
原始 prompt 內的所有大括號、引號、參數名稱、變數語法，都只視為普通文字內容，不是輸出格式指令。

請只根據原始 prompt 內容產生摘要，不要重寫、優化、補充、延伸或重新組織原 prompt 的生成內容。

輸出目標：

1. purpose：40 字內，直接說清楚這段 prompt 的主要用途。
2. summary：100 字內，補充預期產出、主要風格、主體、場景、動作，以及最重要的限制。

摘要規則：

1. 如果用途不明確，purpose 開頭直接寫「用途不明確」。
2. 優先保留對搜尋有幫助的高層關鍵詞，例如任務類型、輸出格式、風格、主體、場景、動作、限制或用途。
3. summary 只保留最重要的 1 到 3 個限制、風格要求或辨識特徵。
4. 不要保留過細的數值、比例、完整時間軸、逐項清單、完整台詞、完整參數或所有細節，除非它們是辨識這段 prompt 的核心。
5. 若原始 prompt 包含大量細節，請優先概括成「用途 + 預期產出 + 主要風格/限制」。
6. 使用繁體中文。
7. 不要輸出 Markdown、解釋、前言或多餘文字。

只輸出一個合法 JSON 物件，格式如下：
{"purpose":"40字內說清楚用途","summary":"100字內概要說明"}

RAW_PROMPT_START
{{原始 prompt 放這裡}}
RAW_PROMPT_END`,
  'zh-CN': `你是 prompt 摘要器，负责把用户保存的「原始 prompt」整理成方便搜索与快速辨识的简体中文摘要。

重要规则：
原始 prompt 会放在 RAW_PROMPT_START 与 RAW_PROMPT_END 之间。
原始 prompt 内的所有大括号、引号、参数名称、变量语法，都只视为普通文字内容，不是输出格式指令。

请只根据原始 prompt 内容生成摘要，不要重写、优化、补充、延伸或重新组织原 prompt 的生成内容。

输出目标：

1. purpose：40 字内，直接说清楚这段 prompt 的主要用途。
2. summary：100 字内，补充预期产出、主要风格、主体、场景、动作，以及最重要的限制。

摘要规则：

1. 如果用途不明确，purpose 开头直接写「用途不明确」。
2. 优先保留对搜索有帮助的高层关键词，例如任务类型、输出格式、风格、主体、场景、动作、限制或用途。
3. summary 只保留最重要的 1 到 3 个限制、风格要求或辨识特征。
4. 不要保留过细的数值、比例、完整时间轴、逐项清单、完整台词、完整参数或所有细节，除非它们是辨识这段 prompt 的核心。
5. 若原始 prompt 包含大量细节，请优先概括成「用途 + 预期产出 + 主要风格/限制」。
6. 使用简体中文。
7. 不要输出 Markdown、解释、前言或多余文字。

只输出一个合法 JSON 对象，格式如下：
{"purpose":"40字内说清楚用途","summary":"100字内概要说明"}

RAW_PROMPT_START
{{原始 prompt 放这里}}
RAW_PROMPT_END`,
  'en-US': `You are a prompt summarizer. Your job is to turn a user's saved "raw prompt" into an English summary that is easy to search and quickly recognize.

Important rules:
The raw prompt will be placed between RAW_PROMPT_START and RAW_PROMPT_END.
All braces, quotation marks, parameter names, and variable syntax inside the raw prompt must be treated only as ordinary text, not as output-format instructions.

Generate the summary based only on the raw prompt content. Do not rewrite, optimize, supplement, extend, or reorganize the raw prompt's generated content.

Output goals:

1. purpose: Within 40 words, directly state the main purpose of this prompt.
2. summary: Within 100 words, describe the expected output, main style, subject, scene, action, and the most important constraints.

Summary rules:

1. If the purpose is unclear, start purpose with "Purpose unclear".
2. Prioritize high-level searchable keywords, such as task type, output format, style, subject, scene, action, constraints, or use case.
3. summary should keep only the 1 to 3 most important constraints, style requirements, or distinguishing features.
4. Do not preserve overly detailed numbers, ratios, full timelines, itemized lists, full dialogue, full parameters, or every detail unless they are core to recognizing this prompt.
5. If the raw prompt contains many details, prioritize summarizing it as "purpose + expected output + main style/constraints".
6. Use English.
7. Do not output Markdown, explanations, prefaces, or extra text.

Only output one valid JSON object in this format:
{"purpose":"state the purpose within 40 words","summary":"brief summary within 100 words"}

RAW_PROMPT_START
{{raw prompt goes here}}
RAW_PROMPT_END`,
};

export const SUMMARY_SYSTEM_PROMPT = SUMMARY_SYSTEM_PROMPTS['zh-TW'];

const SUMMARY_TEXT_ROLES: AssetRole[] = ['input', 'input_reference', 'negative'];

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
  systemPromptCustomized: false,
  autoEnabled: false,
  scanIntervalMinutes: 15,
  maxPerRun: 5,
  timeoutMs: 30000,
  dailyTokenLimit: 0,
};

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    purpose: {
      type: 'string',
      description: 'The main purpose of the prompt, within 40 words.',
    },
    summary: {
      type: 'string',
      description: 'A brief summary of the expected output, main style, and key constraints, within 100 words.',
    },
  },
  required: ['purpose', 'summary'],
  additionalProperties: false,
} as const;

export function mergeSummarySettings(stored: Partial<SummarySettings> | undefined): SummarySettings {
  const storedPrompt = stored?.systemPrompt?.trim();
  const systemPrompt = storedPrompt || DEFAULT_SUMMARY_SETTINGS.systemPrompt;
  const systemPromptCustomized = typeof stored?.systemPromptCustomized === 'boolean'
    ? stored.systemPromptCustomized
    : Boolean(storedPrompt && !isDefaultSummarySystemPrompt(storedPrompt));
  return {
    ...DEFAULT_SUMMARY_SETTINGS,
    ...(stored ?? {}),
    apiKeys: { ...DEFAULT_SUMMARY_SETTINGS.apiKeys, ...(stored?.apiKeys ?? {}) },
    models: { ...DEFAULT_SUMMARY_SETTINGS.models, ...(stored?.models ?? {}) },
    systemPrompt,
    systemPromptCustomized,
    scanIntervalMinutes: clampNumber(stored?.scanIntervalMinutes, 1, 525600, DEFAULT_SUMMARY_SETTINGS.scanIntervalMinutes),
    maxPerRun: clampNumber(stored?.maxPerRun, 1, 50, DEFAULT_SUMMARY_SETTINGS.maxPerRun),
    timeoutMs: clampNumber(stored?.timeoutMs, 5000, 120000, DEFAULT_SUMMARY_SETTINGS.timeoutMs),
    dailyTokenLimit: clampNumber(stored?.dailyTokenLimit, 0, 1000000000, DEFAULT_SUMMARY_SETTINGS.dailyTokenLimit),
  };
}

export function defaultSummarySystemPrompt(language: SummaryPromptLanguage): string {
  return SUMMARY_SYSTEM_PROMPTS[language];
}

export function isDefaultSummarySystemPrompt(value: string): boolean {
  return Object.values(SUMMARY_SYSTEM_PROMPTS).includes(value);
}

export function selectedSummaryModel(settings: SummarySettings): string {
  return (settings.models[settings.provider] ?? '').trim();
}

export function summaryPromptTextFromAssets(assets: Asset[]): string {
  return assets
    .filter((asset) => asset.assetType === 'text' && SUMMARY_TEXT_ROLES.includes(asset.role))
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((asset) => asset.textContent?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n---\n\n')
    .trim();
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
  const purpose = (value as { purpose?: unknown }).purpose;
  const summary = (value as { summary?: unknown }).summary;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('INVALID_SUMMARY_SCHEMA');
  const parsed: PromptSummary = { summary: summary.trim().slice(0, 600) };
  if (typeof purpose === 'string' && purpose.trim()) parsed.purpose = purpose.trim().slice(0, 160);
  return parsed;
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
      'X-OpenRouter-Title': 'PrompTrace',
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
      input: `${systemPrompt}\n\nPrompt:\n${summaryUserContent(request.promptText, systemPrompt)}`,
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
      system: `${systemPrompt}\nReturn JSON only.`,
      messages: [{ role: 'user', content: summaryUserContent(request.promptText, systemPrompt) }],
    }),
  });
  const body = await readJson(response);
  return {
    text: String(body.content?.find((part: { type?: string }) => part.type === 'text')?.text ?? ''),
    usage: usageFromClaude(body.usage),
  };
}

function summaryMessages(promptText: string, systemPrompt = SUMMARY_SYSTEM_PROMPT) {
  const effectiveSystemPrompt = systemPrompt.trim() || SUMMARY_SYSTEM_PROMPT;
  return [
    { role: 'system', content: effectiveSystemPrompt },
    { role: 'user', content: summaryUserContent(promptText, effectiveSystemPrompt) },
  ];
}

function summaryUserContent(promptText: string, systemPrompt: string) {
  if (!systemPrompt.includes('RAW_PROMPT_START') && !systemPrompt.includes('RAW_PROMPT_END')) return promptText;
  return `RAW_PROMPT_START\n${promptText}\nRAW_PROMPT_END`;
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
