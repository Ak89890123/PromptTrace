import { DEFAULT_MEDIA_STORAGE_POLICY } from '@/src/core/media/storagePolicy';

describe('media storage policy', () => {
  it('uses compact-only storage', () => {
    expect(DEFAULT_MEDIA_STORAGE_POLICY).toEqual({ image: 'webp', video: 'preview-only' });
  });

  it('does not expose original-media modes', () => {
    expect(Object.values(DEFAULT_MEDIA_STORAGE_POLICY)).not.toContain('original');
  });
});
