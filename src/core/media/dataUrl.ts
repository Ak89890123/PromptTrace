import type { AssetType } from '../domain/enums';

export const IMAGE_INPUT_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_INPUT_MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** Global canonical ceiling; individual quality presets enforce smaller limits. */
export const VIDEO_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_INPUT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const VIDEO_INPUT_MIME_TYPES = new Set(['video/mp4', 'video/webm']);

function decodePercentEncodedBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length;) {
    if (value[index] === '%') {
      const hex = value.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error('invalid_percent_escape');
      bytes.push(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    const codePoint = value.codePointAt(index);
    if (codePoint == null) break;
    const character = String.fromCodePoint(codePoint);
    bytes.push(...new TextEncoder().encode(character));
    index += character.length;
  }
  return Uint8Array.from(bytes);
}

export type ParsedDataUrl = {
  mimeType: string;
  bytes: Uint8Array;
  isBase64: boolean;
};

export function isDataUrl(value: string | undefined): value is string {
  return typeof value === 'string' && /^data:/i.test(value);
}

export function parseDataUrl(value: string, assetType?: Exclude<AssetType, 'text'>): ParsedDataUrl {
  const match = /^data:([^;,\s]+)(;base64)?,([\s\S]*)$/i.exec(value);
  if (!match) throw new Error('MEDIA_DATA_URL_MALFORMED');

  const mimeType = match[1].toLowerCase();
  const allowed = assetType === 'image'
    ? IMAGE_INPUT_MIME_TYPES
    : assetType === 'video'
      ? VIDEO_INPUT_MIME_TYPES
      : new Set([...IMAGE_INPUT_MIME_TYPES, ...VIDEO_INPUT_MIME_TYPES]);
  if (!allowed.has(mimeType)) throw new Error('MEDIA_DATA_URL_MIME_NOT_ALLOWED');

  const encoded = match[3];
  const isBase64 = Boolean(match[2]);
  let bytes: Uint8Array;
  try {
    if (isBase64) {
      if (encoded.length % 4 === 1 || /[^A-Za-z0-9+/=\s]/.test(encoded)) {
        throw new Error('invalid_base64');
      }
      const binary = atob(encoded.replace(/\s/g, ''));
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } else {
      bytes = decodePercentEncodedBytes(encoded);
    }
  } catch {
    throw new Error('MEDIA_DATA_URL_INVALID_BYTES');
  }

  const maxBytes = assetType === 'image' ? IMAGE_INPUT_MAX_BYTES : VIDEO_INPUT_MAX_BYTES;
  if (bytes.byteLength > maxBytes) throw new Error('MEDIA_DATA_URL_TOO_LARGE');
  return { mimeType, bytes, isBase64 };
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function dataUrlToBlob(value: string, assetType?: Exclude<AssetType, 'text'>): Blob {
  const parsed = parseDataUrl(value, assetType);
  return new Blob([parsed.bytes.slice().buffer as ArrayBuffer], { type: parsed.mimeType });
}

export function validateCanonicalPreviewRef(value: string, assetType: Exclude<AssetType, 'text'>): ParsedDataUrl {
  const parsed = parseDataUrl(value, assetType === 'image' ? 'image' : undefined);
  if (assetType === 'image' && parsed.mimeType !== 'image/webp') {
    throw new Error('MEDIA_PREVIEW_NOT_CANONICAL');
  }
  if (assetType === 'video' && parsed.mimeType !== 'image/gif' && parsed.mimeType !== 'image/webp') {
    throw new Error('MEDIA_PREVIEW_NOT_CANONICAL');
  }
  const maxBytes = assetType === 'image' ? IMAGE_PREVIEW_MAX_BYTES : VIDEO_PREVIEW_MAX_BYTES;
  if (parsed.bytes.byteLength > maxBytes) throw new Error('MEDIA_PREVIEW_TOO_LARGE');
  return parsed;
}
