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
  music: 'builtin-music-gen',
} as const;

export const BUILTIN_CATEGORY_DEFAULTS = [
  { id: BUILTIN_CATEGORY_IDS.text, name: '生文', sortOrder: 0, color: '#22D3EE' },
  { id: BUILTIN_CATEGORY_IDS.image, name: '生圖', sortOrder: 1, color: '#A78BFA' },
  { id: BUILTIN_CATEGORY_IDS.video, name: '生影', sortOrder: 2, color: '#34D399' },
  { id: BUILTIN_CATEGORY_IDS.music, name: '生音樂', sortOrder: 3, color: '#FBBF24' },
] as const;

export const BUILTIN_MODEL_PRESET_DEFAULTS = [
  { id: 'preset-gpt', modelName: 'ChatGPT', provider: 'OpenAI', categoryId: null, sortOrder: 0 },
  { id: 'preset-claude', modelName: 'Claude', provider: 'Anthropic', categoryId: null, sortOrder: 1 },
  { id: 'preset-gemini', modelName: 'Gemini', provider: 'Google', categoryId: null, sortOrder: 2 },
] as const;

/** Seed built-in categories and starter model presets, once. Idempotent. */
export async function seedDefaults(): Promise<void> {
  const existing = await categoryRepository.list();
  if (existing.length > 0) return;

  const cats: RecordCategory[] = BUILTIN_CATEGORY_DEFAULTS.map((c) =>
    builtinCategory(c.id, c.name, c.sortOrder, c.color),
  );
  for (const c of cats) await categoryRepository.save(c);

  const presets: ModelPreset[] = BUILTIN_MODEL_PRESET_DEFAULTS.map((p) =>
    preset(p.id, p.modelName, p.provider, p.categoryId, p.sortOrder),
  );
  for (const p of presets) await modelPresetRepository.save(p);
}
