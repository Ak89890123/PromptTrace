import { describe, expect, it } from 'vitest';
import type { Asset, FileRecord, LibraryRecord } from '@/src/core/domain/entities';
import {
  composeFullRecord,
  composeInputBundle,
  composeOutputBundle,
} from '@/src/core/copy-bundle/compose';

const record: LibraryRecord = {
  id: 'r1',
  title: 'Rec',
  notes: 'n',
  sourcePageUrl: 'https://src.test',
  createdAt: '',
  updatedAt: '',
};

const assets: Asset[] = [
  { id: 'a1', recordId: 'r1', assetType: 'text', role: 'input', textContent: 'the prompt', orderIndex: 0, capturedAt: '' },
  { id: 'a2', recordId: 'r1', assetType: 'text', role: 'input_reference', textContent: 'ref text', orderIndex: 1, capturedAt: '' },
  { id: 'a3', recordId: 'r1', assetType: 'text', role: 'negative', textContent: 'bad stuff', orderIndex: 2, capturedAt: '' },
  { id: 'a4', recordId: 'r1', assetType: 'text', role: 'output', textContent: 'the answer', orderIndex: 3, capturedAt: '' },
  { id: 'a5', recordId: 'r1', assetType: 'image', role: 'input', originalUrl: 'https://x.test/in.png', orderIndex: 4, capturedAt: '' },
  { id: 'a6', recordId: 'r1', assetType: 'video', role: 'output', originalUrl: 'https://x.test/out.mp4', orderIndex: 5, capturedAt: '' },
];

const files: FileRecord[] = [
  { id: 'f1', assetId: 'a5', filename: 'in.png', localPath: 'D/PrompTrace/r1/in.png', downloadStatus: 'completed', deleteStatus: 'not_deleted', updatedAt: '' },
];

describe('copy bundles', () => {
  it('input bundle includes input + reference text and media refs, flags tray fallback', () => {
    const b = composeInputBundle(assets, files);
    expect(b.text).toContain('the prompt');
    expect(b.text).toContain('ref text');
    expect(b.text).toContain('D/PrompTrace/r1/in.png'); // local path preferred
    expect(b.text).not.toContain('the answer');
    expect(b.text).not.toContain('bad stuff');
    expect(b.mediaAssets.map((m) => m.id)).toEqual(['a5']);
    expect(b.needsTrayFallback).toBe(true);
  });

  it('output bundle includes output text and media link', () => {
    const b = composeOutputBundle(assets, files);
    expect(b.text).toContain('the answer');
    expect(b.text).toContain('https://x.test/out.mp4'); // no local file → source url
    expect(b.text).not.toContain('the prompt');
    expect(b.mediaAssets.map((m) => m.id)).toEqual(['a6']);
  });

  it('text-only bundle does not need tray fallback', () => {
    const textOnly = assets.filter((a) => a.assetType === 'text');
    expect(composeInputBundle(textOnly, []).needsTrayFallback).toBe(false);
  });

  it('full record includes category, all roles, source, notes', () => {
    const b = composeFullRecord(record, assets, files, '生文');
    expect(b.text).toContain('Category: 生文');
    expect(b.text).not.toContain('Model:');
    expect(b.text).toContain('the prompt');
    expect(b.text).toContain('ref text');
    expect(b.text).toContain('bad stuff');
    expect(b.text).toContain('the answer');
    expect(b.text).toContain('Source: https://src.test');
    expect(b.text).toContain('Notes: n');
    expect(b.needsTrayFallback).toBe(true);
  });
});
