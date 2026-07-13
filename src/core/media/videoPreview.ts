export const VIDEO_PREVIEW_SECONDS = 3;
export const VIDEO_PREVIEW_MAX_BYTES = 3 * 1024 * 1024;

export function scaledPreviewDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxDimension <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(2, Math.round((sourceWidth * scale) / 2) * 2),
    height: Math.max(2, Math.round((sourceHeight * scale) / 2) * 2),
  };
}

export function previewFrameTimes(duration: number, fps: number): number[] {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : VIDEO_PREVIEW_SECONDS;
  const previewDuration = Math.min(VIDEO_PREVIEW_SECONDS, safeDuration);
  const frameCount = Math.max(1, Math.ceil(previewDuration * fps));
  const lastSafeTime = Math.max(0, safeDuration - 0.04);
  return Array.from({ length: frameCount }, (_, frame) => Math.min(frame / fps, lastSafeTime));
}
