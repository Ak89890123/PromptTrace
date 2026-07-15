const KIB = 1024;
const MIB = 1024 * KIB;

type MediaAssetStorageInput = {
  assetType: 'text' | 'image' | 'video';
  previewRef?: string;
};

/**
 * Returns the UTF-8 byte size of the Data URL string stored in Asset.previewRef.
 * This is the useful IndexedDB payload estimate for the current schema, which
 * stores canonical previews as strings rather than Blob values.
 */
export function indexedDbPreviewStorageBytes(value: string | undefined): number | undefined {
  if (!value || !/^data:/i.test(value)) return undefined;
  return new TextEncoder().encode(value).byteLength;
}

export function formatIndexedDbSize(bytes: number): string {
  const safeBytes = Math.max(0, Math.round(bytes));
  const mib = Math.floor(safeBytes / MIB);
  const kib = Math.floor((safeBytes % MIB) / KIB);
  return mib === 0
    ? `${kib} KB`
    : kib === 0
      ? `${mib} MB`
      : `${mib} MB + ${kib} KB`;
}

export function formatMediaAssetTotalSize(bytes: number): string {
  const safeBytes = Math.max(0, Math.round(bytes));
  if (safeBytes < MIB) return `${Math.floor(safeBytes / KIB)} KB`;
  const value = (safeBytes / MIB).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return `${value} MB`;
}

export function summarizeMediaAssetStorage(
  assets: MediaAssetStorageInput[],
): { assetCount: number; totalBytes: number } {
  let assetCount = 0;
  let totalBytes = 0;
  for (const asset of assets) {
    if (asset.assetType === 'text') continue;
    assetCount += 1;
    totalBytes += indexedDbPreviewStorageBytes(asset.previewRef) ?? 0;
  }
  return { assetCount, totalBytes };
}
