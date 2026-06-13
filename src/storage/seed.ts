import type { ModelPreset, RecordCategory } from '../core/domain/entities';
import { categoryRepository, modelPresetRepository } from './repositories';

const now = () => new Date().toISOString();

function builtinCategory(id: string, name: string, sortOrder: number, color?: string): RecordCategory {
  return {
    id,
    parentId: null,
    name,
    isBuiltin: true,
    isActive: true,
    sortOrder,
    color,
    createdAt: now(),
    updatedAt: now(),
  };
}

function preset(
  id: string,
  modelName: string,
  provider: string | undefined,
  categoryId: string | null,
  sortOrder: number,
): ModelPreset {
  return {
    id,
    categoryId,
    provider,
    modelName,
    isActive: true,
    isDefault: false,
    sortOrder,
    createdAt: now(),
    updatedAt: now(),
  };
}

export const BUILTIN_CATEGORY_IDS = {
  text: 'builtin-text-gen',
  image: 'builtin-image-gen',
  video: 'builtin-video-gen',
  systemPrompt: 'builtin-system-prompt',
  analysis: 'builtin-analysis-prompt',
  codeReview: 'builtin-code-review-prompt',
  research: 'builtin-research-prompt',
} as const;

/** Seed built-in categories and starter model presets, once. Idempotent. */
export async function seedDefaults(): Promise<void> {
  const existing = await categoryRepository.list();
  if (existing.length > 0) return;

  const cats: RecordCategory[] = [
    builtinCategory(BUILTIN_CATEGORY_IDS.text, '生文', 0, '#22D3EE'),
    builtinCategory(BUILTIN_CATEGORY_IDS.image, '生圖', 1, '#A78BFA'),
    builtinCategory(BUILTIN_CATEGORY_IDS.video, '生影', 2, '#34D399'),
    builtinCategory(BUILTIN_CATEGORY_IDS.systemPrompt, 'System Prompt', 3),
    builtinCategory(BUILTIN_CATEGORY_IDS.analysis, '分析 Prompt', 4),
    builtinCategory(BUILTIN_CATEGORY_IDS.codeReview, 'Code Review Prompt', 5),
    builtinCategory(BUILTIN_CATEGORY_IDS.research, 'Research Prompt', 6),
  ];
  for (const c of cats) await categoryRepository.save(c);

  const presets: ModelPreset[] = [
    preset('preset-gpt', 'GPT', 'OpenAI', BUILTIN_CATEGORY_IDS.text, 0),
    preset('preset-claude', 'Claude', 'Anthropic', BUILTIN_CATEGORY_IDS.text, 1),
    preset('preset-gemini', 'Gemini', 'Google', BUILTIN_CATEGORY_IDS.text, 2),
    preset('preset-midjourney', 'Midjourney', 'Midjourney', BUILTIN_CATEGORY_IDS.image, 10),
    preset('preset-sd', 'Stable Diffusion', 'Stability AI', BUILTIN_CATEGORY_IDS.image, 11),
    preset('preset-flux', 'Flux', 'Black Forest Labs', BUILTIN_CATEGORY_IDS.image, 12),
    preset('preset-dalle', 'DALL·E', 'OpenAI', BUILTIN_CATEGORY_IDS.image, 13),
    preset('preset-runway', 'Runway', 'Runway', BUILTIN_CATEGORY_IDS.video, 20),
    preset('preset-sora', 'Sora', 'OpenAI', BUILTIN_CATEGORY_IDS.video, 21),
    preset('preset-kling', 'Kling', 'Kuaishou', BUILTIN_CATEGORY_IDS.video, 22),
    preset('preset-pika', 'Pika', 'Pika', BUILTIN_CATEGORY_IDS.video, 23),
  ];
  for (const p of presets) await modelPresetRepository.save(p);
}
