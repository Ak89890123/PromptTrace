import { useEffect, useState } from 'react';
import type { ModelPreset, RecordCategory } from '@/src/core/domain/entities';
import { ROLE_LABELS, type AssetRole } from '@/src/core/domain/enums';
import { validateCategoryName, validateModelPreset, wouldCreateCycle } from '@/src/core/domain/validation';
import { formatHotkeyFromEvent } from '@/src/core/hotkeys';
import { categoryRepository, modelPresetRepository } from '@/src/storage/repositories';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type DisplaySettings } from '@/src/ui/roleColors';
import { flattenTree, useTaxonomy } from '@/src/ui/hooks';

export default function App() {
  const [refresh, setRefresh] = useState(0);
  const { categories, presets } = useTaxonomy(refresh);
  const reload = () => setRefresh((x) => x + 1);
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);
  const patchSettings = async (patch: Partial<DisplaySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 20 }}>
      <h1>PromptTrace Settings</h1>
      <InteractionSettings settings={settings} onPatch={patchSettings} />
      <CategorySettings categories={categories} onChanged={reload} />
      <ModelSettings presets={presets} categories={categories} onChanged={reload} />
      <DisplaySettingsSection settings={settings} onPatch={patchSettings} />
      <ExportSettingsSection settings={settings} onPatch={patchSettings} />
      <PermissionInfo />
    </div>
  );
}

function HotkeyRecorder({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <button
      style={{ minWidth: 86, borderColor: recording ? 'var(--accent)' : undefined }}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        const formatted = formatHotkeyFromEvent(e);
        if (formatted) {
          onChange(formatted);
          setRecording(false);
        }
      }}
    >
      {recording ? '按下組合鍵…' : value || '未設定'}
    </button>
  );
}

function InteractionSettings({
  settings,
  onPatch,
}: {
  settings: DisplaySettings;
  onPatch: (p: Partial<DisplaySettings>) => void;
}) {
  const toggleToolbarRole = (role: AssetRole) => {
    const has = settings.toolbarRoles.includes(role);
    const next = has
      ? settings.toolbarRoles.filter((r) => r !== role)
      : [...settings.toolbarRoles, role];
    if (next.length < 2) return; // keep at least two buttons
    onPatch({ toolbarRoles: next });
  };

  return (
    <section className="card">
      <h2>互動設定</h2>
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.edgePanelEnabled}
            onChange={(e) => onPatch({ edgePanelEnabled: e.target.checked })}
          />
          頁面右緣漂浮面板（滑鼠靠近右邊自動展開）
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.selectionToolbarEnabled}
            onChange={(e) => onPatch({ selectionToolbarEnabled: e.target.checked })}
          />
          反白文字時顯示角色按鈕
        </label>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="muted">角色選項出現方式</label>
        <select
          style={{ width: 'auto' }}
          value={settings.toolbarTrigger}
          onChange={(e) => onPatch({ toolbarTrigger: e.target.value as 'auto' | 'hotkey' })}
        >
          <option value="hotkey">反白後按召喚鍵才出現（建議）</option>
          <option value="auto">反白後自動出現</option>
        </select>
        <label className="muted">頁面內召喚鍵</label>
        <HotkeyRecorder
          value={settings.summonHotkey}
          onChange={(v) => onPatch({ summonHotkey: v })}
        />
      </div>
      <p className="muted">
        流程：反白文字（或游標移到圖片 / 影片上）→ 按召喚鍵 → 就地跳出該對象「合法的」角色選項
        （例如圖片不會出現 Negative）。
        <br />
        上面的「頁面內召喚鍵」就是主要的召喚快捷鍵，改了即時生效、無需重新整理。
        <br />
        <strong>若某網站把按鍵吃掉：</strong>可另到{' '}
        <code>chrome://extensions/shortcuts</code> 為「PromptTrace：叫出角色選項」設定一個瀏覽器層級快捷鍵
        （預設不綁，優先權高於網頁按鍵處理）。
      </p>
      <h2>工具列顯示哪些角色按鈕（2–4 顆，依對象自動過濾）</h2>
      <div className="row">
        {(Object.keys(ROLE_LABELS) as AssetRole[]).map((role) => (
          <label key={role} className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={settings.toolbarRoles.includes(role)}
              onChange={() => toggleToolbarRole(role)}
            />
            {ROLE_LABELS[role]}
          </label>
        ))}
      </div>
    </section>
  );
}

function CategorySettings({ categories, onChanged }: { categories: RecordCategory[]; onChanged: () => void }) {
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');
  const tree = flattenTree(categories);

  const save = async (c: RecordCategory, patch: Partial<RecordCategory>) => {
    await categoryRepository.save({ ...c, ...patch, updatedAt: new Date().toISOString() });
    onChanged();
  };

  return (
    <section className="card">
      <h2>分類（Record Category）</h2>
      <p className="muted">
        分類是選填的，支援多層級。內建分類（生文 / 生圖 / 生影 等）不能刪除，但可以停用。
      </p>
      {tree.map(({ category: c, depth }) => (
        <div className="row" key={c.id} style={{ marginLeft: depth * 20, marginBottom: 4 }}>
          <input
            type="color"
            value={c.color ?? '#94a3b8'}
            style={{ width: 28, padding: 0 }}
            onChange={(e) => save(c, { color: e.target.value })}
            title="分類顏色"
          />
          <input
            style={{ width: 60 }}
            placeholder="icon"
            value={c.icon ?? ''}
            onChange={(e) => save(c, { icon: e.target.value })}
            title="icon（emoji）"
          />
          <input
            style={{ width: 180, opacity: c.isActive ? 1 : 0.5 }}
            defaultValue={c.name}
            onBlur={(e) => {
              const v = validateCategoryName(e.target.value);
              if (v.ok && e.target.value !== c.name) save(c, { name: e.target.value.trim() });
            }}
          />
          <select
            style={{ width: 'auto' }}
            value={c.parentId ?? ''}
            title="父分類"
            onChange={(e) => {
              const parentId = e.target.value || null;
              if (wouldCreateCycle(categories, c.id, parentId)) {
                alert('不能把分類移到自己的子分類底下。');
                return;
              }
              save(c, { parentId });
            }}
          >
            <option value="">（頂層）</option>
            {categories
              .filter((x) => x.id !== c.id)
              .map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
          </select>
          <button onClick={() => save(c, { sortOrder: c.sortOrder - 1.5 })} title="上移">↑</button>
          <button onClick={() => save(c, { sortOrder: c.sortOrder + 1.5 })} title="下移">↓</button>
          <button onClick={() => save(c, { isActive: !c.isActive })}>
            {c.isActive ? '停用' : '啟用'}
          </button>
          {!c.isBuiltin && (
            <button
              className="danger"
              onClick={async () => {
                if (categories.some((x) => x.parentId === c.id)) {
                  alert('請先移除或搬移子分類。');
                  return;
                }
                await categoryRepository.delete(c.id);
                onChanged();
              }}
            >
              刪除
            </button>
          )}
          {c.isBuiltin && <span className="muted">內建</span>}
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <input
          style={{ width: 200 }}
          placeholder="新分類名稱"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select style={{ width: 'auto' }} value={newParent} onChange={(e) => setNewParent(e.target.value)}>
          <option value="">（頂層）</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          className="primary"
          disabled={!validateCategoryName(newName).ok}
          onClick={async () => {
            const now = new Date().toISOString();
            await categoryRepository.save({
              id: crypto.randomUUID(),
              parentId: newParent || null,
              name: newName.trim(),
              isBuiltin: false,
              isActive: true,
              sortOrder: categories.length,
              createdAt: now,
              updatedAt: now,
            });
            setNewName('');
            onChanged();
          }}
        >
          新增分類
        </button>
      </div>
    </section>
  );
}

function ModelSettings({
  presets,
  categories,
  onChanged,
}: {
  presets: ModelPreset[];
  categories: RecordCategory[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({ modelName: '', provider: '', categoryId: '' });

  const save = async (p: ModelPreset, patch: Partial<ModelPreset>) => {
    await modelPresetRepository.save({ ...p, ...patch, updatedAt: new Date().toISOString() });
    onChanged();
  };

  return (
    <section className="card">
      <h2>Model Presets</h2>
      <p className="muted">
        Model 只是 metadata、保存時可以不填。這裡的 preset 可以新增、修改、停用、刪除、排序。
      </p>
      {presets.map((p) => (
        <div className="row" key={p.id} style={{ marginBottom: 4, opacity: p.isActive ? 1 : 0.5 }}>
          <input
            style={{ width: 150 }}
            defaultValue={p.modelName}
            onBlur={(e) => {
              if (validateModelPreset({ modelName: e.target.value }).ok && e.target.value !== p.modelName)
                save(p, { modelName: e.target.value.trim() });
            }}
          />
          <input
            style={{ width: 110 }}
            placeholder="provider"
            defaultValue={p.provider ?? ''}
            onBlur={(e) => e.target.value !== (p.provider ?? '') && save(p, { provider: e.target.value })}
          />
          <input
            style={{ width: 90 }}
            placeholder="version"
            defaultValue={p.modelVersion ?? ''}
            onBlur={(e) => e.target.value !== (p.modelVersion ?? '') && save(p, { modelVersion: e.target.value })}
          />
          <input
            style={{ width: 90 }}
            placeholder="alias"
            defaultValue={p.alias ?? ''}
            onBlur={(e) => e.target.value !== (p.alias ?? '') && save(p, { alias: e.target.value })}
          />
          <select
            style={{ width: 'auto' }}
            value={p.categoryId ?? ''}
            onChange={(e) => save(p, { categoryId: e.target.value || null })}
          >
            <option value="">（不綁分類）</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button onClick={() => save(p, { sortOrder: p.sortOrder - 1.5 })}>↑</button>
          <button onClick={() => save(p, { sortOrder: p.sortOrder + 1.5 })}>↓</button>
          <button onClick={() => save(p, { isDefault: !p.isDefault })}>
            {p.isDefault ? '★ default' : '☆ 設為 default'}
          </button>
          <button onClick={() => save(p, { isActive: !p.isActive })}>{p.isActive ? '停用' : '啟用'}</button>
          <button
            className="danger"
            onClick={async () => {
              await modelPresetRepository.delete(p.id);
              onChanged();
            }}
          >
            刪除
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <input
          style={{ width: 150 }}
          placeholder="model 名稱"
          value={draft.modelName}
          onChange={(e) => setDraft({ ...draft, modelName: e.target.value })}
        />
        <input
          style={{ width: 110 }}
          placeholder="provider（選填）"
          value={draft.provider}
          onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
        />
        <select
          style={{ width: 'auto' }}
          value={draft.categoryId}
          onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
        >
          <option value="">（不綁分類）</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          className="primary"
          disabled={!validateModelPreset({ modelName: draft.modelName }).ok}
          onClick={async () => {
            const now = new Date().toISOString();
            await modelPresetRepository.save({
              id: crypto.randomUUID(),
              modelName: draft.modelName.trim(),
              provider: draft.provider.trim() || undefined,
              categoryId: draft.categoryId || null,
              isActive: true,
              isDefault: false,
              sortOrder: presets.length + 100,
              createdAt: now,
              updatedAt: now,
            });
            setDraft({ modelName: '', provider: '', categoryId: '' });
            onChanged();
          }}
        >
          新增 model
        </button>
      </div>
    </section>
  );
}

function DisplaySettingsSection({
  settings,
  onPatch,
}: {
  settings: DisplaySettings;
  onPatch: (p: Partial<DisplaySettings>) => void;
}) {
  return (
    <section className="card">
      <h2>顯示設定</h2>
      <div className="row">
        {(['pending', ...Object.keys(ROLE_LABELS)] as (AssetRole | 'pending')[]).map((role) => (
          <label key={role} className="row" style={{ gap: 4 }}>
            <input
              type="color"
              style={{ width: 28, padding: 0 }}
              value={settings.roleColors[role]}
              onChange={(e) =>
                onPatch({ roleColors: { ...settings.roleColors, [role]: e.target.value } })
              }
            />
            <span className="muted">{role === 'pending' ? 'Pending' : ROLE_LABELS[role as AssetRole]}</span>
          </label>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.overlayEnabled}
            onChange={(e) => onPatch({ overlayEnabled: e.target.checked })}
          />
          顯示頁面 overlay 框線
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.copyTrayEnabled}
            onChange={(e) => onPatch({ copyTrayEnabled: e.target.checked })}
          />
          啟用 Floating Copy Tray
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="muted">已存 Prompt 卡片顯示</label>
        <select
          style={{ width: 'auto' }}
          value={settings.cardLayout}
          onChange={(e) => onPatch({ cardLayout: e.target.value as 'split' | 'output-only' })}
        >
          <option value="split">左右顯示（Input · Reference ｜ Output）</option>
          <option value="output-only">只顯示 Output</option>
        </select>
        <span className="muted">套用到頁內 Gallery 與 Library 卡片。</span>
      </div>
    </section>
  );
}

function ExportSettingsSection({
  settings,
  onPatch,
}: {
  settings: DisplaySettings;
  onPatch: (p: Partial<DisplaySettings>) => void;
}) {
  return (
    <section className="card">
      <h2>匯出設定</h2>
      <div className="row">
        <label className="muted">預設格式</label>
        <select
          style={{ width: 'auto' }}
          value={settings.defaultExportFormat}
          onChange={(e) => onPatch({ defaultExportFormat: e.target.value as 'markdown' | 'json' })}
        >
          <option value="markdown">Markdown</option>
          <option value="json">JSON</option>
        </select>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.exportIncludeSource}
            onChange={(e) => onPatch({ exportIncludeSource: e.target.checked })}
          />
          匯出包含來源 URL
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.exportIncludeFilePath}
            onChange={(e) => onPatch({ exportIncludeFilePath: e.target.checked })}
          />
          匯出包含本地檔案路徑
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.promptDownloadLocation}
            onChange={(e) => onPatch({ promptDownloadLocation: e.target.checked })}
          />
          下載圖片 / 影片時詢問儲存位置
          <span className="muted">（預設關閉＝直接存到 Downloads/PromptTrace，不跳視窗）</span>
        </label>
      </div>
    </section>
  );
}

function PermissionInfo() {
  return (
    <section className="card">
      <h2>權限與快捷鍵說明</h2>
      <ul style={{ paddingLeft: 18 }}>
        <li>
          <strong>頁面存取（&lt;all_urls&gt; / activeTab）</strong>：讀取你反白的文字與右鍵選到的圖片 /
          影片 URL，並在頁面上畫出選取框線。不會讀取其他內容、不會上傳任何資料。
        </li>
        <li>
          <strong>downloads</strong>：把圖片 / 影片下載到 <code>Downloads/PromptTrace/</code>{' '}
          子資料夾，並在刪除 Record 時可選擇連同檔案刪除（只刪 extension 自己下載的檔案）。
        </li>
        <li>
          <strong>storage / IndexedDB</strong>：所有 Prompt 與 metadata 都保存在本機瀏覽器內，沒有雲端同步。
        </li>
        <li>
          <strong>快捷鍵</strong>：可在 <code>chrome://extensions/shortcuts</code> 自訂開啟 Side Panel 的快捷鍵。
        </li>
      </ul>
      <p className="muted">
        下載策略：媒體固定下載到 Downloads/PromptTrace/&#123;record&#125;/，extension 無法寫入任意系統資料夾。
        blob / 串流 / DRM 影片無法下載，會以 Error Card + 只保存來源處理。
      </p>
    </section>
  );
}
