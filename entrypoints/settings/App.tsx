import { useEffect, useId, useState } from 'react';
import type { Asset, LibraryRecord, RecordCategory } from '@/src/core/domain/entities';
import {
  backupFilename,
  createPromptTraceBackupZip,
  parsePromptTraceBackupZip,
  promptTraceBackupMediaPath,
  type BackupMediaEntry,
} from '@/src/core/backup/archive';
import { bytesToDataUrl, dataUrlToBlob, IMAGE_PREVIEW_MAX_BYTES, validateCanonicalPreviewRef } from '@/src/core/media/dataUrl';
import { formatMediaAssetTotalSize, summarizeMediaAssetStorage } from '@/src/core/media/storageSize';
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
  recordRepository,
  tagRepository,
} from '@/src/storage/repositories';
import { prepareBackupRestore, restorePreparedBackup } from '@/src/storage/backupRestore';
import { BUILTIN_CATEGORY_DEFAULTS } from '@/src/storage/seed';
import { categoryLabel, resolveLanguage, roleLabel, UI_TEXT, type ResolvedLanguage, type UiText } from '@/src/ui/i18n';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type DisplaySettings } from '@/src/ui/roleColors';
import { PrompTraceWordmark } from '@/src/ui/PrompTraceWordmark';
import { useTaxonomy } from '@/src/ui/hooks';

const KOFI_URL = 'https://ko-fi.com/lazydoooog';

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
// End of settings page sections.
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
        <h1><PrompTraceWordmark className="settings-wordmark" /> <span>{t.settings}</span></h1>
        <a className="settings-support-link" href={KOFI_URL} target="_blank" rel="noreferrer">
          <span>{language === 'en-US' ? 'Support ' : '支持 '}<PrompTraceWordmark className="settings-support-wordmark" /></span>
          <strong>{t.buyMeCoffee}</strong>
        </a>
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
            <DataFilesSettingsSection
              settings={settings}
              onPatch={patchSettings}
              t={t}
            />
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
          aria-label={t.interfaceLanguage}
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
      <InteractionSettings settings={settings} onPatch={onPatch} t={t} />
      <div className="settings-dashed-divider" />
      <DisplaySettingsSection settings={settings} onPatch={onPatch} t={t} language={language} />
    </>
  );
}

function InteractionSettings({
  settings,
  onPatch,
  t,
}: {
  settings: DisplaySettings;
  onPatch: (p: Partial<DisplaySettings>) => void;
  t: UiText;
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
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  const [movingCategoryId, setMovingCategoryId] = useState<string | null>(null);
  const categoryRows = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  const save = async (c: RecordCategory, patch: Partial<RecordCategory>) => {
    await categoryRepository.save({ ...c, ...patch, updatedAt: new Date().toISOString() });
    onChanged();
  };

  const moveCategory = async (category: RecordCategory, direction: -1 | 1) => {
    if (movingCategoryId) return;
    const index = categoryRows.findIndex((item) => item.id === category.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= categoryRows.length) return;

    setMovingCategoryId(category.id);
    setHoverSuppressed(true);
    const reordered = [...categoryRows];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    const updatedAt = new Date().toISOString();
    try {
      await Promise.all(
        reordered.map((item, sortOrder) =>
          categoryRepository.save({ ...item, sortOrder, updatedAt }),
        ),
      );
      onChanged();
    } finally {
      setMovingCategoryId(null);
    }
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
      <div
        className="settings-category-list"
        data-hover-suppressed={hoverSuppressed ? 'true' : undefined}
        aria-busy={movingCategoryId !== null}
        onPointerMove={() => setHoverSuppressed(false)}
      >
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
                aria-label={`${t.category}: ${displayName}`}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  const v = validateCategoryName(name);
                  if (v.ok && name !== displayName) save(c, { name });
                }}
              />
              <div className="settings-compact-actions">
                <button
                  aria-label={t.moveUp}
                  aria-disabled={movingCategoryId !== null}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => moveCategory(c, -1)}
                  title={t.moveUp}
                >
                  ↑
                </button>
                <button
                  aria-label={t.moveDown}
                  aria-disabled={movingCategoryId !== null}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => moveCategory(c, 1)}
                  title={t.moveDown}
                >
                  ↓
                </button>
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
            aria-label={t.newCategoryName}
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
      <div className="settings-inner-divider settings-token-dashboard-divider" />
      <div className="settings-summary-dashboard">
        <div className="settings-summary-dashboard-head">
          <div className="settings-summary-dashboard-title">
            <h2>{t.tokenDashboard}</h2>
          </div>
          <label className="settings-field settings-token-limit-field">
            <span className="settings-token-limit-title">
              <span className="muted">{t.dailyTokenLimit}</span>
              <span className="muted settings-token-limit-hint">{t.dailyTokenLimitHint}</span>
            </span>
            <input
              type="number"
              min={0}
              step={100}
              value={summary.dailyTokenLimit}
              onChange={(e) => patchSummary({ dailyTokenLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              placeholder="0"
            />
          </label>
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

async function exportPromptTraceBackup(): Promise<{ records: number; mediaFiles: number }> {
  const [records, assets, tags, categories] = await Promise.all([
    recordRepository.list(),
    assetRepository.list(),
    tagRepository.list(),
    categoryRepository.list(),
  ]);
  const media: BackupMediaEntry[] = [];
  const mediaFiles = new Map<string, Blob>();
  for (const asset of assets) {
    if (asset.assetType === 'text' || !asset.previewRef?.startsWith('data:')) continue;
    let canonicalPreviewRef = asset.previewRef;
    try {
      validateCanonicalPreviewRef(canonicalPreviewRef, asset.assetType);
    } catch {
      canonicalPreviewRef = await canonicalizeRestoreMedia(asset, dataUrlToBlob(canonicalPreviewRef));
    }
    const blob = dataUrlToBlob(canonicalPreviewRef);
    const path = promptTraceBackupMediaPath({
      recordId: asset.recordId,
      assetId: asset.id,
      mimeType: blob.type || (asset.assetType === 'image' ? 'image/webp' : 'image/gif'),
    });
    media.push({ assetId: asset.id, recordId: asset.recordId, path, mimeType: blob.type || undefined });
    mediaFiles.set(path, blob);
  }

  const zip = await createPromptTraceBackupZip(
    { records, assets, tags, categories, media },
    mediaFiles,
  );
  downloadBlob(backupFilename(), zip);
  return { records: records.length, mediaFiles: mediaFiles.size };
}

async function canonicalizeRestoreMedia(asset: Asset, source: Blob): Promise<string> {
  if (asset.assetType === 'image') {
    const bitmap = await createImageBitmap(source);
    try {
      for (const profile of [
        { maxDimension: 768, quality: 0.82 },
        { maxDimension: 512, quality: 0.72 },
        { maxDimension: 320, quality: 0.62 },
      ]) {
        const scale = Math.min(1, profile.maxDimension / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.round((bitmap.width * scale) / 2) * 2);
        canvas.height = Math.max(2, Math.round((bitmap.height * scale) / 2) * 2);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('MEDIA_PREVIEW_CANVAS_UNAVAILABLE');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', profile.quality));
        if (output && output.size <= IMAGE_PREVIEW_MAX_BYTES) {
          const previewRef = bytesToDataUrl(new Uint8Array(await output.arrayBuffer()), 'image/webp');
          validateCanonicalPreviewRef(previewRef, 'image');
          return previewRef;
        }
      }
    } finally {
      bitmap.close();
    }
    throw new Error('MEDIA_PREVIEW_TOO_LARGE');
  }

  const sourceUrl = bytesToDataUrl(new Uint8Array(await source.arrayBuffer()), source.type || 'video/mp4');
  const result = await chrome.runtime.sendMessage({
    type: 'media/generateVideoPreview',
    payload: { url: sourceUrl },
  });
  if (!result?.ok || !result.previewRef) throw new Error(result?.reason ?? 'MEDIA_VIDEO_PREVIEW_FAILED');
  validateCanonicalPreviewRef(result.previewRef, 'video');
  return result.previewRef;
}
async function restorePromptTraceBackup(file: File): Promise<{ records: number; mediaFiles: number }> {
  const parsed = await parsePromptTraceBackupZip(file);
  const prepared = await prepareBackupRestore(parsed, canonicalizeRestoreMedia);
  await restorePreparedBackup(prepared.data);
  return { records: prepared.data.records.length, mediaFiles: prepared.restoredMedia };
}

function DataFilesSettingsSection({
  settings,
  onPatch,
  t,
}: {
  settings: DisplaySettings;
  onPatch: (patch: Partial<DisplaySettings>) => void;
  t: UiText;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [mediaStorage, setMediaStorage] = useState<{ assetCount: number; totalBytes: number } | null>();

  useEffect(() => {
    let cancelled = false;
    const loadMediaStorage = async () => {
      try {
        const assets = await assetRepository.list();
        if (!cancelled) setMediaStorage(summarizeMediaAssetStorage(assets));
      } catch {
        if (!cancelled) setMediaStorage(null);
      }
    };
    loadMediaStorage();
    return () => {
      cancelled = true;
    };
  }, []);

  const qualityOptions: Array<{
    value: DisplaySettings['mediaQuality'];
    label: string;
    detail: string;
  }> = [
    { value: 'low', label: t.previewQualityLow, detail: t.previewQualityLowDetail },
    { value: 'medium', label: t.previewQualityMedium, detail: t.previewQualityMediumDetail },
    { value: 'high', label: t.previewQualityHigh, detail: t.previewQualityHighDetail },
  ];

  return (
    <div className="settings-subsection settings-files-subsection">
      <h2>{t.files}</h2>
      <fieldset className="settings-field settings-media-quality-field" aria-describedby="settings-media-quality-hint">
        <legend>{t.previewQuality}</legend>
        <div className="settings-media-quality-options" role="radiogroup" aria-label={t.previewQuality}>
          {qualityOptions.map((option) => {
            const selected = settings.mediaQuality === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${option.label} · ${option.detail}`}
                className={`settings-media-quality-option${selected ? ' is-selected' : ''}`}
                onClick={() => onPatch({ mediaQuality: option.value })}
              >
                <span className="settings-media-quality-label">{option.label}</span>
                <span className="settings-media-quality-detail">{option.detail}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <p id="settings-media-quality-hint" className="muted settings-media-quality-hint">{t.previewQualityHint}</p>
      <div
        className="settings-storage-usage"
        data-testid="media-asset-storage"
        aria-live="polite"
        title={t.mediaAssetStorageHint}
      >
        <span>{t.mediaAssetStorage}</span>
        {mediaStorage === undefined ? (
          <span className="muted">{t.loading}</span>
        ) : mediaStorage ? (
          <strong>
            {formatMediaAssetTotalSize(mediaStorage.totalBytes)}
            <span className="settings-storage-separator" aria-hidden="true">·</span>
            {t.mediaAssetCount.replace('{count}', String(mediaStorage.assetCount))}
          </strong>
        ) : (
          <span className="muted">{t.mediaAssetStorageUnavailable}</span>
        )}
      </div>
      <div className="row settings-file-actions">
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
// EOF
export {};
