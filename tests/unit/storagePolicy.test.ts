import {
  DEFAULT_MEDIA_STORAGE_POLICY,
  LEGACY_MEDIA_STORAGE_POLICY,
  mergeMediaStoragePolicy,
} from '@/src/core/media/storagePolicy';

describe('media storage policy', () => {
  it('uses compact-only storage for new installations', () => {
    expect(mergeMediaStoragePolicy(undefined)).toEqual(DEFAULT_MEDIA_STORAGE_POLICY);
    expect(DEFAULT_MEDIA_STORAGE_POLICY).toEqual({ image: 'webp', video: 'preview-only' });
  });

  it('can preserve original-media behavior for legacy stored settings', () => {
    expect(mergeMediaStoragePolicy(undefined, LEGACY_MEDIA_STORAGE_POLICY)).toEqual({
      image: 'original',
      video: 'original',
    });
  });

  it('accepts compact image and video modes', () => {
    expect(mergeMediaStoragePolicy({ image: 'webp', video: 'preview-only' })).toEqual({
      image: 'webp',
      video: 'preview-only',
    });
  });

  it('rejects unknown persisted values', () => {
    expect(mergeMediaStoragePolicy({ image: 'other', video: 'delete' } as never)).toEqual(DEFAULT_MEDIA_STORAGE_POLICY);
  });
});
