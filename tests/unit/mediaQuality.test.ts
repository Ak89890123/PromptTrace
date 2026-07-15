import {
  DEFAULT_MEDIA_QUALITY,
  mediaQualityProfileFor,
  normalizeMediaQuality,
} from '@/src/core/media/quality';

describe('media quality presets', () => {
  it('defaults invalid or missing values to the balanced preset', () => {
    expect(DEFAULT_MEDIA_QUALITY).toBe('medium');
    expect(normalizeMediaQuality(undefined)).toBe('medium');
    expect(normalizeMediaQuality('original')).toBe('medium');
  });

  it('preserves all supported values', () => {
    expect(normalizeMediaQuality('low')).toBe('low');
    expect(normalizeMediaQuality('medium')).toBe('medium');
    expect(normalizeMediaQuality('high')).toBe('high');
  });

  it('increases image and video detail from low through high', () => {
    const low = mediaQualityProfileFor('low');
    const medium = mediaQualityProfileFor('medium');
    const high = mediaQualityProfileFor('high');

    expect(low.image.maxDimension).toBeLessThan(medium.image.maxDimension);
    expect(medium.image.maxDimension).toBeLessThan(high.image.maxDimension);
    expect(low.video.primary.maxDimension).toBeLessThan(medium.video.primary.maxDimension);
    expect(medium.video.primary.maxDimension).toBeLessThan(high.video.primary.maxDimension);
    expect(low.video.maxBytes).toBeLessThan(medium.video.maxBytes);
    expect(medium.video.maxBytes).toBeLessThan(high.video.maxBytes);
  });
});
