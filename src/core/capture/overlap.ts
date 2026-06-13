import type { PendingAsset } from '../domain/entities';

export type SelectionCheck =
  | { kind: 'ok' }
  | { kind: 'duplicate'; existingId: string }
  | { kind: 'overlap'; existingId: string };

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Check a new candidate selection against existing pending assets.
 * - Media: duplicate when the same originalUrl is already pending.
 * - Text: duplicate when normalized text is identical; overlap when one
 *   normalized text contains the other (containment in either direction or
 *   the DOM ranges were reported as intersecting by the content script).
 */
export function checkSelection(
  existing: PendingAsset[],
  candidate: { assetType: PendingAsset['assetType']; textContent?: string; originalUrl?: string },
  domOverlapWith?: string | null,
): SelectionCheck {
  if (candidate.assetType !== 'text') {
    const dup = existing.find(
      (a) => a.assetType === candidate.assetType && a.originalUrl && a.originalUrl === candidate.originalUrl,
    );
    return dup ? { kind: 'duplicate', existingId: dup.id } : { kind: 'ok' };
  }

  const newText = normalizeText(candidate.textContent ?? '');
  if (newText.length === 0) return { kind: 'ok' };

  for (const a of existing) {
    if (a.assetType !== 'text' || !a.textContent) continue;
    const oldText = normalizeText(a.textContent);
    if (oldText === newText) return { kind: 'duplicate', existingId: a.id };
    if (oldText.includes(newText) || newText.includes(oldText)) {
      return { kind: 'overlap', existingId: a.id };
    }
  }

  if (domOverlapWith) {
    const hit = existing.find((a) => a.id === domOverlapWith);
    if (hit) return { kind: 'overlap', existingId: hit.id };
  }

  return { kind: 'ok' };
}
