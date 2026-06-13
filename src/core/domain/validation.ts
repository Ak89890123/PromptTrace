import type { AssetRole, AssetType } from './enums';
import type { ModelPreset, PendingAsset, RecordCategory } from './entities';

/** Roles allowed per asset type. Images/videos must never be Negative. */
const ALLOWED_ROLES: Record<AssetType, AssetRole[]> = {
  text: ['input', 'input_reference', 'negative', 'output'],
  image: ['input', 'input_reference', 'output'],
  video: ['input', 'input_reference', 'output'],
};

export function allowedRolesFor(assetType: AssetType): AssetRole[] {
  return ALLOWED_ROLES[assetType];
}

export function isRoleAllowed(assetType: AssetType, role: AssetRole): boolean {
  return ALLOWED_ROLES[assetType].includes(role);
}

export const ROLE_NOT_ALLOWED_MESSAGE =
  '圖片與影片不能作為 Negative，只能作為 Input 或 Output。';

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validatePendingAsset(asset: PendingAsset): ValidationResult {
  if (asset.assetType === 'text') {
    if (!asset.textContent || asset.textContent.trim().length === 0) {
      return { ok: false, reason: '文字 asset 不能是空白內容。' };
    }
  } else if (!asset.originalUrl && !asset.sourceOnly) {
    return { ok: false, reason: '媒體 asset 需要來源 URL，或標記為僅保存來源。' };
  }
  if (asset.role !== null && !isRoleAllowed(asset.assetType, asset.role)) {
    return { ok: false, reason: ROLE_NOT_ALLOWED_MESSAGE };
  }
  return { ok: true };
}

export function validateCategoryName(name: string): ValidationResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, reason: '分類名稱不能為空。' };
  if (trimmed.length > 60) return { ok: false, reason: '分類名稱不能超過 60 字。' };
  return { ok: true };
}

/**
 * Validate a category tree: parent must exist and no cycles.
 * Returns the ids of invalid categories (missing parent or part of a cycle).
 */
export function validateCategoryTree(categories: RecordCategory[]): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const invalid: string[] = [];
  for (const cat of categories) {
    if (cat.parentId && !byId.has(cat.parentId)) {
      invalid.push(cat.id);
      continue;
    }
    // cycle detection by walking up
    const seen = new Set<string>([cat.id]);
    let cur = cat.parentId ?? null;
    while (cur) {
      if (seen.has(cur)) {
        invalid.push(cat.id);
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  return invalid;
}

/** Would setting `parentId` on `categoryId` create a cycle? */
export function wouldCreateCycle(
  categories: RecordCategory[],
  categoryId: string,
  parentId: string | null,
): boolean {
  if (!parentId) return false;
  if (parentId === categoryId) return true;
  const byId = new Map(categories.map((c) => [c.id, c]));
  let cur: string | null = parentId;
  while (cur) {
    if (cur === categoryId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export function validateModelPreset(preset: Pick<ModelPreset, 'modelName'>): ValidationResult {
  if (!preset.modelName || preset.modelName.trim().length === 0) {
    return { ok: false, reason: 'Model 名稱不能為空。' };
  }
  return { ok: true };
}

/** Resolve the display path of a category, e.g. 生文 / 改寫 / 正式語氣. */
export function categoryPath(
  categories: RecordCategory[],
  categoryId: string | null | undefined,
): string {
  if (!categoryId) return 'Uncategorized';
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parts: string[] = [];
  let cur = byId.get(categoryId);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.length > 0 ? parts.join(' / ') : 'Uncategorized';
}

/** Sanitize a filename for chrome.downloads (no path separators / illegal chars). */
export function safeFilename(input: string, fallback = 'asset'): string {
  const base = input.split(/[/\\]/).pop() ?? '';
  const noQuery = base.split(/[?#]/)[0];
  const cleaned = noQuery.replace(/[^A-Za-z0-9._一-鿿-]+/g, '_').replace(/^_+|_+$/g, '');
  const limited = cleaned.slice(0, 120);
  return limited.length > 0 ? limited : fallback;
}
