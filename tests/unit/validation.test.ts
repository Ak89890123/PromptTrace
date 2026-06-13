import { describe, expect, it } from 'vitest';
import type { PendingAsset, RecordCategory } from '@/src/core/domain/entities';
import {
  allowedRolesFor,
  categoryPath,
  isRoleAllowed,
  safeFilename,
  validateCategoryName,
  validateCategoryTree,
  validateModelPreset,
  validatePendingAsset,
  wouldCreateCycle,
} from '@/src/core/domain/validation';

const cat = (id: string, name: string, parentId: string | null = null): RecordCategory => ({
  id,
  parentId,
  name,
  isBuiltin: false,
  isActive: true,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
});

describe('role validation', () => {
  it('text allows all four roles', () => {
    expect(allowedRolesFor('text')).toEqual(['input', 'input_reference', 'negative', 'output']);
  });

  it('image and video cannot be negative, but can be input/reference/output', () => {
    expect(isRoleAllowed('image', 'negative')).toBe(false);
    expect(isRoleAllowed('video', 'negative')).toBe(false);
    expect(isRoleAllowed('image', 'input_reference')).toBe(true);
    expect(isRoleAllowed('video', 'input_reference')).toBe(true);
    expect(isRoleAllowed('image', 'input')).toBe(true);
    expect(isRoleAllowed('video', 'output')).toBe(true);
    expect(allowedRolesFor('image')).toEqual(['input', 'input_reference', 'output']);
  });
});

describe('pending asset validation', () => {
  const base: PendingAsset = {
    id: '1',
    assetType: 'text',
    role: null,
    textContent: 'hello',
    pageUrl: 'https://x.test',
    pageTitle: 't',
    capturedAt: '',
  };

  it('accepts valid text asset', () => {
    expect(validatePendingAsset(base).ok).toBe(true);
  });

  it('rejects empty text', () => {
    expect(validatePendingAsset({ ...base, textContent: '  ' }).ok).toBe(false);
  });

  it('rejects negative role on image', () => {
    expect(
      validatePendingAsset({
        ...base,
        assetType: 'image',
        textContent: undefined,
        originalUrl: 'https://x.test/a.png',
        role: 'negative',
      }).ok,
    ).toBe(false);
  });

  it('media without url is ok only when sourceOnly', () => {
    const media = { ...base, assetType: 'video' as const, textContent: undefined };
    expect(validatePendingAsset(media).ok).toBe(false);
    expect(validatePendingAsset({ ...media, sourceOnly: true }).ok).toBe(true);
  });
});

describe('category tree validation', () => {
  it('valid multi-level tree passes', () => {
    const tree = [cat('a', '生文'), cat('b', '改寫', 'a'), cat('c', '正式語氣', 'b')];
    expect(validateCategoryTree(tree)).toEqual([]);
  });

  it('detects missing parent', () => {
    expect(validateCategoryTree([cat('a', 'x', 'ghost')])).toEqual(['a']);
  });

  it('detects cycles', () => {
    const a = cat('a', 'A', 'b');
    const b = cat('b', 'B', 'a');
    expect(validateCategoryTree([a, b]).sort()).toEqual(['a', 'b']);
  });

  it('wouldCreateCycle prevents moving under own descendant', () => {
    const tree = [cat('a', 'A'), cat('b', 'B', 'a'), cat('c', 'C', 'b')];
    expect(wouldCreateCycle(tree, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(tree, 'c', 'a')).toBe(false);
    expect(wouldCreateCycle(tree, 'a', null)).toBe(false);
  });

  it('categoryPath resolves nested path and falls back to Uncategorized', () => {
    const tree = [cat('a', '生文'), cat('b', '改寫', 'a')];
    expect(categoryPath(tree, 'b')).toBe('生文 / 改寫');
    expect(categoryPath(tree, null)).toBe('Uncategorized');
    expect(categoryPath(tree, 'missing')).toBe('Uncategorized');
  });

  it('category name validation', () => {
    expect(validateCategoryName('生圖').ok).toBe(true);
    expect(validateCategoryName('   ').ok).toBe(false);
    expect(validateCategoryName('x'.repeat(61)).ok).toBe(false);
  });
});

describe('model preset validation', () => {
  it('requires a name', () => {
    expect(validateModelPreset({ modelName: 'Claude' }).ok).toBe(true);
    expect(validateModelPreset({ modelName: ' ' }).ok).toBe(false);
  });
});

describe('safeFilename', () => {
  it('strips path, query and illegal characters', () => {
    expect(safeFilename('https://x.test/a/b/image one.png?v=1')).toBe('image_one.png');
    expect(safeFilename('bad<>:"|*name.mp4')).not.toMatch(/[<>:"|*?]/);
    expect(safeFilename('')).toBe('asset');
    expect(safeFilename('???', 'video')).toBe('video');
  });

  it('limits length', () => {
    expect(safeFilename('a'.repeat(300) + '.png').length).toBeLessThanOrEqual(120);
  });
});
