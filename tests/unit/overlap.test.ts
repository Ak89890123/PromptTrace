import { describe, expect, it } from 'vitest';
import { checkSelection } from '@/src/core/capture/overlap';
import type { PendingAsset } from '@/src/core/domain/entities';

const textAsset = (id: string, text: string): PendingAsset => ({
  id,
  assetType: 'text',
  role: null,
  textContent: text,
  pageUrl: 'https://x.test',
  pageTitle: 't',
  capturedAt: '',
});

const imageAsset = (id: string, url: string): PendingAsset => ({
  id,
  assetType: 'image',
  role: null,
  originalUrl: url,
  pageUrl: 'https://x.test',
  pageTitle: 't',
  capturedAt: '',
});

describe('duplicate / overlap detection', () => {
  it('detects exact text duplicate (whitespace-insensitive)', () => {
    const existing = [textAsset('a', 'Hello  world')];
    const result = checkSelection(existing, { assetType: 'text', textContent: ' Hello world ' });
    expect(result).toEqual({ kind: 'duplicate', existingId: 'a' });
  });

  it('detects containment overlap in both directions', () => {
    const existing = [textAsset('a', 'The quick brown fox jumps')];
    expect(checkSelection(existing, { assetType: 'text', textContent: 'quick brown fox' })).toEqual({
      kind: 'overlap',
      existingId: 'a',
    });
    expect(
      checkSelection(existing, {
        assetType: 'text',
        textContent: 'Said: The quick brown fox jumps over the dog',
      }),
    ).toEqual({ kind: 'overlap', existingId: 'a' });
  });

  it('reports DOM-range overlap passed from the content script', () => {
    const existing = [textAsset('a', 'first paragraph'), textAsset('b', 'second paragraph')];
    expect(
      checkSelection(existing, { assetType: 'text', textContent: 'unrelated words' }, 'b'),
    ).toEqual({ kind: 'overlap', existingId: 'b' });
  });

  it('accepts distinct text', () => {
    const existing = [textAsset('a', 'alpha beta')];
    expect(checkSelection(existing, { assetType: 'text', textContent: 'gamma delta' })).toEqual({
      kind: 'ok',
    });
  });

  it('detects duplicate media by url, allows different urls', () => {
    const existing = [imageAsset('a', 'https://x.test/1.png')];
    expect(
      checkSelection(existing, { assetType: 'image', originalUrl: 'https://x.test/1.png' }),
    ).toEqual({ kind: 'duplicate', existingId: 'a' });
    expect(
      checkSelection(existing, { assetType: 'image', originalUrl: 'https://x.test/2.png' }),
    ).toEqual({ kind: 'ok' });
  });

  it('same url but different asset type is not a duplicate', () => {
    const existing = [imageAsset('a', 'https://x.test/1.mp4')];
    expect(
      checkSelection(existing, { assetType: 'video', originalUrl: 'https://x.test/1.mp4' }),
    ).toEqual({ kind: 'ok' });
  });
});
