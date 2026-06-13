import type { Asset, FileRecord, LibraryRecord } from '../domain/entities';
import type { AssetRole } from '../domain/enums';
import { modelLabelOf } from '../export/markdown';

export type CopyBundle = {
  /** Plain text payload that goes to the clipboard. */
  text: string;
  /** Media assets that cannot be inlined; surfaced in the Floating Copy Tray. */
  mediaAssets: Asset[];
  /** True when media exists, so the UI should show the tray fallback hint. */
  needsTrayFallback: boolean;
};

function sorted(assets: Asset[]): Asset[] {
  return [...assets].sort((a, b) => a.orderIndex - b.orderIndex);
}

function sectionFor(assets: Asset[], roles: AssetRole[], files: FileRecord[]): {
  lines: string[];
  media: Asset[];
} {
  const lines: string[] = [];
  const media: Asset[] = [];
  for (const role of roles) {
    const roleAssets = sorted(assets).filter((a) => a.role === role);
    for (const a of roleAssets) {
      if (a.assetType === 'text' && a.textContent) {
        lines.push(a.textContent.trim());
      } else if (a.assetType !== 'text') {
        media.push(a);
        const file = files.find((f) => f.assetId === a.id);
        const ref = file?.localPath ?? a.originalUrl ?? '(local file)';
        lines.push(`[${a.assetType}] ${ref}`);
      }
    }
  }
  return { lines, media };
}

export function composeInputBundle(assets: Asset[], files: FileRecord[]): CopyBundle {
  const { lines, media } = sectionFor(assets, ['input', 'input_reference'], files);
  return {
    text: lines.join('\n\n'),
    mediaAssets: media,
    needsTrayFallback: media.length > 0,
  };
}

export function composeOutputBundle(assets: Asset[], files: FileRecord[]): CopyBundle {
  const { lines, media } = sectionFor(assets, ['output'], files);
  return {
    text: lines.join('\n\n'),
    mediaAssets: media,
    needsTrayFallback: media.length > 0,
  };
}

export function composeFullRecord(
  record: LibraryRecord,
  assets: Asset[],
  files: FileRecord[],
  categoryPath: string,
): CopyBundle {
  const roleBlock = (label: string, roles: AssetRole[]) => {
    const { lines } = sectionFor(assets, roles, files);
    return lines.length > 0 ? `## ${label}\n${lines.join('\n\n')}` : `## ${label}\n_None_`;
  };
  const media = sorted(assets).filter((a) => a.assetType !== 'text');
  const text = [
    `# ${record.title ?? 'PromptTrace Record'}`,
    `Category: ${categoryPath || 'Uncategorized'}`,
    `Model: ${modelLabelOf(record)}`,
    '',
    roleBlock('Input', ['input']),
    '',
    roleBlock('Input Reference', ['input_reference']),
    '',
    roleBlock('Negative', ['negative']),
    '',
    roleBlock('Output', ['output']),
    '',
    `Source: ${record.sourcePageUrl ?? 'None'}`,
    record.notes ? `Notes: ${record.notes}` : '',
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .trim();
  return { text, mediaAssets: media, needsTrayFallback: media.length > 0 };
}
