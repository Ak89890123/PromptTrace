import { describe, expect, it, vi } from 'vitest';
import {
  defaultSummarySystemPrompt,
  extractJsonObject,
  maskApiKey,
  mergeSummarySettings,
  parsePromptSummary,
  requestPromptSummary,
  SUMMARY_SYSTEM_PROMPT,
} from '../../src/core/summary';

describe('summary helpers', () => {
  it('masks api keys without exposing the full value', () => {
    expect(maskApiKey('sk-test-1234567890')).toBe('sk-t...7890');
    expect(maskApiKey('short')).toBe('*****');
    expect(maskApiKey('')).toBe('');
  });

  it('extracts and validates a JSON summary', () => {
    const raw = '```json\n{"summary":"用來整理產品需求。"}\n```';
    expect(parsePromptSummary(extractJsonObject(raw))).toEqual({
      summary: '用來整理產品需求。',
    });
  });

  it('detects customized legacy system prompts during settings migration', () => {
    const migratedDefault = mergeSummarySettings({ systemPrompt: SUMMARY_SYSTEM_PROMPT });
    expect(migratedDefault.systemPromptCustomized).toBe(false);

    const migratedCustom = mergeSummarySettings({ systemPrompt: 'Always summarize in Japanese.' });
    expect(migratedCustom.systemPromptCustomized).toBe(true);
    expect(migratedCustom.systemPrompt).toBe('Always summarize in Japanese.');
  });

  it('provides default summary prompts by language', () => {
    expect(defaultSummarySystemPrompt('en-US')).toContain('Use English');
    expect(defaultSummarySystemPrompt('zh-TW')).toContain('繁體中文');
    expect(defaultSummarySystemPrompt('zh-CN')).toContain('简体中文');
  });

  it('rejects empty prompt text before calling the provider', async () => {
    const fetchImpl = vi.fn();
    await expect(
      requestPromptSummary({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-5.4-mini',
        promptText: '   ',
        timeoutMs: 5000,
        fetchImpl,
      }),
    ).rejects.toThrow('NO_PROMPT_TEXT');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requests an OpenAI-style JSON schema response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ summary: '用來產生短摘要。' }) } }],
          usage: { prompt_tokens: 41, completion_tokens: 9, total_tokens: 50 },
        }),
        { status: 200 },
      ),
    );

    const result = await requestPromptSummary({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-5.4-mini',
      promptText: '請摘要這段 prompt。',
      systemPrompt: '請輸出繁體中文 JSON 摘要。',
      timeoutMs: 5000,
      fetchImpl,
    });

    expect(result.summary).toBe('用來產生短摘要。');
    expect(result.usage).toEqual({ inputTokens: 41, outputTokens: 9, totalTokens: 50 });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body.messages[0]).toEqual({ role: 'system', content: '請輸出繁體中文 JSON 摘要。' });
    expect(body.messages[1]).toEqual({ role: 'user', content: '請摘要這段 prompt。' });
    expect(body.response_format.type).toBe('json_schema');
  });
});
