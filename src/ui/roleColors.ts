import type { AssetRole } from '../core/domain/enums';

export type RoleColorMap = Record<AssetRole | 'pending', string>;

export const DEFAULT_ROLE_COLORS: RoleColorMap = {
  pending: '#94A3B8',
  input: '#22D3EE',
  input_reference: '#A78BFA',
  output: '#34D399',
  negative: '#F472B6',
};

export type DisplaySettings = {
  roleColors: RoleColorMap;
  overlayEnabled: boolean;
  copyTrayEnabled: boolean;
  defaultExportFormat: 'markdown' | 'json';
  exportIncludeSource: boolean;
  exportIncludeFilePath: boolean;

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
  /** Saved-prompt card layout: 'split' = Input·Reference | Output; 'output-only'. */
  cardLayout: 'split' | 'output-only';
  /** Ask where to save each downloaded media file. Default false = save silently. */
  promptDownloadLocation: boolean;
  /** Vertical position of the right-edge gallery tab, 0 (top)–100 (bottom). */
  edgeTabTop: number;
};

export const DEFAULT_SETTINGS: DisplaySettings = {
  roleColors: DEFAULT_ROLE_COLORS,
  overlayEnabled: true,
  copyTrayEnabled: true,
  defaultExportFormat: 'markdown',
  exportIncludeSource: true,
  exportIncludeFilePath: true,

  edgePanelEnabled: true,
  selectionToolbarEnabled: true,
  toolbarTrigger: 'hotkey',
  summonHotkey: 'Shift+Z',
  toolbarRoles: ['input', 'input_reference', 'negative', 'output'],
  cardLayout: 'split',
  promptDownloadLocation: false,
  edgeTabTop: 50,
};

const SETTINGS_KEY = 'prompttrace:settings';

function withDefaults(stored: Partial<DisplaySettings> | undefined): DisplaySettings {
  if (!stored) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    roleColors: { ...DEFAULT_ROLE_COLORS, ...(stored.roleColors ?? {}) },
    toolbarRoles:
      stored.toolbarRoles && stored.toolbarRoles.length >= 2
        ? stored.toolbarRoles
        : DEFAULT_SETTINGS.toolbarRoles,
  };
}

export async function loadSettings(): Promise<DisplaySettings> {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return withDefaults(data[SETTINGS_KEY] as Partial<DisplaySettings> | undefined);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: DisplaySettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export function onSettingsChanged(cb: (s: DisplaySettings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      cb(withDefaults(changes[SETTINGS_KEY].newValue as Partial<DisplaySettings> | undefined));
    }
  });
}
