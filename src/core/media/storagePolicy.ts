export type ImageStorageMode = 'original' | 'webp';
export type VideoStorageMode = 'original' | 'preview-only';

export type MediaStoragePolicy = {
  image: ImageStorageMode;
  video: VideoStorageMode;
};

export const DEFAULT_MEDIA_STORAGE_POLICY: MediaStoragePolicy = {
  image: 'webp',
  video: 'preview-only',
};

/** Upgrade fallback for settings written before media-storage choices existed. */
export const LEGACY_MEDIA_STORAGE_POLICY: MediaStoragePolicy = {
  image: 'original',
  video: 'original',
};

export function mergeMediaStoragePolicy(
  stored: Partial<MediaStoragePolicy> | undefined,
  fallback: MediaStoragePolicy = DEFAULT_MEDIA_STORAGE_POLICY,
): MediaStoragePolicy {
  return {
    image: stored?.image === 'webp' || stored?.image === 'original' ? stored.image : fallback.image,
    video:
      stored?.video === 'preview-only' || stored?.video === 'original'
        ? stored.video
        : fallback.video,
  };
}
