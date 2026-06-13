import { describe, expect, it } from 'vitest';
import {
  addAsset,
  addConflict,
  addError,
  assignRole,
  canCommit,
  dismissError,
  emptySession,
  removeAsset,
  resolveConflict,
  unassignedAssets,
} from '@/src/core/capture/session';
import type { PendingAsset } from '@/src/core/domain/entities';
import { createConflict } from '@/src/core/errors/conflictTypes';
import { createCaptureError } from '@/src/core/errors/errorTypes';

const asset = (id: string): PendingAsset => ({
  id,
  assetType: 'text',
  role: null,
  textContent: 'x',
  pageUrl: 'https://x.test',
  pageTitle: 't',
  capturedAt: '',
});

describe('capture session state', () => {
  it('add / assign / remove flow', () => {
    let s = emptySession();
    s = addAsset(s, asset('a'));
    s = addAsset(s, asset('b'));
    expect(unassignedAssets(s)).toHaveLength(2);
    expect(canCommit(s)).toBe(false);

    s = assignRole(s, 'a', 'input');
    s = assignRole(s, 'b', 'output');
    expect(canCommit(s)).toBe(true);

    s = removeAsset(s, 'a');
    expect(s.assets.map((a) => a.id)).toEqual(['b']);
  });

  it('empty session cannot commit', () => {
    expect(canCommit(emptySession())).toBe(false);
  });

  it('conflict and error lists are independent', () => {
    let s = emptySession();
    s = addConflict(s, createConflict('DUPLICATE_SELECTION'));
    s = addError(s, createCaptureError('STORAGE_WRITE_FAILED', 'test'));
    expect(s.conflicts).toHaveLength(1);
    expect(s.errors).toHaveLength(1);
    s = resolveConflict(s, s.conflicts[0].id);
    expect(s.conflicts).toHaveLength(0);
    expect(s.errors).toHaveLength(1);
    s = dismissError(s, s.errors[0].id);
    expect(s.errors).toHaveLength(0);
  });
});
