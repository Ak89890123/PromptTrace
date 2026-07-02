import { useEffect, useState } from 'react';
import { formatHotkeyFromEvent } from '@/src/core/hotkeys';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type DisplaySettings,
} from '@/src/ui/roleColors';
import { resolveLanguage, UI_TEXT, type UiText } from '@/src/ui/i18n';

/** The boolean quick-switches surfaced in the popup. Everything else lives in
 *  the full settings page (詳細設定). */
type ToggleKey =
  | 'edgePanelEnabled'
  | 'selectionToolbarEnabled'
  | 'overlayEnabled'
  | 'copyTrayEnabled';

function toggles(t: UiText): { key: ToggleKey; label: string; hint: string }[] {
  return [
    { key: 'edgePanelEnabled', label: t.edgePanelShort, hint: t.edgePanelHint },
    { key: 'selectionToolbarEnabled', label: t.selectionToolbarShort, hint: t.selectionToolbarHint },
    { key: 'overlayEnabled', label: t.pageFrameShort, hint: t.pageFrameHint },
    { key: 'copyTrayEnabled', label: t.copyTrayShort, hint: t.copyTrayHint },
  ];
}

export default function App() {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const patch = async (p: Partial<DisplaySettings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    await saveSettings(next);
  };
  const t = UI_TEXT[resolveLanguage(settings.language)];

  const openPage = (page: string) =>
    chrome.tabs.create({ url: chrome.runtime.getURL(page) });

  return (
    <div>
      <div className="pop-head">
        <span className="pop-title">
          <img className="pop-logo" src="/icon/128.png" alt="" />
          PromptTrace
        </span>
      </div>

      <div className="card">
        <h2>{t.quickToggles}</h2>
        {toggles(t).map((item) => (
          <label className="spread tog-row" key={item.key} title={item.hint}>
            <span className="tog-label">{item.label}</span>
            <span className="pt-switch">
              <input
                type="checkbox"
                checked={settings[item.key]}
                onChange={(e) => patch({ [item.key]: e.target.checked } as Partial<DisplaySettings>)}
              />
              <span className="pt-track" />
            </span>
          </label>
        ))}
      </div>

      <div className="card">
        <h2>{t.roleOptions}</h2>
        <label className="spread tog-row">
          <span className="tog-label">{t.triggerMode}</span>
          <select
            style={{ width: 'auto' }}
            value={settings.toolbarTrigger}
            onChange={(e) => patch({ toolbarTrigger: e.target.value as 'auto' | 'hotkey' })}
          >
            <option value="hotkey">{t.hotkeyTriggerShort}</option>
            <option value="auto">{t.autoTriggerShort}</option>
          </select>
        </label>
        <label className="spread tog-row">
          <span className="tog-label">{t.hotkey}</span>
          <button
            className={recording ? 'primary' : ''}
            onClick={() => setRecording(true)}
            onBlur={() => setRecording(false)}
            onKeyDown={(e) => {
              if (!recording) return;
              e.preventDefault();
              const hk = formatHotkeyFromEvent(e);
              if (hk) {
                patch({ summonHotkey: hk });
                setRecording(false);
              }
            }}
          >
            {recording ? t.recordingHotkey : settings.summonHotkey}
          </button>
        </label>
        <label className="spread tog-row" title={t.edgeTabHeightHint}>
          <span className="tog-label">{t.edgeTabHeight}</span>
          <span className="range-row">
            <input
              type="range"
              min={5}
              max={95}
              step={1}
              value={settings.edgeTabTop}
              onChange={(e) => patch({ edgeTabTop: Number(e.target.value) })}
            />
            <button
              type="button"
              className="reset-btn"
              disabled={settings.edgeTabTop === DEFAULT_SETTINGS.edgeTabTop}
              onClick={(e) => {
                e.preventDefault();
                patch({ edgeTabTop: DEFAULT_SETTINGS.edgeTabTop });
              }}
            >
              {t.reset}
            </button>
          </span>
        </label>
      </div>

      <div className="pop-footer">
        <button onClick={() => openPage('library.html')}>📚 {t.goLibrary}</button>
        <button onClick={() => openPage('settings.html')}>⚙ {t.detailedSettings}</button>
      </div>
    </div>
  );
}
