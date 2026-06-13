import type { ExportContext } from './markdown';
import { modelLabelOf } from './markdown';

export type JsonExport = {
  exportVersion: 1;
  exportedAt: string;
  record: ExportContext['record'];
  categoryPath: string;
  model: {
    presetId?: string | null;
    provider?: string;
    name?: string;
    version?: string;
    label: string;
  };
  assets: ExportContext['assets'];
  fileRecords: ExportContext['fileRecords'];
  tags: string[];
  source: { url?: string; title?: string } | null;
  notes: string | null;
};

export function exportJson(ctx: ExportContext): JsonExport {
  const { record } = ctx;
  const includeSource = ctx.includeSource ?? true;
  const fileRecords = (ctx.includeFilePath ?? true)
    ? ctx.fileRecords
    : ctx.fileRecords.map((f) => ({ ...f, localPath: undefined }));
  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    record,
    categoryPath: ctx.categoryPath || 'Uncategorized',
    model: {
      presetId: record.modelPresetId ?? null,
      provider: record.modelProvider,
      name: record.modelName,
      version: record.modelVersion,
      label: modelLabelOf(record),
    },
    assets: ctx.assets,
    fileRecords,
    tags: ctx.tags.map((t) => t.name),
    source: includeSource
      ? { url: record.sourcePageUrl, title: record.sourcePageTitle }
      : null,
    notes: record.notes ?? null,
  };
}

export function exportJsonString(ctx: ExportContext): string {
  return JSON.stringify(exportJson(ctx), null, 2);
}
