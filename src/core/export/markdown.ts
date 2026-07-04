import type { Asset, FileRecord, LibraryRecord, Tag } from '../domain/entities';
import type { AssetRole } from '../domain/enums';

export type ExportContext = {
  record: LibraryRecord;
  assets: Asset[];
  fileRecords: FileRecord[];
  tags: Tag[];
  categoryPath: string; // resolved display path or 'Uncategorized'
  includeSource?: boolean;
  includeFilePath?: boolean;
};

function sortedByOrder(assets: Asset[]): Asset[] {
  return [...assets].sort((a, b) => a.orderIndex - b.orderIndex);
}

function textsForRole(assets: Asset[], role: AssetRole): string {
  const texts = sortedByOrder(assets)
    .filter((a) => a.role === role && a.assetType === 'text' && a.textContent)
    .map((a) => a.textContent!.trim());
  return texts.length > 0 ? texts.join('\n\n') : '_None_';
}

function assetLine(asset: Asset, files: FileRecord[], includeFilePath: boolean): string {
  const file = files.find((f) => f.assetId === asset.id);
  const bits = [`- [${asset.assetType}/${asset.role}]`];
  if (asset.assetType === 'text') {
    const preview = (asset.textContent ?? '').slice(0, 80).replace(/\n/g, ' ');
    bits.push(preview + ((asset.textContent ?? '').length > 80 ? '…' : ''));
  } else {
    bits.push(asset.originalUrl ?? '(no url)');
    if (file) {
      bits.push(`(download: ${file.downloadStatus}${includeFilePath && file.localPath ? `, ${file.localPath}` : ''})`);
    }
  }
  return bits.join(' ');
}

export function exportMarkdown(ctx: ExportContext): string {
  const { record, assets, fileRecords, tags } = ctx;
  const includeSource = ctx.includeSource ?? true;
  const includeFilePath = ctx.includeFilePath ?? true;

  const title = record.title?.trim() || `PrompTrace Record ${record.id.slice(0, 8)}`;
  const assetLines = sortedByOrder(assets).map((a) => assetLine(a, fileRecords, includeFilePath));
  const sourceBlock = includeSource
    ? [record.sourcePageTitle, record.sourcePageUrl].filter(Boolean).join('\n') || '_None_'
    : '_Omitted_';
  const tagLine = tags.length > 0 ? tags.map((t) => `#${t.name}`).join(' ') : '';

  return [
    `# ${title}`,
    tagLine,
    '',
    '## Category',
    ctx.categoryPath || 'Uncategorized',
    '',
    '## Input',
    textsForRole(assets, 'input'),
    '',
    '## Input Reference',
    textsForRole(assets, 'input_reference'),
    '',
    '## Negative',
    textsForRole(assets, 'negative'),
    '',
    '## Output',
    textsForRole(assets, 'output'),
    '',
    '## Assets',
    assetLines.length > 0 ? assetLines.join('\n') : '_None_',
    '',
    '## Source',
    sourceBlock,
    '',
    '## Notes',
    record.notes?.trim() || '_None_',
    '',
  ]
    .filter((line, i) => !(i === 1 && line === '')) // drop empty tag line
    .join('\n');
}
