import { useEffect, useState } from 'react';
import { formatHotkeyFromEvent } from '@/src/core/hotkeys';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type DisplaySettings,
} from '@/src/ui/roleColors';

/** The boolean quick-switches surfaced in the popup. Everything else lives in
 *  the full settings page (詳細設定). */
type ToggleKey =
  | 'edgePanelEnabled'
  | 'selectionToolbarEnabled'
  | 'overlayEnabled'
  | 'copyTrayEnabled';

const TOGGLES: { key: ToggleKey; label: string; hint: string }[] = [
  { key: 'edgePanelEnabled', label: '右緣漂浮面板', hint: '滑鼠靠右邊自動展開擷取清單' },
  { key: 'selectionToolbarEnabled', label: '反白角色按鈕', hint: '選取文字時浮出角色選項' },
  { key: 'overlayEnabled', label: '頁面框線', hint: '已擷取項目在頁面上顯示彩色框' },
  { key: 'copyTrayEnabled', label: 'Copy Tray', hint: 'Library 右側快速複製小把手' },
];

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
        <h2>快速開關</h2>
        {TOGGLES.map((t) => (
          <label className="spread tog-row" key={t.key} title={t.hint}>
            <span className="tog-label">{t.label}</span>
            <span className="pt-switch">
              <input
                type="checkbox"
                checked={settings[t.key]}
                onChange={(e) => patch({ [t.key]: e.target.checked } as Partial<DisplaySettings>)}
              />
              <span className="pt-track" />
            </span>
          </label>
        ))}
      </div>

      <div className="card">
        <h2>角色選項</h2>
        <label className="spread tog-row">
          <span className="tog-label">出現方式</span>
          <select
            style={{ width: 'auto' }}
            value={settings.toolbarTrigger}
            onChange={(e) => patch({ toolbarTrigger: e.target.value as 'auto' | 'hotkey' })}
          >
            <option value="hotkey">按召喚鍵</option>
            <option value="auto">選取後立即</option>
          </select>
        </label>
        <label className="spread tog-row">
          <span className="tog-label">召喚鍵</span>
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
            {recording ? '按下按鍵…' : settings.summonHotkey}
          </button>
        </label>
        <label className="spread tog-row" title="調整右緣「P」啟動鈕的上下位置">
          <span className="tog-label">P 邊欄高度</span>
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
              Reset
            </button>
          </span>
        </label>
      </div>

      <div className="pop-footer">
        <button onClick={() => openPage('library.html')}>📚 Library</button>
        <button onClick={() => openPage('settings.html')}>⚙ 詳細設定</button>
      </div>
    </div>
  );
}
