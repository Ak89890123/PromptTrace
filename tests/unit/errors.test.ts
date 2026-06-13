import { describe, expect, it } from 'vitest';
import { createCaptureError, ERROR_INFO, mapDownloadError } from '@/src/core/errors/errorTypes';
import { createConflict, CONFLICT_SUGGESTIONS } from '@/src/core/errors/conflictTypes';

describe('error mapping', () => {
  it('maps chrome download interrupt reasons', () => {
    expect(mapDownloadError('NETWORK_FAILED')).toBe('DOWNLOAD_INTERRUPTED');
    expect(mapDownloadError('USER_CANCELED')).toBe('DOWNLOAD_INTERRUPTED');
    expect(mapDownloadError('SERVER_FORBIDDEN')).toBe('DOWNLOAD_PERMISSION_DENIED');
    expect(mapDownloadError('SERVER_UNAUTHORIZED')).toBe('DOWNLOAD_PERMISSION_DENIED');
    expect(mapDownloadError('SOMETHING_ELSE')).toBe('MEDIA_DOWNLOAD_FAILED');
    expect(mapDownloadError(undefined)).toBe('MEDIA_DOWNLOAD_FAILED');
  });

  it('every error type has user-facing info', () => {
    for (const info of Object.values(ERROR_INFO)) {
      expect(info.message.length).toBeGreaterThan(0);
      expect(info.probableCause.length).toBeGreaterThan(0);
      expect(info.suggestedAction.length).toBeGreaterThan(0);
    }
  });

  it('createCaptureError fills card fields', () => {
    const e = createCaptureError('MEDIA_URL_NOT_FOUND', 'background/contextMenu', {
      sourceUrl: 'https://x.test',
      canSaveSourceOnly: true,
      canRetry: false,
    });
    expect(e.errorType).toBe('MEDIA_URL_NOT_FOUND');
    expect(e.location).toBe('background/contextMenu');
    expect(e.canSaveSourceOnly).toBe(true);
    expect(e.canRetry).toBe(false);
    expect(e.message).toBe(ERROR_INFO.MEDIA_URL_NOT_FOUND.message);
  });
});

describe('conflict mapping', () => {
  it('conflicts carry a suggestion and are distinct from errors', () => {
    const c = createConflict('OVERLAPPING_SELECTION', {
      existingAssetId: 'a',
      existingPreview: 'old',
      newPreview: 'new',
    });
    expect(c.suggestion).toBe(CONFLICT_SUGGESTIONS.OVERLAPPING_SELECTION);
    expect(c.existingAssetId).toBe('a');
    expect(Object.keys(c)).not.toContain('errorType');
  });

  it('role-not-allowed suggestion explains the rule', () => {
    expect(CONFLICT_SUGGESTIONS.ROLE_NOT_ALLOWED_FOR_ASSET_TYPE).toContain('Negative');
  });
});
