import {
  VIDEO_PREVIEW_SECONDS,
  previewFrameTimes,
  scaledPreviewDimensions,
} from '@/src/core/media/videoPreview';

describe('video preview profiles', () => {
  it('caps landscape video at the requested dimension and keeps even sizes', () => {
    expect(scaledPreviewDimensions(1920, 1080, 320)).toEqual({ width: 320, height: 180 });
  });

  it('does not upscale small videos', () => {
    expect(scaledPreviewDimensions(160, 90, 320)).toEqual({ width: 160, height: 90 });
  });

  it('samples no more than the first three seconds', () => {
    const times = previewFrameTimes(20, 8);
    expect(times).toHaveLength(VIDEO_PREVIEW_SECONDS * 8);
    expect(times[0]).toBe(0);
    expect(Math.max(...times)).toBeLessThan(VIDEO_PREVIEW_SECONDS);
  });

  it('keeps short-video samples before the media endpoint', () => {
    const times = previewFrameTimes(0.5, 8);
    expect(times).toHaveLength(4);
    expect(Math.max(...times)).toBeLessThanOrEqual(0.46);
  });
});
