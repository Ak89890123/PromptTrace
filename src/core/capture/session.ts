import type { PendingAsset } from '../domain/entities';
import type { CaptureConflict } from '../errors/conflictTypes';
import type { CaptureError } from '../errors/errorTypes';

/** Wizard step the in-page edge panel is currently showing. */
export type WizardStage = 'idle' | 'category' | 'model';

export type CaptureSessionState = {
  assets: PendingAsset[];
  conflicts: CaptureConflict[];
  errors: CaptureError[];
  wizardStage: WizardStage;
  /** Last committed record id, so the panel can link to the Library. */
  lastCommittedRecordId?: string;
};

export function emptySession(): CaptureSessionState {
  return { assets: [], conflicts: [], errors: [], wizardStage: 'idle' };
}

export function addAsset(state: CaptureSessionState, asset: PendingAsset): CaptureSessionState {
  return { ...state, assets: [...state.assets, asset] };
}

export function removeAsset(state: CaptureSessionState, assetId: string): CaptureSessionState {
  return { ...state, assets: state.assets.filter((a) => a.id !== assetId) };
}

export function assignRole(
  state: CaptureSessionState,
  assetId: string,
  role: PendingAsset['role'],
): CaptureSessionState {
  return {
    ...state,
    assets: state.assets.map((a) => (a.id === assetId ? { ...a, role } : a)),
  };
}

export function replaceAsset(
  state: CaptureSessionState,
  oldId: string,
  next: PendingAsset,
): CaptureSessionState {
  return { ...state, assets: state.assets.map((a) => (a.id === oldId ? next : a)) };
}

export function addConflict(state: CaptureSessionState, c: CaptureConflict): CaptureSessionState {
  return { ...state, conflicts: [...state.conflicts, c] };
}

export function resolveConflict(state: CaptureSessionState, conflictId: string): CaptureSessionState {
  return { ...state, conflicts: state.conflicts.filter((c) => c.id !== conflictId) };
}

export function addError(state: CaptureSessionState, e: CaptureError): CaptureSessionState {
  return { ...state, errors: [...state.errors, e] };
}

export function dismissError(state: CaptureSessionState, errorId: string): CaptureSessionState {
  return { ...state, errors: state.errors.filter((e) => e.id !== errorId) };
}

/** All assets must have a role before commit; pending ones block the wizard. */
export function unassignedAssets(state: CaptureSessionState): PendingAsset[] {
  return state.assets.filter((a) => a.role === null);
}

export function canCommit(state: CaptureSessionState): boolean {
  return state.assets.length > 0 && unassignedAssets(state).length === 0;
}
