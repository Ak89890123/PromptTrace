import { describe, expect, it } from 'vitest';
import type { Asset, FileRecord, LibraryRecord, Tag } from '@/src/core/domain/entities';
import { exportMarkdown, modelLabelOf, type ExportContext } from '@/src/core/export/markdown';
import { exportJson } from '@/src/core/export/json';

const record: LibraryRecord = {
  id: 'rec-1234567890',
  categoryId: 'cat-1',
  modelPresetId: null,
  modelLabel: undefined,
  modelProvider: 'Anthropic',
  modelName: 'Claude',
  title: 'My capture',
  notes: 'some notes',
  sourcePageUrl: 'https://chat.example/page',
  sourcePageTitle: 'Chat page',
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
};

const assets: Asset[] = [
  {
    id: 'a1',
    recordId: record.id,
    assetType: 'text',
    role: 'input',
    textContent: 'write a poem',
    orderIndex: 0,
    capturedAt: '',
  },
  {
    id: 'a2',
    recordId: record.id,
    assetType: 'text',
    role: 'output',
    textContent: 'roses are red',
    orderIndex: 1,
    capturedAt: '',
  },
  {
    id: 'a3',
    recordId: record.id,
    assetType: 'image',
    role: 'output',
    originalUrl: 'https://x.test/img.png',
    orderIndex: 2,
    capturedAt: '',
  },
];

const fileRecords: FileRecord[] = [
  {
    id: 'f1',
    assetId: 'a3',
    filename: 'a3-img.png',
    localPath: 'C:/Downloads/PromptTrace/rec/img.png',
    downloadStatus: 'completed',
    deleteStatus: 'not_deleted',
    updatedAt: '',
  },
];

const tags: Tag[] = [{ id: 't1', recordId: record.id, name: 'poetry' }];

const ctx: ExportContext = {
  record,
  assets,
  fileRecords,
  tags,
  categoryPath: '生文 / 改寫',
};

describe('markdown export', () => {
  it('renders all sections with content', () => {
    const md = exportMarkdown(ctx);
    expect(md).toContain('# My capture');
    expect(md).toContain('## Category\n生文 / 改寫');
    expect(md).toContain('## Model\nAnthropic Claude');
    expect(md).toContain('## Input\nwrite a poem');
    expect(md).toContain('## Output\nroses are red');
    expect(md).toContain('#poetry');
    expect(md).toContain('https://chat.example/page');
    expect(md).toContain('## Notes\nsome notes');
    expect(md).toContain('img.png');
  });

  it('falls back to Uncategorized / Not specified', () => {
    const md = exportMarkdown({
      ...ctx,
      categoryPath: 'Uncategorized',
      record: { ...record, modelProvider: undefined, modelName: undefined, title: undefined, notes: undefined },
    });
    expect(md).toContain('## Category\nUncategorized');
    expect(md).toContain('## Model\nNot specified');
    expect(md).toContain('## Notes\n_None_');
  });

  it('can omit source and file paths', () => {
    const md = exportMarkdown({ ...ctx, includeSource: false, includeFilePath: false });
    expect(md).not.toContain('https://chat.example/page');
    expect(md).not.toContain('C:/Downloads');
  });

  it('modelLabelOf prefers explicit label', () => {
    expect(modelLabelOf({ ...record, modelLabel: 'Unknown' })).toBe('Unknown');
    expect(modelLabelOf({ ...record, modelProvider: undefined, modelName: undefined })).toBe(
      'Not specified',
    );
  });
});

describe('json export', () => {
  it('includes record, category path, model, assets, files, tags, source, notes', () => {
    const json = exportJson(ctx);
    expect(json.exportVersion).toBe(1);
    expect(json.record.id).toBe(record.id);
    expect(json.categoryPath).toBe('生文 / 改寫');
    expect(json.model.label).toBe('Anthropic Claude');
    expect(json.assets).toHaveLength(3);
    expect(json.fileRecords).toHaveLength(1);
    expect(json.tags).toEqual(['poetry']);
    expect(json.source?.url).toBe('https://chat.example/page');
    expect(json.notes).toBe('some notes');
  });

  it('strips localPath when includeFilePath is false', () => {
    const json = exportJson({ ...ctx, includeFilePath: false });
    expect(json.fileRecords[0].localPath).toBeUndefined();
  });

  it('nulls source when includeSource is false', () => {
    expect(exportJson({ ...ctx, includeSource: false }).source).toBeNull();
  });
});
