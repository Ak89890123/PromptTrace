import { useEffect, useState } from 'react';
import type { RecordCategory } from '@/src/core/domain/entities';
import { ROLE_LABELS, type AssetRole } from '@/src/core/domain/enums';
import { validateCategoryName } from '@/src/core/domain/validation';
import { formatHotkeyFromEvent } from '@/src/core/hotkeys';
import { categoryRepository } from '@/src/storage/repositories';
import { BUILTIN_CATEGORY_DEFAULTS } from '@/src/storage/seed';
import { categoryLabel, resolveLanguage, roleLabel, UI_TEXT, type ResolvedLanguage, type UiText } from '@/src/ui/i18n';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type DisplaySettings } from '@/src/ui/roleColors';
import { useTaxonomy } from '@/src/ui/hooks';

const COLOR_PALETTES = [
  {
    id: 'red',
    label: '紅',
    base: '#FB7185',
    shades: ['#7F1D1D', '#991B1B', '#DC2626', '#EF4444', '#F87171', '#FB7185', '#FDA4AF', '#F97316'],
  },
  {
    id: 'orange',
    label: '橘',
    base: '#F97316',
    shades: ['#7C2D12', '#9A3412', '#C2410C', '#EA580C', '#F97316', '#FB923C', '#FDBA74', '#F59E0B'],
  },
  {
    id: 'yellow',
    label: '黃',
    base: '#FBBF24',
    shades: ['#713F12', '#854D0E', '#A16207', '#CA8A04', '#EAB308', '#FBBF24', '#FDE047', '#FEF08A'],
  },
  {
    id: 'green',
    label: '綠',
    base: '#34D399',
    shades: ['#064E3B', '#065F46', '#047857', '#059669', '#10B981', '#34D399', '#6EE7B7', '#A3E635'],
  },
  {
    id: 'cyan',
    label: '青',
    base: '#22D3EE',
    shades: ['#164E63', '#155E75', '#0E7490', '#0891B2', '#06B6D4', '#22D3EE', '#67E8F9', '#2DD4BF'],
  },
  {
    id: 'blue',
    label: '藍',
    base: '#60A5FA',
    shades: ['#1E3A8A', '#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#38BDF8', '#818CF8'],
  },
  {
    id: 'purple',
    label: '紫',
    base: '#A78BFA',
    shades: ['#4C1D95', '#6D28D9', '#7C3AED', '#8B5CF6', '#A78BFA', '#C084FC', '#D8B4FE', '#F472B6'],
  },
];

function colorFamilyFor(value: string): string {
  const normalized = value.toUpperCase();
  return COLOR_PALETTES.find((palette) => palette.shades.includes(normalized))?.id ?? 'cyan';
}

export default function App() {
  const [refresh, setRefresh] = useState(0);
  const { categories } = useTaxonomy(refresh);
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
  const language = resolveLanguage(settings.language);
  const t = UI_TEXT[language];

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>{t.settingsTitle}</h1>
        <button
          type="button"
          className="settings-nav-button"
          onClick={() => {
            location.href = 'library.html';
          }}
        >
          {t.goLibrary}
        </button>
      </header>
      <div className="settings-layout">
        <LanguageSettings settings={settings} onPatch={patchSettings} t={t} />
        <DisplaySettingsSection settings={settings} onPatch={patchSettings} t={t} language={language} />
        <InteractionSettings settings={settings} onPatch={patchSettings} t={t} language={language} />
        <LibraryRulesSettings categories={categories} onChanged={reload} t={t} language={language} />
        <FileSettingsSection t={t} />
      </div>
    </div>
  );
}

function LanguageSettings({
  settings,
  onPatch,
  t,
}: {
  settings: DisplaySettings;
  onPatch: (p: Partial<DisplaySettings>) => void;
  t: UiText;
}) {
  return (
    <section className="card settings-section">
      <h2>{t.languageCard}</h2>
      <label className="settings-field">
        <span className="muted">{t.interfaceLanguage}</span>
        <select
          value={settings.language}
          onChange={(e) => onPatch({ language: e.target.value as DisplaySettings['language'] })}
        >
          <option value="system">{t.followSystem}</option>
          <option value="zh-TW">{t.traditionalChinese}</option>
          <option value="en-US">{t.english}</option>
        </select>
      </label>
    </section>
  );
}

function ColorSwatchPicker({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeFamily, setActiveFamily] = useState(() => colorFamilyFor(value));
  const normalizedValue = value.toUpperCase();
  const activePalette = COLOR_PALETTES.find((palette) => palette.id === activeFamily) ?? COLOR_PALETTES[0];

  useEffect(() => {
    setActiveFamily(colorFamilyFor(value));
  }, [value]);

  return (
    <div className="settings-color-picker">
      <button
        type="button"
        className="settings-color-current"
        aria-label={label}
        title={label}
        style={{ backgroundColor: value }}
        onClick={() => setOpen((x) => !x)}
      />
      {open && (
        <div className="settings-color-popover">
          <div className="settings-color-grid" aria-label={`${activePalette.label}色系`}>
            {activePalette.shades.map((color) => (
              <button
                type="button"
                key={color}
                className={normalizedValue === color ? 'settings-color-dot is-active' : 'settings-color-dot'}
                aria-label={`選擇 ${color}`}
                title={color}
                style={{ backgroundColor: color }}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="settings-color-family-row" aria-label="色系">
            {COLOR_PALETTES.map((palette) => (
              <button
                type="button"
                key={palette.id}
                className={activeFamily === palette.id ? 'settings-color-family is-active' : 'settings-color-family'}
                aria-label={`${palette.label}色系`}
                title={`${palette.label}色系`}
                style={{ backgroundColor: palette.base }}
                onClick={() => setActiveFamily(palette.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HotkeyRecorder({ value, onChange, t }: { value: string | undefined; onChange: (v: string) => void; t: UiText }) {
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
      {recording ? t.recordingHotkey : value || t.notSet}
    </button>
  );
}

function InteractionSettings({
  settings,
  onPatch,
  t,
  language,
}: {
  settings: DisplaySettings;
  onPatch: (p: Partial<DisplaySettings>) => void;
  t: UiText;
  language: ResolvedLanguage;
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
    <section className="card settings-section">
      <h2>{t.interaction}</h2>
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.edgePanelEnabled}
            onChange={(e) => onPatch({ edgePanelEnabled: e.target.checked })}
          />
          {t.edgePanel}
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.selectionToolbarEnabled}
            onChange={(e) => onPatch({ selectionToolbarEnabled: e.target.checked })}
          />
          {t.selectionToolbar}
        </label>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="muted">{t.toolbarTrigger}</label>
        <select
          style={{ width: 'auto' }}
          value={settings.toolbarTrigger}
          onChange={(e) => onPatch({ toolbarTrigger: e.target.value as 'auto' | 'hotkey' })}
        >
          <option value="hotkey">{t.triggerHotkey}</option>
          <option value="auto">{t.triggerAuto}</option>
        </select>
        <label className="muted">{t.hotkey}</label>
        <HotkeyRecorder
          value={settings.summonHotkey}
          onChange={(v) => onPatch({ summonHotkey: v })}
          t={t}
        />
      </div>
      <p className="muted">
        {t.hotkeyBlocked} <code>chrome://extensions/shortcuts</code> {t.hotkeyBlockedSuffix}
      </p>
      <h2>{t.quickSaveButtons}</h2>
      <p className="muted">{t.quickSaveHint}</p>
      <div className="row">
        {(Object.keys(ROLE_LABELS) as AssetRole[]).map((role) => (
          <label key={role} className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={settings.toolbarRoles.includes(role)}
              onChange={() => toggleToolbarRole(role)}
            />
            {roleLabel(role, language)}
          </label>
        ))}
      </div>
    </section>
  );
}

function CategorySettings({
  categories,
  onChanged,
  t,
  language,
}: {
  categories: RecordCategory[];
  onChanged: () => void;
  t: UiText;
  language: ResolvedLanguage;
}) {
  const [newName, setNewName] = useState('');
  const categoryRows = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  const save = async (c: RecordCategory, patch: Partial<RecordCategory>) => {
    await categoryRepository.save({ ...c, ...patch, updatedAt: new Date().toISOString() });
    onChanged();
  };

  const resetBuiltinCategories = async () => {
    const now = new Date().toISOString();
    const builtinIds = new Set(BUILTIN_CATEGORY_DEFAULTS.map((c) => c.id));
    for (const c of BUILTIN_CATEGORY_DEFAULTS) {
      const existing = categories.find((x) => x.id === c.id);
      await categoryRepository.save({
        ...(existing ?? {
          id: c.id,
          createdAt: now,
        }),
        id: c.id,
        parentId: null,
        name: c.name,
        color: c.color,
        icon: undefined,
        isBuiltin: true,
        isActive: true,
        sortOrder: c.sortOrder,
        updatedAt: now,
      });
    }
    for (const c of categories) {
      if (c.isBuiltin && !builtinIds.has(c.id as (typeof BUILTIN_CATEGORY_DEFAULTS)[number]['id'])) {
        await categoryRepository.delete(c.id);
      }
    }
    onChanged();
  };

  return (
    <div className="settings-subsection">
      <div className="spread">
        <div>
          <h2>{t.category}</h2>
          <p className="muted">
            {t.categoryHint}
          </p>
        </div>
        <button onClick={resetBuiltinCategories}>{t.resetBuiltinCategories}</button>
      </div>
      <div className="settings-category-row settings-row-header">
        <span>{t.colorHeader}</span>
        <span>{t.category}</span>
        <span>{t.order}</span>
        <span>{t.action}</span>
      </div>
      {categoryRows.map((c) => {
        const displayName = categoryLabel(c, language);
        return (
          <div className="settings-category-row" key={c.id}>
            <ColorSwatchPicker
              value={c.color ?? '#94a3b8'}
              label={`${displayName} ${t.color}`}
              onChange={(color) => save(c, { color })}
            />
            <input
              style={{ width: 180 }}
              defaultValue={displayName}
              onBlur={(e) => {
                const name = e.target.value.trim();
                const v = validateCategoryName(name);
                if (v.ok && name !== displayName) save(c, { name });
              }}
            />
            <div className="settings-compact-actions">
              <button onClick={() => save(c, { sortOrder: c.sortOrder - 1.5 })} title={t.moveUp}>↑</button>
              <button onClick={() => save(c, { sortOrder: c.sortOrder + 1.5 })} title={t.moveDown}>↓</button>
            </div>
            <button
              className="danger"
              onClick={async () => {
                await categoryRepository.delete(c.id);
                onChanged();
              }}
            >
              {t.delete}
            </button>
          </div>
        );
      })}
      <div className="settings-category-row settings-new-row">
        <span />
        <input
          placeholder={t.newCategoryName}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <span />
        <button
          className="primary"
          disabled={!validateCategoryName(newName).ok}
          onClick={async () => {
            const now = new Date().toISOString();
            await categoryRepository.save({
              id: crypto.randomUUID(),
              parentId: null,
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
          {t.addCategory}
        </button>
      </div>
    </div>
  );
}

function LibraryRulesSettings({
  categories,
  onChanged,
  t,
  language,
}: {
  categories: RecordCategory[];
  onChanged: () => void;
  t: UiText;
  language: ResolvedLanguage;
}) {
  return (
    <section className="card settings-section settings-wide-section">
      <CategorySettings categories={categories} onChanged={onChanged} t={t} language={language} />
    </section>
  );
}

function DisplaySettingsSection({
  settings,
  onPatch,
  t,
  language,
}: {
  settings: DisplaySettings;
  onPatch: (p: Partial<DisplaySettings>) => void;
  t: UiText;
  language: ResolvedLanguage;
}) {
  return (
    <section className="card settings-section">
      <h2>{t.display}</h2>
      <div className="row">
        {(['pending', ...Object.keys(ROLE_LABELS)] as (AssetRole | 'pending')[]).map((role) => (
          <div key={role} className="settings-role-color">
            <ColorSwatchPicker
              value={settings.roleColors[role]}
              label={`${role === 'pending' ? t.uncategorized : roleLabel(role as AssetRole, language)} ${t.color}`}
              onChange={(color) => onPatch({ roleColors: { ...settings.roleColors, [role]: color } })}
            />
            <span className="muted">{role === 'pending' ? t.uncategorized : roleLabel(role as AssetRole, language)}</span>
          </div>
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
          {t.pageFrame}
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.copyTrayEnabled}
            onChange={(e) => onPatch({ copyTrayEnabled: e.target.checked })}
          />
          {t.copyTray}
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="muted">{t.cardLayout}</label>
        <select
          style={{ width: 'auto' }}
          value={settings.cardLayout}
          onChange={(e) => onPatch({ cardLayout: e.target.value as 'split' | 'output-only' })}
        >
          <option value="split">{t.splitCard}</option>
          <option value="output-only">{t.outputOnly}</option>
        </select>
        <span className="muted">{t.layoutApplies}</span>
      </div>
    </section>
  );
}

const PROMPTTRACE_ROOT_FILE_REGEX = '[\\\\/]PromptTrace[\\\\/][^\\\\/]+$';
const PROMPTTRACE_FILE_REGEX = '[\\\\/]PromptTrace[\\\\/]';

async function openPromptTraceFolder(): Promise<void> {
  const [rootItem] = await chrome.downloads.search({
    filenameRegex: PROMPTTRACE_ROOT_FILE_REGEX,
    state: 'complete',
    exists: true,
    orderBy: ['-startTime'],
    limit: 1,
  });
  if (rootItem) {
    chrome.downloads.show(rootItem.id);
    return;
  }

  const [nestedItem] = await chrome.downloads.search({
    filenameRegex: PROMPTTRACE_FILE_REGEX,
    state: 'complete',
    exists: true,
    orderBy: ['-startTime'],
    limit: 1,
  });
  if (nestedItem) {
    chrome.downloads.show(nestedItem.id);
    return;
  }

  throw new Error('NO_PROMPTTRACE_DOWNLOADS');
}

function FileSettingsSection({ t }: { t: UiText }) {
  return (
    <section className="card settings-section">
      <h2>{t.files}</h2>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            openPromptTraceFolder().catch((error) => {
              alert(error instanceof Error && error.message === 'NO_PROMPTTRACE_DOWNLOADS' ? t.noDownloads : t.openFolderFailed);
            });
          }}
        >
          {t.openFileFolder}
        </button>
      </div>
    </section>
  );
}
