import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { ExtensionMessage, GenerateVideoPreviewResult } from '@/src/core/messages';
import { bytesToDataUrl, validateCanonicalPreviewRef } from '@/src/core/media/dataUrl';
import { mediaQualityProfileFor, type GifQualityProfile, type MediaQuality } from '@/src/core/media/quality';
import { previewFrameTimes, scaledPreviewDimensions } from '@/src/core/media/videoPreview';

const LOAD_TIMEOUT_MS = 20_000;

function waitForEvent(target: EventTarget, event: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${event}_timeout`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${event}_failed`));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

async function seek(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const done = waitForEvent(video, 'seeked');
  video.currentTime = time;
  await done;
}

function dimensions(video: HTMLVideoElement, maxDimension: number): { width: number; height: number } {
  return scaledPreviewDimensions(video.videoWidth, video.videoHeight, maxDimension);
}

async function encodeGif(video: HTMLVideoElement, profile: GifQualityProfile): Promise<Uint8Array> {
  const { width, height } = dimensions(video, profile.maxDimension);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('canvas_unavailable');

  const frameTimes = previewFrameTimes(video.duration, profile.fps);
  const gif = GIFEncoder();

  for (const frameTime of frameTimes) {
    await seek(video, frameTime);
    context.drawImage(video, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const palette = quantize(rgba, profile.colors, { format: 'rgb444' });
    const indexed = applyPalette(rgba, palette, 'rgb444');
    gif.writeFrame(indexed, width, height, {
      palette,
      delay: Math.round(1000 / profile.fps),
      repeat: 0,
    });
  }

  gif.finish();
  return gif.bytes();
}

async function encodeStill(
  video: HTMLVideoElement,
  profile: { maxDimension: number; quality: number },
): Promise<string> {
  const { width, height } = dimensions(video, profile.maxDimension);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('canvas_unavailable');
  await seek(video, 0);
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', profile.quality));
  if (!blob) throw new Error('still_encode_failed');
  return bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), 'image/webp');
}

async function generateVideoPreview(url: string, quality?: MediaQuality): Promise<GenerateVideoPreviewResult> {
  let objectUrl: string | undefined;
  try {
    const profile = mediaQualityProfileFor(quality).video;
    const response = await fetch(url);
    if (!response.ok) return { ok: false, reason: `fetch_${response.status}` };
    objectUrl = URL.createObjectURL(await response.blob());
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = objectUrl;
    await waitForEvent(video, 'loadedmetadata');
    if (!video.videoWidth || !video.videoHeight) return { ok: false, reason: 'no_video_dimensions' };

    for (const gifProfile of [profile.primary, profile.fallback]) {
      const bytes = await encodeGif(video, gifProfile);
      if (bytes.byteLength <= profile.maxBytes) {
        const previewRef = bytesToDataUrl(bytes, 'image/gif');
        validateCanonicalPreviewRef(previewRef, 'video');
        return { ok: true, previewRef, kind: 'gif' };
      }
    }

    const previewRef = await encodeStill(video, profile.still);
    validateCanonicalPreviewRef(previewRef, 'video');
    return { ok: true, previewRef, kind: 'still' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type !== 'media/generateVideoPreview') return;
  queue = queue
    .then(async () => sendResponse(await generateVideoPreview(message.payload.url, message.payload.quality)))
    .catch((error) => sendResponse({ ok: false, reason: String(error) } satisfies GenerateVideoPreviewResult));
  return true;
});
