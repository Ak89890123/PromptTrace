import type { AssetRole } from '../core/domain/enums';
import { DEFAULT_MEDIA_QUALITY, normalizeMediaQuality, type MediaQuality } from '../core/media/quality';
import { DEFAULT_SUMMARY_SETTINGS, mergeSummarySettings, type SummarySettings } from '../core/summary';

export type RoleColorMap = Record<AssetRole | 'pending', string>;

export const DEFAULT_ROLE_COLORS: RoleColorMap = {
  pending: '#94A3B8',
  input: '#22D3EE',
  input_reference: '#A78BFA',
  output: '#34D399',
  negative: '#F472B6',
};

export type DisplaySettings = {
  language: 'system' | 'en-US' | 'zh-TW' | 'zh-CN';
  roleColors: RoleColorMap;
  copyTrayEnabled: boolean;

  /** In-page floating panel that expands when hovering the right edge. */
  edgePanelEnabled: boolean;
  /** Inline role-button toolbar shown at the text selection. */
  selectionToolbarEnabled: boolean;
  /** 'hotkey' = select → press summon key → role options appear; 'auto' = appear right after selecting. */
  toolbarTrigger: 'auto' | 'hotkey';
  /**
   * Summon key handled in-page (capture phase). This is the authoritative,
   * user-configurable shortcut; an optional browser-level override can be set
   * at chrome://extensions/shortcuts.
   */
  summonHotkey: string;
  /** Which role buttons the toolbar may show (filtered per asset type at popup time). */
  toolbarRoles: AssetRole[];
  /** Saved-prompt card layout: split, input-only, or output-only. */
  cardLayout: 'split' | 'input-only' | 'output-only';
  /** Vertical position of the right-edge gallery tab, 0 (top)–100 (bottom). */
  edgeTabTop: number;
  /** How long soft-deleted records stay in trash before permanent purge. */
  trashRetentionDays: number;
  /** Quality used for canonical image/video previews created after capture. */
  mediaQuality: MediaQuality;
  summary: SummarySettings;
};

export const DEFAULT_SETTINGS: DisplaySettings = {
  language: 'system',
  roleColors: DEFAULT_ROLE_COLORS,
  copyTrayEnabled: true,

  edgePanelEnabled: true,
  selectionToolbarEnabled: true,
  toolbarTrigger: 'hotkey',
  summonHotkey: 'Shift+Z',
  toolbarRoles: ['input', 'input_reference', 'negative', 'output'],
  cardLayout: 'split',
  edgeTabTop: 50,
  trashRetentionDays: 10,
  mediaQuality: DEFAULT_MEDIA_QUALITY,
  summary: DEFAULT_SUMMARY_SETTINGS,
};

const SETTINGS_KEY = 'promptrace:settings';
const LEGACY_SETTINGS_KEY = 'prompttrace:settings';

function withDefaults(stored: Partial<DisplaySettings> | undefined): DisplaySettings {
  if (!stored) return DEFAULT_SETTINGS;
  // Remove retired settings so they cannot leak back into the runtime or
  // remain in chrome.storage.local.
  const {
    mediaStorage: _legacyMediaStorage,
    overlayEnabled: _retiredOverlayEnabled,
    ...storedWithoutRetiredSettings
  } = stored as Partial<DisplaySettings> & {
    mediaStorage?: unknown;
    overlayEnabled?: unknown;
  };
  const language =
    stored.language === 'system' || stored.language === 'en-US' || stored.language === 'zh-TW' || stored.language === 'zh-CN'
      ? stored.language
      : DEFAULT_SETTINGS.language;
  const cardLayout =
    stored.cardLayout === 'split' || stored.cardLayout === 'input-only' || stored.cardLayout === 'output-only'
      ? stored.cardLayout
      : DEFAULT_SETTINGS.cardLayout;
  const trashRetentionDays = Number.isFinite(stored.trashRetentionDays)
    ? Math.min(365, Math.max(1, Math.round(stored.trashRetentionDays ?? DEFAULT_SETTINGS.trashRetentionDays)))
    : DEFAULT_SETTINGS.trashRetentionDays;
  return {
    ...DEFAULT_SETTINGS,
    ...storedWithoutRetiredSettings,
    language,
    cardLayout,
    trashRetentionDays,
    mediaQuality: normalizeMediaQuality(stored.mediaQuality),
    roleColors: { ...DEFAULT_ROLE_COLORS, ...(stored.roleColors ?? {}) },
    toolbarRoles:
      stored.toolbarRoles && stored.toolbarRoles.length >= 2
        ? stored.toolbarRoles
        : DEFAULT_SETTINGS.toolbarRoles,
    summary: mergeSummarySettings(stored.summary),
  };
}

export async function loadSettings(): Promise<DisplaySettings> {
  try {
    const data = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
    const stored = data[SETTINGS_KEY] as Partial<DisplaySettings> | undefined;
    if (stored) {
      const normalized = withDefaults(stored);
      if (
        Object.prototype.hasOwnProperty.call(stored, 'mediaStorage') ||
        Object.prototype.hasOwnProperty.call(stored, 'overlayEnabled')
      ) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
      }
      return normalized;
    }

    const legacy = data[LEGACY_SETTINGS_KEY] as Partial<DisplaySettings> | undefined;
    if (legacy) {
      const normalized = withDefaults(legacy);
      await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
      return normalized;
    }
    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: DisplaySettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export function onSettingsChanged(cb: (s: DisplaySettings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[SETTINGS_KEY] ?? changes[LEGACY_SETTINGS_KEY];
    if (change) {
      cb(withDefaults(change.newValue as Partial<DisplaySettings> | undefined));
    }
  });
}
