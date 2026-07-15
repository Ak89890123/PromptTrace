export type ImageStorageMode = 'webp';
export type VideoStorageMode = 'preview-only';

export type MediaStoragePolicy = {
  image: ImageStorageMode;
  video: VideoStorageMode;
};

export const DEFAULT_MEDIA_STORAGE_POLICY: MediaStoragePolicy = {
  image: 'webp',
  video: 'preview-only',
};
