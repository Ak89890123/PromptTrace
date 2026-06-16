import { describe, it, expect } from 'vitest';
import { detectProvider } from '@/src/core/capture/detectProvider';

describe('detectProvider', () => {
  it('detects major chat LLM hosts', () => {
    expect(detectProvider('https://chatgpt.com/c/abc')).toEqual({ provider: 'OpenAI', modelName: 'GPT' });
    expect(detectProvider('https://gemini.google.com/app')).toEqual({ provider: 'Google', modelName: 'Gemini' });
    expect(detectProvider('https://claude.ai/chat/x')).toEqual({ provider: 'Anthropic', modelName: 'Claude' });
    expect(detectProvider('https://www.perplexity.ai/')).toEqual({
      provider: 'Perplexity',
      modelName: 'Perplexity',
    });
  });

  it('matches subdomains via the leading-dot anchor', () => {
    expect(detectProvider('https://www.openai.com')).toEqual({ provider: 'OpenAI', modelName: 'GPT' });
    expect(detectProvider('https://aistudio.google.com/x')).toEqual({ provider: 'Google', modelName: 'Gemini' });
  });

  it('does not match lookalike hosts', () => {
    expect(detectProvider('https://notchatgpt.com')).toBeNull();
    expect(detectProvider('https://openai.com.evil.test')).toBeNull();
  });

  it('returns null for unknown, local, or invalid urls', () => {
    expect(detectProvider('https://example.com')).toBeNull();
    expect(detectProvider('http://127.0.0.1:5599/x')).toBeNull();
    expect(detectProvider('not a url')).toBeNull();
    expect(detectProvider(undefined)).toBeNull();
  });
});
