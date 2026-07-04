import type { ExportContext } from './markdown';

export type JsonExport = {
  exportVersion: 1;
  exportedAt: string;
  record: ExportContext['record'];
  categoryPath: string;
  assets: ExportContext['assets'];
  fileRecords: ExportContext['fileRecords'];
  tags: string[];
  source: { url?: string; title?: string } | null;
  notes: string | null;
};

export function exportJson(ctx: ExportContext): JsonExport {
  const includeSource = ctx.includeSource ?? true;
  const fileRecords = (ctx.includeFilePath ?? true)
    ? ctx.fileRecords
    : ctx.fileRecords.map((f) => ({ ...f, localPath: undefined }));
  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    record: ctx.record,
    categoryPath: ctx.categoryPath || 'Uncategorized',
    assets: ctx.assets,
    fileRecords,
    tags: ctx.tags.map((t) => t.name),
    source: includeSource
      ? { url: ctx.record.sourcePageUrl, title: ctx.record.sourcePageTitle }
      : null,
    notes: ctx.record.notes ?? null,
  };
}

export function exportJsonString(ctx: ExportContext): string {
  return JSON.stringify(exportJson(ctx), null, 2);
}
