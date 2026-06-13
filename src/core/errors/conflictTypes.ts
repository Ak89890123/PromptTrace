export type ConflictType =
  | 'DUPLICATE_SELECTION'
  | 'OVERLAPPING_SELECTION'
  | 'ROLE_NOT_ALLOWED_FOR_ASSET_TYPE';

export type CaptureConflict = {
  id: string;
  conflictType: ConflictType;
  /** Existing pending asset id involved in the conflict, if any. */
  existingAssetId?: string;
  existingPreview?: string;
  newPreview?: string;
  suggestion: string;
  /** Candidate payload kept aside until the user resolves the conflict. */
  candidate?: unknown;
  occurredAt: string;
};

export const CONFLICT_SUGGESTIONS: Record<ConflictType, string> = {
  DUPLICATE_SELECTION: '此內容已在本次 session 中，已為你標示原項目。',
  OVERLAPPING_SELECTION: '新選取與既有選取重疊。可用新範圍取代舊範圍，或取消新選取。',
  ROLE_NOT_ALLOWED_FOR_ASSET_TYPE: '圖片與影片不能作為 Negative，只能作為 Input 或 Output。',
};

export function createConflict(
  conflictType: ConflictType,
  extras: Partial<Omit<CaptureConflict, 'id' | 'conflictType' | 'suggestion' | 'occurredAt'>> = {},
): CaptureConflict {
  return {
    id: crypto.randomUUID(),
    conflictType,
    suggestion: CONFLICT_SUGGESTIONS[conflictType],
    occurredAt: new Date().toISOString(),
    ...extras,
  };
}
