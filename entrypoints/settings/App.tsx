import { useEffect, useId, useState } from 'react';
import type { Asset, FileRecord, LibraryRecord, RecordCategory } from '@/src/core/domain/entities';
import {
  backupFilename,
  createPromptTraceBackupZip,
  parsePromptTraceBackupZip,
  promptTraceBackupMediaDownloadFilename,
  sanitizeBackupFileRecord,
  type BackupMediaEntry,
} from '@/src/core/backup/archive';
import { ROLE_LABELS, type AssetRole } from '@/src/core/domain/enums';
import { validateCategoryName } from '@/src/core/domain/validation';
import { formatHotkeyFromEvent } from '@/src/core/hotkeys';
import {
  defaultSummarySystemPrompt,
  maskApiKey,
  SUMMARY_PROVIDER_LABELS,
  SUMMARY_PROVIDER_MODELS,
  type SummaryPromptLanguage,
  type SummaryProvider,
} from '@/src/core/summary';
import { summaryUsageStats } from '@/src/core/summaryUsage';
import {
  assetRepository,
  categoryRepository,
  fileRecordRepository,
  recordRepository,
  tagRepository,
} from '@/src/storage/repositories';
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
        <div className="settings-column">
          <section className="card settings-section settings-primary-section">
            <LanguageSettings settings={settings} onPatch={patchSettings} t={t} />
            <div className="settings-inner-divider settings-primary-divider" />
            <InteractionDisplaySettings settings={settings} onPatch={patchSettings} t={t} language={language} />
            <div className="settings-inner-divider settings-primary-divider" />
            <DataFilesSettingsSection t={t} />
          </section>
        </div>
        <div className="settings-column settings-category-column">
          <LibraryRulesSettings categories={categories} onChanged={reload} t={t} language={language} />
        </div>
        <div className="settings-column settings-card-layout-column">
          <section className="card settings-section">
            <CardLayoutSettings settings={settings} onPatch={patchSettings} t={t} language={language} />
          </section>
        </div>
        <div className="settings-column settings-summary-column">
          <SummarySettingsSection settings={settings} onPatch={patchSettings} t={t} language={language} />
        </div>
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
    <div className="settings-subsection settings-language-subsection">
      <h2 className="settings-language-heading">
        <span>{t.languageCard}</span>
        <span className="muted">{t.interfaceLanguage}</span>
      </h2>
      <label className="settings-field">
        <select
          value={settings.language}
          onChange={(e) => onPatch({ language: e.target.value as DisplaySettings['language'] })}
        >
          <option value="system">{t.followSystem}</option>
          <option value="en-US">{t.english}</option>
          <option value="zh-TW">{t.traditionalChinese}</option>
          <option value="zh-CN">{t.simplifiedChinese}</option>
        </select>
      </label>
    </div>
  );
}

function ColorSwatchPicker({
  value,
  label,
  onChange,
  t,
  language,
}: {
  value: string;
  label: string;
  onChange: (color: string) => void;
  t: UiText;
  language: ResolvedLanguage;
}) {
  const [open, setOpen] = useState(false);
  const [activeFamily, setActiveFamily] = useState(() => colorFamilyFor(value));
  const normalizedValue = value.toUpperCase();
  const activePalette = COLOR_PALETTES.find((palette) => palette.id === activeFamily) ?? COLOR_PALETTES[0];
  const paletteLabel = (palette: (typeof COLOR_PALETTES)[number]) => language === 'en-US' ? palette.id : palette.label;

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
          <div className="settings-color-grid" aria-label={`${paletteLabel(activePalette)} ${t.colorFamily}`}>
            {activePalette.shades.map((color) => (
              <button
                type="button"
                key={color}
                className={normalizedValue === color ? 'settings-color-dot is-active' : 'settings-color-dot'}
                aria-label={`${t.selectColor} ${color}`}
                title={color}
                style={{ backgroundColor: color }}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="settings-color-family-row" aria-label={t.colorFamily}>
            {COLOR_PALETTES.map((palette) => (
              <button
                type="button"
                key={palette.id}
                className={activeFamily === palette.id ? 'settings-color-family is-active' : 'settings-color-family'}
                aria-label={`${paletteLabel(palette)} ${t.colorFamily}`}
                title={`${paletteLabel(palette)} ${t.colorFamily}`}
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
      style={{ borderColor: recording ? 'var(--accent)' : undefined }}
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

function InteractionDisplaySettings({
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
    <>
      <InteractionSettings settings={settings} onPatch={onPatch} t={t} language={language} />
      <div className="settings-dashed-divider" />
      <DisplaySettingsSection settings={settings} onPatch={onPatch} t={t} language={language} />
    </>
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
  return (
    <div className="settings-subsection">
      <h2>{t.saveEntry}</h2>
      <div className="settings-control-stack">
        <label className="settings-control-row">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.edgePanelEnabled}
            onChange={(e) => onPatch({ edgePanelEnabled: e.target.checked })}
          />
          {t.edgePanel}
        </label>
        <label className="settings-control-row">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.selectionToolbarEnabled}
            onChange={(e) => onPatch({ selectionToolbarEnabled: e.target.checked })}
          />
          {t.selectionToolbar}
        </label>
      </div>
      <div className="settings-mode-row">
        <span className="muted">{t.toolbarTrigger}</span>
        <div className="settings-segmented" role="group" aria-label={t.toolbarTrigger}>
          <button
            type="button"
            className={settings.toolbarTrigger === 'auto' ? 'is-active' : ''}
            aria-pressed={settings.toolbarTrigger === 'auto'}
            onClick={() => onPatch({ toolbarTrigger: 'auto' })}
          >
            {t.triggerAuto}
          </button>
          <button
            type="button"
            className={settings.toolbarTrigger === 'hotkey' ? 'is-active' : ''}
            aria-pressed={settings.toolbarTrigger === 'hotkey'}
            onClick={() => onPatch({ toolbarTrigger: 'hotkey' })}
          >
            {t.triggerHotkey}
          </button>
        </div>
      </div>
      <div className="settings-mode-row">
        <span className="muted">{t.hotkey}</span>
        <HotkeyRecorder value={settings.summonHotkey} onChange={(v) => onPatch({ summonHotkey: v })} t={t} />
      </div>
    </div>
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
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
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
      if (!builtinIds.has(c.id as (typeof BUILTIN_CATEGORY_DEFAULTS)[number]['id'])) {
        await categoryRepository.delete(c.id);
      }
    }
    const records = await recordRepository.list();
    for (const record of records) {
      if (record.categoryId && !builtinIds.has(record.categoryId as (typeof BUILTIN_CATEGORY_DEFAULTS)[number]['id'])) {
        await recordRepository.save({ ...record, categoryId: null, updatedAt: now });
      }
    }
    onChanged();
    setResetConfirmOpen(false);
  };

  return (
    <div className="settings-subsection">
      <div className="spread">
        <div>
          <h2>{t.category}</h2>
        </div>
        <button onClick={() => setResetConfirmOpen(true)}>{t.resetBuiltinCategories}</button>
      </div>
      {resetConfirmOpen && (
        <SettingsInlineConfirm
          className="settings-category-confirm"
          title={t.resetBuiltinCategoriesTitle}
          body={t.confirmResetBuiltinCategories}
          confirmLabel={t.confirm}
          cancelLabel={t.cancel}
          onConfirm={resetBuiltinCategories}
          onCancel={() => setResetConfirmOpen(false)}
        />
      )}
      <div className="settings-category-row settings-row-header">
        <span>{t.colorHeader}</span>
        <span>{t.category}</span>
        <span>{t.order}</span>
        <span>{t.action}</span>
      </div>
      <div className="settings-category-list">
        {categoryRows.map((c) => {
          const displayName = categoryLabel(c, language);
          return (
            <div className="settings-category-row" key={c.id}>
              <ColorSwatchPicker
                value={c.color ?? '#94a3b8'}
                label={`${displayName} ${t.color}`}
                t={t}
                language={language}
                onChange={(color) => save(c, { color })}
              />
              <input
                key={`${c.id}:${c.updatedAt}:${displayName}`}
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
    </div>
  );
}

function SettingsInlineConfirm({
  className,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  className?: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();

  return (
    <div className={`settings-inline-confirm${className ? ` ${className}` : ''}`} role="alertdialog" aria-labelledby={titleId} aria-describedby={bodyId}>
      <div>
        <strong id={titleId}>{title}</strong>
        <p id={bodyId}>{body}</p>
      </div>
      <div className="settings-inline-confirm-actions">
        <button type="button" className="primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          {cancelLabel}
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
    <section className="card settings-section">
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
    <div className="settings-subsection">
      <h2>{t.displayAndRecords}</h2>
      <div className="settings-control-stack">
        <label className="settings-control-row">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.overlayEnabled}
            onChange={(e) => onPatch({ overlayEnabled: e.target.checked })}
          />
          {t.pageFrame}
        </label>
        <label className="settings-control-row">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={settings.copyTrayEnabled}
            onChange={(e) => onPatch({ copyTrayEnabled: e.target.checked })}
          />
          {t.copyTray}
        </label>
      </div>
      <div className="settings-display-group">
        <span className="muted">{t.roleColors}</span>
        <div className="settings-role-legend">
          {(Object.keys(ROLE_LABELS) as AssetRole[]).map((role) => (
            <div key={role} className="settings-role-color">
              <ColorSwatchPicker
                value={settings.roleColors[role]}
                label={`${roleLabel(role, language)} ${t.color}`}
                t={t}
                language={language}
                onChange={(color) => onPatch({ roleColors: { ...settings.roleColors, [role]: color } })}
              />
              <span>{roleLabel(role, language)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CardLayoutSettings({
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
  const inputPreviewPrompt =
    language === 'en-US'
      ? 'What the dog doing? What the dog doing? What the dog doing? What the dog doing? What the dog doing? What the dog doing? What the dog doing? What the dog doing?'
      : '我的刀盾，我的刀盾，我的刀盾，我的刀盾，我的刀盾，我的刀盾，我的刀盾，我的刀盾，我的刀盾，我的刀盾，我的刀盾，我的刀盾';
  const inputRoleLabel = language === 'en-US' ? 'Input' : '輸入';

  return (
    <div className="settings-subsection settings-card-layout-subsection">
      <h2>{t.cardRoleColumn}</h2>
      <div className="settings-card-layout-options" role="group" aria-label={t.cardRoleColumn}>
        <button
          type="button"
          className={`settings-card-layout-option${settings.cardLayout === 'split' ? ' is-selected' : ''}`}
          aria-pressed={settings.cardLayout === 'split'}
          onClick={() => onPatch({ cardLayout: 'split' })}
        >
          <span className="settings-real-layout-preview settings-real-layout-preview-split" aria-hidden="true">
            <span className="settings-real-preview-card">
              <span className="settings-real-preview-tag">生圖</span>
              <span className="settings-real-preview-cols">
                <span className="settings-real-preview-col">
                  <span className="settings-real-preview-label">
                    <span>{t.inputReference}</span>
                    <span>{t.copy}</span>
                  </span>
                  <span className="settings-real-preview-prompt">
                    <span className="settings-real-preview-role">{inputRoleLabel}</span>
                    <span>{inputPreviewPrompt}</span>
                  </span>
                </span>
                <span className="settings-real-preview-col">
                  <span className="settings-real-preview-label">
                    <span>{t.output}</span>
                    <span>{t.copy}</span>
                  </span>
                  <img src="/preview/card-layout-output.jpg" alt="" className="settings-real-preview-image" />
                </span>
              </span>
            </span>
          </span>
          <span className="settings-card-layout-label">{t.splitCard}</span>
        </button>
        <button
          type="button"
          className={`settings-card-layout-option${settings.cardLayout === 'input-only' ? ' is-selected' : ''}`}
          aria-pressed={settings.cardLayout === 'input-only'}
          onClick={() => onPatch({ cardLayout: 'input-only' })}
        >
          <span className="settings-real-layout-preview" aria-hidden="true">
            <span className="settings-real-preview-card settings-real-preview-card-input">
              <span className="settings-real-preview-tag">生文</span>
              <span className="settings-real-preview-label">
                <span>{t.inputReference}</span>
                <span>{t.copy}</span>
              </span>
              <span className="settings-real-preview-prompt">
                <span className="settings-real-preview-role">{inputRoleLabel}</span>
                <span>{inputPreviewPrompt}</span>
              </span>
            </span>
          </span>
          <span className="settings-card-layout-label">{t.inputOnly}</span>
        </button>
        <button
          type="button"
          className={`settings-card-layout-option${settings.cardLayout === 'output-only' ? ' is-selected' : ''}`}
          aria-pressed={settings.cardLayout === 'output-only'}
          onClick={() => onPatch({ cardLayout: 'output-only' })}
        >
          <span className="settings-real-layout-preview" aria-hidden="true">
            <span className="settings-real-preview-card settings-real-preview-card-output">
              <span className="settings-real-preview-tag">生圖</span>
              <span className="settings-real-preview-label">
                <span>{t.output}</span>
                <span>{t.copy}</span>
              </span>
              <img src="/preview/card-layout-output.jpg" alt="" className="settings-real-preview-image" />
            </span>
          </span>
          <span className="settings-card-layout-label">{t.outputOnly}</span>
        </button>
      </div>
    </div>
  );
}

function SummarySettingsSection({
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
  const summary = settings.summary;
  const provider = summary.provider;
  const knownModels = SUMMARY_PROVIDER_MODELS[provider];
  const currentModel = summary.models[provider] ?? '';
  const isCustomModel = currentModel.length > 0 && !knownModels.includes(currentModel);
  const [usageRecords, setUsageRecords] = useState<LibraryRecord[]>([]);
  const [systemPromptEdited, setSystemPromptEdited] = useState(false);
  const [pendingPromptLanguage, setPendingPromptLanguage] = useState<SummaryPromptLanguage | null>(null);

  useEffect(() => {
    let active = true;
    recordRepository.list().then((records) => {
      if (active) setUsageRecords(records);
    });
    return () => {
      active = false;
    };
  }, []);

  const usageStats = summaryUsageStats(usageRecords);

  const patchSummary = (patch: Partial<typeof summary>) => {
    onPatch({ summary: { ...summary, ...patch } });
  };

  const updateProvider = (nextProvider: SummaryProvider) => {
    patchSummary({
      provider: nextProvider,
      models: {
        ...summary.models,
        [nextProvider]: summary.models[nextProvider] ?? SUMMARY_PROVIDER_MODELS[nextProvider][0],
      },
    });
  };

  const updateModel = (value: string) => {
    patchSummary({
      models: {
        ...summary.models,
        [provider]: value === '__custom' ? '' : value,
      },
    });
  };
  const applyDefaultPrompt = (promptLanguage: SummaryPromptLanguage) => {
    setSystemPromptEdited(true);
    patchSummary({
      systemPrompt: defaultSummarySystemPrompt(promptLanguage),
      systemPromptCustomized: false,
    });
    setPendingPromptLanguage(null);
  };

  return (
    <section className="card settings-section settings-summary-section">
      <div className="spread">
        <h2>{t.summary}</h2>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={summary.enabled}
            onChange={(e) => patchSummary({ enabled: e.target.checked })}
          />
          {t.enabled}
        </label>
      </div>
      <div className="settings-summary-config-row">
        <div className="settings-summary-config-panel">
          <label className="settings-field">
            <span className="muted">{t.provider}</span>
            <select value={provider} onChange={(e) => updateProvider(e.target.value as SummaryProvider)}>
              {(Object.keys(SUMMARY_PROVIDER_LABELS) as SummaryProvider[]).map((item) => (
                <option key={item} value={item}>
                  {SUMMARY_PROVIDER_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span className="muted">{t.model}</span>
            <select value={isCustomModel ? '__custom' : currentModel} onChange={(e) => updateModel(e.target.value)}>
              {knownModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              <option value="__custom">{t.custom}</option>
            </select>
          </label>
          <label className="settings-field">
            <span className="muted">API key</span>
            <input
              type="password"
              value={summary.apiKeys[provider] ?? ''}
              placeholder={t.apiKeyPlaceholder}
              onChange={(e) =>
                patchSummary({
                  apiKeys: {
                    ...summary.apiKeys,
                    [provider]: e.target.value,
                  },
                })
              }
            />
          </label>
          {isCustomModel || currentModel === '' ? (
            <label className="settings-field">
              <span className="muted">{t.customModel}</span>
              <input
                value={currentModel}
                placeholder={t.exampleModel}
                onChange={(e) =>
                  patchSummary({
                    models: {
                      ...summary.models,
                      [provider]: e.target.value,
                    },
                  })
                }
              />
            </label>
          ) : (
            <div className="settings-field settings-saved-key-row">
              <span className="muted">{t.savedApiKey}</span>
              <span className="settings-secret-preview">{maskApiKey(summary.apiKeys[provider]) || t.apiKeyNotSet}</span>
            </div>
          )}
        </div>
        <div className="settings-summary-config-panel">
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={summary.autoEnabled}
              onChange={(e) => patchSummary({ autoEnabled: e.target.checked })}
            />
            {t.autoSummary}
          </label>
          <div
            className={`settings-summary-schedule-fields${summary.autoEnabled ? '' : ' is-disabled'}`}
            aria-disabled={!summary.autoEnabled}
          >
            <label className="settings-field">
              <span className="muted">{t.scanIntervalMinutes}</span>
              <input
                type="number"
                min={1}
                value={summary.scanIntervalMinutes}
                disabled={!summary.autoEnabled}
                onChange={(e) => patchSummary({ scanIntervalMinutes: Number(e.target.value) })}
                placeholder={t.exampleMinutes}
              />
            </label>
            <label className="settings-field">
              <span className="muted">{t.maxPerRun}</span>
              <input
                type="number"
                min={1}
                max={50}
                value={summary.maxPerRun}
                disabled={!summary.autoEnabled}
                onChange={(e) => patchSummary({ maxPerRun: Number(e.target.value) })}
              />
            </label>
            <label className="settings-field">
              <span className="muted">{t.timeoutSeconds}</span>
              <input
                type="number"
                min={5}
                max={120}
                value={Math.round(summary.timeoutMs / 1000)}
                disabled={!summary.autoEnabled}
                onChange={(e) => patchSummary({ timeoutMs: Number(e.target.value) * 1000 })}
              />
            </label>
          </div>
        </div>
      </div>
      <div className="settings-inner-divider" />
      <label className="settings-field settings-field-full">
        <span className="settings-field-title-row">
          <span className="muted">{t.systemPrompt}</span>
          {systemPromptEdited && <span className="settings-save-state">{t.saved.replace(/[.。]$/, '')}</span>}
        </span>
        <textarea
          rows={6}
          value={summary.systemPrompt}
          onChange={(e) => {
            setSystemPromptEdited(true);
            patchSummary({ systemPrompt: e.target.value, systemPromptCustomized: true });
          }}
        />
      </label>
      <div className="settings-prompt-confirm-anchor">
        {pendingPromptLanguage && (
          <SettingsInlineConfirm
            className="settings-summary-confirm"
            title={t.applyDefaultPromptTitle}
            body={t.confirmApplyDefaultPrompt}
            confirmLabel={t.confirm}
            cancelLabel={t.cancel}
            onConfirm={() => applyDefaultPrompt(pendingPromptLanguage)}
            onCancel={() => setPendingPromptLanguage(null)}
          />
        )}
        <div className="row settings-prompt-actions">
          <button type="button" onClick={() => setPendingPromptLanguage('zh-TW')}>
            {t.applyTraditionalChinesePrompt}
          </button>
          <button type="button" onClick={() => setPendingPromptLanguage('zh-CN')}>
            {t.applySimplifiedChinesePrompt}
          </button>
          <button type="button" onClick={() => setPendingPromptLanguage('en-US')}>
            {t.applyEnglishPrompt}
          </button>
        </div>
      </div>
      <div className="settings-inner-divider" />
      <div className="settings-summary-dashboard">
        <div className="settings-summary-dashboard-head">
          <h2>{t.tokenDashboard}</h2>
        </div>
        <div className="settings-summary-metric-group">
          <h3>{t.today}</h3>
          <div className="settings-summary-metrics">
            <div>
              <span className="muted">{t.summaryRuns}</span>
              <strong>{usageStats.todayEvents.length}</strong>
            </div>
            <div>
              <span className="muted">{t.withUsage}</span>
              <strong>{usageStats.todayEventsWithUsage.length}</strong>
            </div>
            <div>
              <span className="muted">{t.inputToken}</span>
              <strong>{formatTokenCount(usageStats.todayTotals.input, language)}</strong>
            </div>
            <div>
              <span className="muted">{t.outputToken}</span>
              <strong>{formatTokenCount(usageStats.todayTotals.output, language)}</strong>
            </div>
            <div>
              <span className="muted">{t.totalToken}</span>
              <strong>{formatTokenCount(usageStats.todayTotals.total, language)}</strong>
            </div>
          </div>
        </div>
        <div className="settings-summary-metric-group">
          <h3>{t.allTime}</h3>
          <div className="settings-summary-metrics">
            <div>
              <span className="muted">{t.summaryRuns}</span>
              <strong>{usageStats.events.length}</strong>
            </div>
            <div>
              <span className="muted">{t.withUsage}</span>
              <strong>{usageStats.eventsWithUsage.length}</strong>
            </div>
            <div>
              <span className="muted">{t.inputToken}</span>
              <strong>{formatTokenCount(usageStats.totals.input, language)}</strong>
            </div>
            <div>
              <span className="muted">{t.outputToken}</span>
              <strong>{formatTokenCount(usageStats.totals.output, language)}</strong>
            </div>
            <div>
              <span className="muted">{t.totalToken}</span>
              <strong>{formatTokenCount(usageStats.totals.total, language)}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatTokenCount(value: number, language: ResolvedLanguage): string {
  return value.toLocaleString(language);
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mediaExtension(asset: Asset, blob?: Blob): string {
  if (blob?.type === 'image/webp') return 'webp';
  if (blob?.type === 'image/jpeg') return 'jpg';
  if (blob?.type === 'image/png') return 'png';
  if (blob?.type === 'video/webm') return 'webm';
  if (blob?.type === 'video/mp4') return 'mp4';
  return asset.assetType === 'image' ? 'png' : 'mp4';
}

async function blobFromRef(ref: string | undefined): Promise<{ blob: Blob; source: BackupMediaEntry['source'] } | null> {
  if (!ref) return null;
  if (ref.startsWith('data:')) {
    return { blob: await (await fetch(ref)).blob(), source: 'data-url' };
  }
  if (/^https?:/i.test(ref)) {
    try {
      return { blob: await (await fetch(ref)).blob(), source: 'original' };
    } catch {
      return null;
    }
  }
  return null;
}

async function mediaBlobForBackup(asset: Asset): Promise<{ blob: Blob; source: BackupMediaEntry['source'] } | null> {
  return (await blobFromRef(asset.originalUrl)) ?? (await blobFromRef(asset.previewRef));
}

async function exportPromptTraceBackup(): Promise<{ records: number; mediaFiles: number }> {
  const [records, assets, originalFileRecords, tags, categories] = await Promise.all([
    recordRepository.list(),
    assetRepository.list(),
    fileRecordRepository.list(),
    tagRepository.list(),
    categoryRepository.list(),
  ]);
  const originalFileByAsset = new Map<string, FileRecord>();
  for (const fileRecord of originalFileRecords) {
    if (!originalFileByAsset.has(fileRecord.assetId)) originalFileByAsset.set(fileRecord.assetId, fileRecord);
  }

  const fileRecords = new Map<string, FileRecord>();
  for (const fileRecord of originalFileRecords) {
    fileRecords.set(fileRecord.id, {
      ...sanitizeBackupFileRecord(fileRecord),
      downloadStatus: 'not_required',
    });
  }

  const media: BackupMediaEntry[] = [];
  const mediaFiles = new Map<string, Blob>();
  for (const asset of assets) {
    if (asset.assetType === 'text') continue;
    const mediaBlob = await mediaBlobForBackup(asset);
    if (!mediaBlob) continue;
    const existing = originalFileByAsset.get(asset.id);
    const fileRecord: FileRecord = existing
      ? sanitizeBackupFileRecord(existing)
      : {
          id: `backup-file-${asset.id}`,
          assetId: asset.id,
          filename: `${asset.id}.${mediaExtension(asset, mediaBlob.blob)}`,
          downloadStatus: 'pending',
          deleteStatus: 'not_deleted',
          updatedAt: new Date().toISOString(),
        };
    const filename = existing?.filename ?? fileRecord.filename;
    const path = `media/${asset.recordId}/${filename}`;
    fileRecords.set(fileRecord.id, {
      ...fileRecord,
      filename,
      downloadStatus: 'pending',
      mimeType: mediaBlob.blob.type || fileRecord.mimeType,
      fileSize: mediaBlob.blob.size,
    });
    media.push({
      assetId: asset.id,
      fileRecordId: fileRecord.id,
      recordId: asset.recordId,
      path,
      filename,
      mimeType: mediaBlob.blob.type || undefined,
      source: mediaBlob.source,
    });
    mediaFiles.set(path, mediaBlob.blob);
  }

  const zip = await createPromptTraceBackupZip(
    {
      records,
      assets,
      fileRecords: Array.from(fileRecords.values()),
      tags,
      categories,
      media,
    },
    mediaFiles,
  );
  downloadBlob(backupFilename(), zip);
  return { records: records.length, mediaFiles: mediaFiles.size };
}

async function restorePromptTraceBackup(file: File): Promise<{ records: number; mediaFiles: number }> {
  const parsed = await parsePromptTraceBackupZip(file);
  const mediaByFileRecord = new Map(parsed.data.media.map((entry) => [entry.fileRecordId, entry]));

  for (const category of parsed.data.categories ?? []) await categoryRepository.save(category);
  for (const record of parsed.data.records) await recordRepository.save(record);
  for (const asset of parsed.data.assets) await assetRepository.save(asset);
  for (const tag of parsed.data.tags ?? []) await tagRepository.save(tag);

  let restoredMedia = 0;
  for (const fileRecord of parsed.data.fileRecords ?? []) {
    const mediaEntry = mediaByFileRecord.get(fileRecord.id);
    const mediaFile = mediaEntry ? parsed.files.get(mediaEntry.path) : undefined;
    const baseRecord: FileRecord = {
      ...fileRecord,
      localPath: undefined,
      downloadId: undefined,
      downloadStatus: mediaFile ? 'pending' : 'not_required',
      updatedAt: new Date().toISOString(),
    };
    await fileRecordRepository.save(baseRecord);
    if (!mediaEntry || !mediaFile) continue;

    const url = URL.createObjectURL(mediaFile);
    try {
      const downloadId = await chrome.downloads.download({
        url,
        filename: promptTraceBackupMediaDownloadFilename(mediaEntry),
        conflictAction: 'uniquify',
        saveAs: false,
      });
      await fileRecordRepository.save({
        ...baseRecord,
        downloadId,
        downloadStatus: 'downloading',
        updatedAt: new Date().toISOString(),
      });
      restoredMedia += 1;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  return { records: parsed.data.records.length, mediaFiles: restoredMedia };
}

function DataFilesSettingsSection({ t }: { t: UiText }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  return (
    <div className="settings-subsection settings-files-subsection">
      <h2>{t.files}</h2>
      <div className="row settings-file-actions">
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
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStatus('');
            try {
              const result = await exportPromptTraceBackup();
              setStatus(t.backupExported.replace('{records}', String(result.records)).replace('{media}', String(result.mediaFiles)));
            } catch {
              setStatus(t.backupExportFailed);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t.processing : t.exportBackup}
        </button>
        <label className="button-like">
          {t.importBackup}
          <input
            type="file"
            accept=".zip,application/zip"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (!file) return;
              setBusy(true);
              setStatus('');
              try {
                const result = await restorePromptTraceBackup(file);
                setStatus(t.backupImported.replace('{records}', String(result.records)).replace('{media}', String(result.mediaFiles)));
              } catch {
                setStatus(t.backupImportFailed);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </div>
      {status && <p className="muted">{status}</p>}
    </div>
  );
}

const PROMPTRACE_FOLDER_REGEX = 'PrompTrace|PromptTrace';
const PROMPTTRACE_ROOT_FILE_REGEX = `[\\\\/](${PROMPTRACE_FOLDER_REGEX})[\\\\/][^\\\\/]+$`;
const PROMPTTRACE_FILE_REGEX = `[\\\\/](${PROMPTRACE_FOLDER_REGEX})[\\\\/]`;

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

