import type { AssetRole } from '../core/domain/enums';
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
  overlayEnabled: boolean;
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
  summary: SummarySettings;
};

export const DEFAULT_SETTINGS: DisplaySettings = {
  language: 'system',
  roleColors: DEFAULT_ROLE_COLORS,
  overlayEnabled: true,
  copyTrayEnabled: true,

  edgePanelEnabled: true,
  selectionToolbarEnabled: true,
  toolbarTrigger: 'hotkey',
  summonHotkey: 'Shift+Z',
  toolbarRoles: ['input', 'input_reference', 'negative', 'output'],
  cardLayout: 'split',
  edgeTabTop: 50,
  summary: DEFAULT_SUMMARY_SETTINGS,
};

const SETTINGS_KEY = 'promptrace:settings';
const LEGACY_SETTINGS_KEY = 'prompttrace:settings';

function withDefaults(stored: Partial<DisplaySettings> | undefined): DisplaySettings {
  if (!stored) return DEFAULT_SETTINGS;
  const language =
    stored.language === 'system' || stored.language === 'en-US' || stored.language === 'zh-TW' || stored.language === 'zh-CN'
      ? stored.language
      : DEFAULT_SETTINGS.language;
  const cardLayout =
    stored.cardLayout === 'split' || stored.cardLayout === 'input-only' || stored.cardLayout === 'output-only'
      ? stored.cardLayout
      : DEFAULT_SETTINGS.cardLayout;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    language,
    cardLayout,
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
    if (stored) return withDefaults(stored);

    const legacy = data[LEGACY_SETTINGS_KEY] as Partial<DisplaySettings> | undefined;
    if (legacy) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: legacy });
      return withDefaults(legacy);
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
