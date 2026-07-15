import { describe, expect, it } from 'vitest';
import {
  IMAGE_INPUT_MAX_BYTES,
  bytesToDataUrl,
  parseDataUrl,
  validateCanonicalPreviewRef,
} from '@/src/core/media/dataUrl';

describe('media Data URL validation', () => {
  it('accepts allowlisted base64 input and returns decoded bytes', () => {
    const parsed = parseDataUrl('data:image/png;base64,AAEC', 'image');
    expect(parsed.mimeType).toBe('image/png');
    expect([...parsed.bytes]).toEqual([0, 1, 2]);
  });

  it('accepts percent-encoded input and rejects mismatched MIME types', () => {
    expect([...parseDataUrl('data:image/png,%FF%00%01', 'image').bytes]).toEqual([255, 0, 1]);
    expect(() => parseDataUrl('data:application/octet-stream;base64,AA==', 'image')).toThrow('MIME_NOT_ALLOWED');
  });

  it('enforces decoded input size and canonical preview MIME', () => {
    const oversized = bytesToDataUrl(new Uint8Array(IMAGE_INPUT_MAX_BYTES + 1), 'image/png');
    expect(() => parseDataUrl(oversized, 'image')).toThrow('TOO_LARGE');
    expect(() => validateCanonicalPreviewRef('data:image/png;base64,AA==', 'image')).toThrow('NOT_CANONICAL');
    expect(() => validateCanonicalPreviewRef('data:image/webp;base64,AA==', 'image')).not.toThrow();
  });
});
