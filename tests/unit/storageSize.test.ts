import { describe, expect, it } from 'vitest';
import {
  formatIndexedDbSize,
  formatMediaAssetTotalSize,
  indexedDbPreviewStorageBytes,
  summarizeMediaAssetStorage,
} from '@/src/core/media/storageSize';

describe('IndexedDB preview size formatting', () => {
  it('measures the stored Data URL string, including its prefix and Base64 payload', () => {
    const value = 'data:image/webp;base64,AAAA';
    expect(indexedDbPreviewStorageBytes(value)).toBe(new TextEncoder().encode(value).byteLength);
    expect(indexedDbPreviewStorageBytes('https://example.test/image.webp')).toBeUndefined();
    expect(indexedDbPreviewStorageBytes(undefined)).toBeUndefined();
  });

  it('formats KiB and MiB without decimal drift', () => {
    expect(formatIndexedDbSize(512 * 1024)).toBe('512 KB');
    expect(formatIndexedDbSize(0)).toBe('0 KB');
    expect(formatIndexedDbSize(1024 * 1024)).toBe('1 MB');
    expect(formatIndexedDbSize(1024 * 1024 + 234 * 1024)).toBe('1 MB + 234 KB');
  });

  it('shows aggregate totals as KB below one MB and decimal MB above it', () => {
    expect(formatMediaAssetTotalSize(42 * 1024)).toBe('42 KB');
    expect(formatMediaAssetTotalSize(2 * 1024 * 1024 + 345 * 1024)).toBe('2.34 MB');
  });

  it('counts every image and video while summing only persisted previews', () => {
    const imagePreview = 'data:image/webp;base64,AAAA';
    const videoPreview = 'data:image/gif;base64,AAAA';
    expect(summarizeMediaAssetStorage([
      { assetType: 'text', previewRef: 'ignored' },
      { assetType: 'image', previewRef: imagePreview },
      { assetType: 'video', previewRef: videoPreview },
      { assetType: 'image' },
    ])).toEqual({
      assetCount: 3,
      totalBytes:
        new TextEncoder().encode(imagePreview).byteLength +
        new TextEncoder().encode(videoPreview).byteLength,
    });
  });
});
