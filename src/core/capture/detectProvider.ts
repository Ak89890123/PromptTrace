/**
 * Guess the LLM provider that produced the captured content from the page's
 * hostname, so the save wizard can offer it as a one-click model choice.
 * Returns null when the host isn't a recognised platform.
 */
export function detectProvider(url?: string): { provider: string; modelName: string } | null {
  if (!url) return null;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const rules: [RegExp, string, string][] = [
    [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, 'OpenAI', 'GPT'],
    [/(^|\.)claude\.ai$|(^|\.)anthropic\.com$/, 'Anthropic', 'Claude'],
    [/(^|\.)gemini\.google\.com$|(^|\.)aistudio\.google\.com$|(^|\.)bard\.google\.com$/, 'Google', 'Gemini'],
    [/(^|\.)perplexity\.ai$/, 'Perplexity', 'Perplexity'],
    [/(^|\.)grok\.com$|(^|\.)x\.ai$/, 'xAI', 'Grok'],
    [/(^|\.)deepseek\.com$/, 'DeepSeek', 'DeepSeek'],
    [/(^|\.)copilot\.microsoft\.com$/, 'Microsoft', 'Copilot'],
    [/(^|\.)meta\.ai$/, 'Meta', 'Llama'],
  ];
  for (const [re, provider, modelName] of rules) {
    if (re.test(host)) return { provider, modelName };
  }
  return null;
}
