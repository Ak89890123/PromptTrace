export type MediaQuality = 'low' | 'medium' | 'high';

export type GifQualityProfile = {
  maxDimension: number;
  fps: number;
  colors: number;
};

export type MediaQualityProfile = {
  image: { maxDimension: number; quality: number };
  video: {
    primary: GifQualityProfile;
    fallback: GifQualityProfile;
    maxBytes: number;
    still: { maxDimension: number; quality: number };
  };
};

export const DEFAULT_MEDIA_QUALITY: MediaQuality = 'medium';

/**
 * Each preset controls only the canonical preview persisted in IndexedDB.
 * Original image/video files are never downloaded or stored by this policy.
 */
export const MEDIA_QUALITY_PROFILES: Record<MediaQuality, MediaQualityProfile> = {
  low: {
    image: { maxDimension: 768, quality: 0.82 },
    video: {
      primary: { maxDimension: 320, fps: 8, colors: 128 },
      fallback: { maxDimension: 240, fps: 6, colors: 96 },
      maxBytes: 3 * 1024 * 1024,
      still: { maxDimension: 320, quality: 0.78 },
    },
  },
  medium: {
    image: { maxDimension: 1280, quality: 0.9 },
    video: {
      primary: { maxDimension: 480, fps: 10, colors: 192 },
      fallback: { maxDimension: 360, fps: 8, colors: 128 },
      maxBytes: 6 * 1024 * 1024,
      still: { maxDimension: 480, quality: 0.86 },
    },
  },
  high: {
    image: { maxDimension: 1920, quality: 0.95 },
    video: {
      primary: { maxDimension: 640, fps: 12, colors: 256 },
      fallback: { maxDimension: 480, fps: 10, colors: 192 },
      maxBytes: 10 * 1024 * 1024,
      still: { maxDimension: 640, quality: 0.9 },
    },
  },
};

export function normalizeMediaQuality(value: unknown): MediaQuality {
  return value === 'low' || value === 'medium' || value === 'high' ? value : DEFAULT_MEDIA_QUALITY;
}

export function mediaQualityProfileFor(value: unknown): MediaQualityProfile {
  return MEDIA_QUALITY_PROFILES[normalizeMediaQuality(value)];
}
