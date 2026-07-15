import {
  addAsset,
  addConflict,
  addError,
  assignRole,
  dismissError,
  emptySession,
  removeAsset,
  resolveConflict,
  type CaptureSessionState,
} from '@/src/core/capture/session';
import { checkSelection } from '@/src/core/capture/overlap';
import type { Asset, PendingAsset } from '@/src/core/domain/entities';
import { isRoleAllowed } from '@/src/core/domain/validation';
import { createConflict } from '@/src/core/errors/conflictTypes';
import { createCaptureError } from '@/src/core/errors/errorTypes';
import type { ExtensionMessage, GenerateVideoPreviewResult, MediaPreviewChangedMessage } from '@/src/core/messages';
import {
  bytesToDataUrl,
  IMAGE_PREVIEW_MAX_BYTES,
  isDataUrl,
  parseDataUrl,
  validateCanonicalPreviewRef,
} from '@/src/core/media/dataUrl';
import {
  DEFAULT_MEDIA_QUALITY,
  mediaQualityProfileFor,
  normalizeMediaQuality,
  type MediaQuality,
} from '@/src/core/media/quality';
import { requestPromptSummary, selectedSummaryModel, summaryPromptTextFromAssets } from '@/src/core/summary';
import { isSummaryDailyTokenLimitReached } from '@/src/core/summaryUsage';
import { commitSessionToLibrary, isDownloadableUrl } from '@/src/storage/commitSession';
import {
  assetRepository,
  categoryRepository,
  claimNextPreviewJob,
  completePreviewJob,
  deleteRecordCascade,
  failPreviewJob,
  purgeExpiredTrash,
  recordRepository,
  renewPreviewJob,
} from '@/src/storage/repositories';
import { seedDefaults } from '@/src/storage/seed';
import { resolveLanguage, UI_TEXT } from '@/src/ui/i18n';
import { loadSettings, onSettingsChanged } from '@/src/ui/roleColors';

const MENU_TEXT = 'prompttrace-add-selection';
const MENU_IMAGE = 'prompttrace-add-image';
const MENU_VIDEO = 'prompttrace-add-video';
const SUMMARY_ALARM = 'prompttrace-summary-auto';
const TRASH_ALARM = 'prompttrace-trash-auto-purge';

export default defineBackground(() => {
  let session: CaptureSessionState = emptySession();
  /** Conflict id → candidate pending asset waiting for resolution. */
  const conflictCandidates = new Map<string, PendingAsset>();

  function broadcast(): void {
    const msg: ExtensionMessage = { type: 'capture/sessionUpdated', payload: { state: session } };
    chrome.runtime.sendMessage(msg).catch(() => {});
    chrome.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id != null) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    });
  }

  function setSession(next: CaptureSessionState): void {
    session = next;
    broadcast();
  }

  async function menuTitles() {
    const settings = await loadSettings();
    return UI_TEXT[resolveLanguage(settings.language)];
  }

  async function createContextMenus(): Promise<void> {
    const t = await menuTitles();
    chrome.contextMenus.create({ id: MENU_TEXT, title: t.contextAddSelection, contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_IMAGE, title: t.contextAddImage, contexts: ['image'] });
    chrome.contextMenus.create({ id: MENU_VIDEO, title: t.contextAddVideo, contexts: ['video'] });
  }

  async function syncSummaryAlarm(): Promise<void> {
    const settings = await loadSettings();
    await chrome.alarms.clear(SUMMARY_ALARM);
    if (!settings.summary.enabled || !settings.summary.autoEnabled) return;
    chrome.alarms.create(SUMMARY_ALARM, {
      periodInMinutes: Math.max(1, settings.summary.scanIntervalMinutes),
      delayInMinutes: Math.max(1, settings.summary.scanIntervalMinutes),
    });
  }

  async function purgeExpiredTrashNow(): Promise<{ deletedCount: number }> {
    const settings = await loadSettings();
    const result = await purgeExpiredTrash(settings.trashRetentionDays);
    return { deletedCount: result.recordIds.length };
  }

  async function syncTrashAlarm(): Promise<void> {
    await chrome.alarms.clear(TRASH_ALARM);
    chrome.alarms.create(TRASH_ALARM, {
      periodInMinutes: 24 * 60,
      delayInMinutes: 5,
    });
  }

  function updateContextMenus(): void {
    menuTitles()
      .then((t) => {
        try {
          chrome.contextMenus.update(MENU_TEXT, { title: t.contextAddSelection });
          chrome.contextMenus.update(MENU_IMAGE, { title: t.contextAddImage });
          chrome.contextMenus.update(MENU_VIDEO, { title: t.contextAddVideo });
        } catch {
          // Context menus may not exist yet in a freshly reloaded service worker.
        }
      })
      .catch(() => {});
  }

  // ---------- setup ----------
  chrome.runtime.onInstalled.addListener(() => {
    createContextMenus().catch(() => {});
    seedDefaults().catch((e) => console.error('[PrompTrace] seed failed', e));
    syncSummaryAlarm().catch(() => {});
    syncTrashAlarm().catch(() => {});
    purgeExpiredTrashNow().catch(() => {});
    processPreviewJobs().catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => {
    syncSummaryAlarm().catch(() => {});
    syncTrashAlarm().catch(() => {});
    purgeExpiredTrashNow().catch(() => {});
    processPreviewJobs().catch(() => {});
  });
  onSettingsChanged(() => {
    updateContextMenus();
    syncSummaryAlarm().catch(() => {});
    syncTrashAlarm().catch(() => {});
  });
  seedDefaults().catch(() => {});
  processPreviewJobs().catch(() => {});

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SUMMARY_ALARM) runAutoSummary().catch(() => {});
    if (alarm.name === TRASH_ALARM) purgeExpiredTrashNow().catch(() => {});
  });

  // Browser-level shortcut: overrides page key handlers, rebindable at
  // chrome://extensions/shortcuts.
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'summon-toolbar') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: 'toolbar/summon' }).catch(() => {});
    }
  });

  // ---------- context menu capture ----------
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === MENU_TEXT) {
      // Ask the content script for selection details and overlap information.
      chrome.tabs
        .sendMessage(tab.id, { type: 'capture/captureSelection' })
        .catch(() => {
          // No content script (e.g. chrome:// pages): fall back to plain selectionText.
          if (info.selectionText) {
            handleCreatePendingAsset({
              tabId: tab.id,
              pageUrl: info.pageUrl ?? tab.url ?? '',
              pageTitle: tab.title ?? '',
              assetType: 'text',
              textContent: info.selectionText,
              capturedAt: new Date().toISOString(),
            });
          }
        });
      return;
    }

    const assetType = info.menuItemId === MENU_IMAGE ? 'image' : 'video';
    if (info.menuItemId === MENU_IMAGE || info.menuItemId === MENU_VIDEO) {
      if (!info.srcUrl) {
        // Typical for blob/MSE/DRM players: no usable URL.
        setSession(
          addError(
            session,
            createCaptureError('MEDIA_URL_NOT_FOUND', 'background/contextMenu', {
              sourceUrl: info.pageUrl,
              canSaveSourceOnly: true,
              canRetry: false,
            }),
          ),
        );
        return;
      }
      handleCreatePendingAsset({
        tabId: tab.id,
        pageUrl: info.pageUrl ?? tab.url ?? '',
        pageTitle: tab.title ?? '',
        assetType,
        originalUrl: info.srcUrl,
        capturedAt: new Date().toISOString(),
      });
    }
  });

  // ---------- pending asset creation ----------
  function handleCreatePendingAsset(
    payload: Extract<ExtensionMessage, { type: 'capture/createPendingAsset' }>['payload'],
  ): void {
    if (payload.assetType !== 'text' && !payload.originalUrl) {
      // Keyboard/media capture on blob・MSE・DRM players: no usable URL.
      setSession(
        addError(
          session,
          createCaptureError('MEDIA_URL_NOT_FOUND', 'background/capture', {
            sourceUrl: payload.pageUrl,
            canSaveSourceOnly: true,
            canRetry: false,
          }),
        ),
      );
      return;
    }
    const check = checkSelection(session.assets, payload, payload.domOverlapWith);
    if (check.kind === 'duplicate') {
      const existing = session.assets.find((a) => a.id === check.existingId);
      setSession(
        addConflict(
          session,
          createConflict('DUPLICATE_SELECTION', {
            existingAssetId: check.existingId,
            existingPreview: preview(existing),
            newPreview: preview(payload),
          }),
        ),
      );
      return;
    }

    const requestedRole =
      payload.role && isRoleAllowed(payload.assetType, payload.role) ? payload.role : null;
    const asset: PendingAsset = {
      id: crypto.randomUUID(),
      assetType: payload.assetType,
      role: requestedRole,
      textContent: payload.textContent,
      originalUrl: payload.originalUrl,
      pageUrl: payload.pageUrl,
      pageTitle: payload.pageTitle,
      tabId: payload.tabId,
      capturedAt: payload.capturedAt,
    };

    if (check.kind === 'overlap') {
      const existing = session.assets.find((a) => a.id === check.existingId);
      const conflict = createConflict('OVERLAPPING_SELECTION', {
        existingAssetId: check.existingId,
        existingPreview: preview(existing),
        newPreview: preview(payload),
      });
      conflictCandidates.set(conflict.id, asset);
      setSession(addConflict(session, conflict));
      return;
    }

    setSession(addAsset(session, asset));
    if (payload.tabId != null) {
      chrome.tabs
        .sendMessage(payload.tabId, { type: 'capture/assetAdded', payload: { asset } })
        .catch(() => {});
    }
  }

  function preview(a?: { textContent?: string; originalUrl?: string } | null): string {
    if (!a) return '';
    return (a.textContent ?? a.originalUrl ?? '').slice(0, 120);
  }

  let creatingOffscreenDocument: Promise<void> | undefined;

  async function ensureOffscreenDocument(): Promise<void> {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [offscreenUrl],
    });
    if (contexts.length > 0) return;
    if (!creatingOffscreenDocument) {
      creatingOffscreenDocument = chrome.offscreen
        .createDocument({
          url: 'offscreen.html',
          reasons: [chrome.offscreen.Reason.BLOBS],
          justification: 'Decode locally downloaded videos and create short GIF previews.',
        })
        .finally(() => {
          creatingOffscreenDocument = undefined;
        });
    }
    await creatingOffscreenDocument;
  }

  async function encodeImagePreview(source: string, quality: MediaQuality): Promise<string> {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`MEDIA_PREVIEW_FETCH_${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const normalizedQuality = normalizeMediaQuality(quality);
      const fallbackQualities: MediaQuality[] = normalizedQuality === 'high'
        ? ['high', 'medium', 'low']
        : normalizedQuality === 'medium'
          ? ['medium', 'low']
          : ['low'];
      const selectedProfiles = fallbackQualities.map((candidate) => mediaQualityProfileFor(candidate).image);
      for (const profile of [
        ...selectedProfiles,
        { maxDimension: 512, quality: 0.72 },
        { maxDimension: 320, quality: 0.62 },
      ]) {
        const scale = Math.min(1, profile.maxDimension / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(2, Math.round((bitmap.width * scale) / 2) * 2);
        const height = Math.max(2, Math.round((bitmap.height * scale) / 2) * 2);
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('MEDIA_PREVIEW_CANVAS_UNAVAILABLE');
        context.drawImage(bitmap, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: profile.quality });
        if (blob.size <= IMAGE_PREVIEW_MAX_BYTES) {
          const previewRef = bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), 'image/webp');
          validateCanonicalPreviewRef(previewRef, 'image');
          return previewRef;
        }
      }
    } finally {
      bitmap.close();
    }
    throw new Error('MEDIA_PREVIEW_TOO_LARGE');
  }

  async function generateVideoPreview(source: string, quality: MediaQuality): Promise<string> {
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage<ExtensionMessage, GenerateVideoPreviewResult>({
      type: 'media/generateVideoPreview',
      payload: { url: source, quality },
    });
    if (!result.ok || !result.previewRef) throw new Error(result.reason ?? 'MEDIA_VIDEO_PREVIEW_FAILED');
    validateCanonicalPreviewRef(result.previewRef, 'video');
    return result.previewRef;
  }

  async function preparePendingAssets(
    assets: PendingAsset[],
    quality: MediaQuality = DEFAULT_MEDIA_QUALITY,
  ): Promise<PendingAsset[]> {
    const prepared: PendingAsset[] = [];
    for (const asset of assets) {
      if (asset.assetType === 'text' || !asset.originalUrl || !isDataUrl(asset.originalUrl)) {
        if (asset.assetType !== 'text' && asset.previewRef) {
          validateCanonicalPreviewRef(asset.previewRef, asset.assetType);
        }
        prepared.push(asset);
        continue;
      }
      // Validate the input before decoding it, then persist only the fixed
      // canonical preview produced by the same pipeline as remote media.
      parseDataUrl(asset.originalUrl, asset.assetType);
      const previewRef = asset.assetType === 'image'
        ? await encodeImagePreview(asset.originalUrl, quality)
        : await generateVideoPreview(asset.originalUrl, quality);
      prepared.push({ ...asset, originalUrl: undefined, previewRef, sourceOnly: false });
    }
    return prepared;
  }

  async function broadcastPreviewChanged(asset: Asset): Promise<void> {
    const message: MediaPreviewChangedMessage = {
      type: 'media/previewChanged',
      payload: {
        assetId: asset.id,
        recordId: asset.recordId,
        status: asset.previewStatus ?? 'failed',
        previewRef: asset.previewRef,
        errorCode: asset.previewErrorCode,
      },
    };
    chrome.runtime.sendMessage(message).catch(() => {});
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }

  let previewProcessing: Promise<void> | undefined;

  async function processPreviewJobs(): Promise<void> {
    if (previewProcessing) return previewProcessing;
    previewProcessing = (async () => {
      while (true) {
        const claim = await claimNextPreviewJob();
        if (!claim) break;
        const heartbeat = globalThis.setInterval(() => {
          renewPreviewJob(claim.asset.id, claim.claimToken).catch(() => {});
        }, 20_000);
        try {
          if (!claim.asset.originalUrl || !isDownloadableUrl(claim.asset.originalUrl)) {
            throw new Error('MEDIA_PREVIEW_SOURCE_UNAVAILABLE');
          }
          // Assets created before previewQuality existed keep the old compact behavior.
          const quality = normalizeMediaQuality(claim.asset.previewQuality ?? 'low');
          const previewRef = claim.asset.assetType === 'image'
            ? await encodeImagePreview(claim.asset.originalUrl!, quality)
            : await generateVideoPreview(claim.asset.originalUrl!, quality);
          const finished = await completePreviewJob(claim.asset.id, claim.claimToken, previewRef);
          const fresh = await assetRepository.get(claim.asset.id);
          if (finished && fresh) await broadcastPreviewChanged(fresh);
        } catch (error) {
          await failPreviewJob(
            claim.asset.id,
            claim.claimToken,
            error instanceof Error ? error.message : String(error),
          );
          const fresh = await assetRepository.get(claim.asset.id);
          if (fresh) await broadcastPreviewChanged(fresh);
        } finally {
          globalThis.clearInterval(heartbeat);
        }
      }
    })().finally(() => {
      previewProcessing = undefined;
    });
    return previewProcessing;
  }

  async function summarizeRecord(recordId: string): Promise<{ ok: boolean; reason?: string }> {
    const settings = await loadSettings();
    const summarySettings = settings.summary;
    const record = await recordRepository.get(recordId);
    if (!record) return { ok: false, reason: 'record_not_found' };
    if (!summarySettings.enabled) return { ok: false, reason: 'summary_disabled' };

    const assets = await assetRepository.byRecord(recordId);
    const promptText = summaryPromptTextFromAssets(assets);
    if (!promptText) {
      await recordRepository.save({
        ...record,
        summaryStatus: 'skipped',
        summaryError: 'NO_PROMPT_TEXT',
        updatedAt: new Date().toISOString(),
      });
      return { ok: false, reason: 'no_prompt_text' };
    }

    const model = selectedSummaryModel(summarySettings);
    const apiKey = summarySettings.apiKeys[summarySettings.provider]?.trim() ?? '';
    if (!apiKey) return { ok: false, reason: 'api_key_required' };
    if (!model) return { ok: false, reason: 'model_required' };

    await recordRepository.save({
      ...record,
      summaryStatus: 'pending',
      summaryError: undefined,
      updatedAt: new Date().toISOString(),
    });

    try {
      const result = await requestPromptSummary({
        provider: summarySettings.provider,
        apiKey,
        model,
        promptText,
        systemPrompt: summarySettings.systemPrompt,
        timeoutMs: summarySettings.timeoutMs,
      });
      const fresh = await recordRepository.get(recordId);
      if (!fresh) return { ok: false, reason: 'record_not_found' };
      const generatedAt = new Date().toISOString();
      await recordRepository.save({
        ...fresh,
        summary: result.purpose ? `${result.purpose}｜${result.summary}` : result.summary,
        summaryStatus: 'completed',
        summaryError: undefined,
        summaryProvider: summarySettings.provider,
        summaryModel: model,
        summaryTokenUsage: result.usage,
        summaryGeneratedAt: generatedAt,
        summaryUsageHistory: [
          ...(fresh.summaryUsageHistory ?? []),
          {
            id: crypto.randomUUID(),
            generatedAt,
            provider: summarySettings.provider,
            model,
            usage: result.usage,
          },
        ],
        updatedAt: generatedAt,
      });
      return { ok: true };
    } catch (error) {
      const fresh = await recordRepository.get(recordId);
      if (fresh) {
        await recordRepository.save({
          ...fresh,
          summaryStatus: 'failed',
          summaryError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        });
      }
      return { ok: false, reason: 'provider_failed' };
    }
  }

  async function runAutoSummary(): Promise<void> {
    const settings = await loadSettings();
    if (!settings.summary.enabled || !settings.summary.autoEnabled) return;
    const records = await recordRepository.listActive();
    const candidates = records
      .filter((record) => !record.summaryStatus && !record.summaryGeneratedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, settings.summary.maxPerRun);
    for (const record of candidates) {
      if (settings.summary.dailyTokenLimit > 0) {
        const freshRecords = await recordRepository.listActive();
        if (isSummaryDailyTokenLimitReached(freshRecords, settings.summary.dailyTokenLimit)) break;
      }
      await summarizeRecord(record.id);
    }
  }

  // ---------- message routing ----------
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    (async () => {
      switch (message.type) {
        case 'capture/getSession':
          sendResponse({ state: session });
          return;

        case 'capture/createPendingAsset': {
          const payload = { ...message.payload, tabId: message.payload.tabId ?? sender.tab?.id };
          handleCreatePendingAsset(payload);
          sendResponse({ ok: true });
          return;
        }

        case 'capture/assignAssetRole': {
          const { pendingAssetId, role } = message.payload;
          const asset = session.assets.find((a) => a.id === pendingAssetId);
          if (!asset) return sendResponse({ ok: false });
          if (!isRoleAllowed(asset.assetType, role)) {
            setSession(
              addConflict(
                session,
                createConflict('ROLE_NOT_ALLOWED_FOR_ASSET_TYPE', {
                  existingAssetId: pendingAssetId,
                  existingPreview: preview(asset),
                }),
              ),
            );
            return sendResponse({ ok: false });
          }
          setSession(assignRole(session, pendingAssetId, role));
          return sendResponse({ ok: true });
        }

        case 'capture/addManualAsset': {
          if (!isRoleAllowed(message.payload.assetType, message.payload.role)) {
            return sendResponse({ ok: false, reason: 'role_not_allowed' });
          }
          if (message.payload.assetType === 'text' && !message.payload.textContent?.trim()) {
            return sendResponse({ ok: false, reason: 'empty_text' });
          }
          if (message.payload.assetType === 'image' && !message.payload.originalUrl?.trim()) {
            return sendResponse({ ok: false, reason: 'empty_source' });
          }
          const asset: PendingAsset = {
            id: crypto.randomUUID(),
            assetType: message.payload.assetType,
            role: message.payload.role,
            textContent: message.payload.textContent?.trim(),
            originalUrl: message.payload.originalUrl?.trim(),
            pageUrl: message.payload.pageUrl,
            pageTitle: message.payload.pageTitle,
            tabId: sender.tab?.id,
            capturedAt: message.payload.capturedAt,
          };
          setSession(addAsset(session, asset));
          return sendResponse({ ok: true });
        }

        case 'capture/removeAsset': {
          const asset = session.assets.find((a) => a.id === message.payload.pendingAssetId);
          setSession(removeAsset(session, message.payload.pendingAssetId));
          if (asset?.tabId != null) {
            chrome.tabs
              .sendMessage(asset.tabId, {
                type: 'capture/assetRemoved',
                payload: { pendingAssetId: message.payload.pendingAssetId },
              })
              .catch(() => {});
          }
          return sendResponse({ ok: true });
        }

        case 'capture/clearSession': {
          const tabIds = new Set(session.assets.map((a) => a.tabId).filter((t): t is number => t != null));
          conflictCandidates.clear();
          setSession(emptySession());
          for (const tabId of tabIds) {
            chrome.tabs.sendMessage(tabId, { type: 'capture/clearTracked' }).catch(() => {});
          }
          return sendResponse({ ok: true });
        }

        case 'capture/setWizardStage': {
          setSession({ ...session, wizardStage: message.payload.stage });
          return sendResponse({ ok: true });
        }

        case 'capture/resolveConflict': {
          const candidate = conflictCandidates.get(message.payload.conflictId);
          const conflict = session.conflicts.find((c) => c.id === message.payload.conflictId);
          let next = resolveConflict(session, message.payload.conflictId);
          if (message.payload.resolution === 'replace' && candidate && conflict?.existingAssetId) {
            next = removeAsset(next, conflict.existingAssetId);
            next = addAsset(next, candidate);
            if (candidate.tabId != null) {
              chrome.tabs
                .sendMessage(candidate.tabId, {
                  type: 'capture/assetReplaced',
                  payload: { oldId: conflict.existingAssetId, asset: candidate },
                })
                .catch(() => {});
            }
          }
          conflictCandidates.delete(message.payload.conflictId);
          setSession(next);
          return sendResponse({ ok: true });
        }

        case 'capture/dismissError': {
          const error = session.errors.find((er) => er.id === message.payload.errorId);
          if (
            error &&
            !error.assetId &&
            message.payload.action === 'save_source_only' &&
            error.errorType === 'MEDIA_URL_NOT_FOUND'
          ) {
            // No downloadable URL: keep a source-only video asset so the record
            // still points at the page where the media lives.
            const asset: PendingAsset = {
              id: crypto.randomUUID(),
              assetType: 'video',
              role: null,
              pageUrl: error.sourceUrl ?? '',
              pageTitle: '',
              sourceOnly: true,
              capturedAt: new Date().toISOString(),
            };
            setSession(addAsset(dismissError(session, message.payload.errorId), asset));
            return sendResponse({ ok: true });
          }
          setSession(dismissError(session, message.payload.errorId));
          return sendResponse({ ok: true });
        }

        case 'capture/commitSession': {
          try {
            const settings = await loadSettings();
            const preparedAssets = await preparePendingAssets(session.assets, settings.mediaQuality);
            const result = await commitSessionToLibrary(preparedAssets, message.payload, settings.mediaQuality);
            const tabIds = new Set(session.assets.map((a) => a.tabId).filter((t): t is number => t != null));
            conflictCandidates.clear();
            setSession(emptySession());
            for (const tabId of tabIds) {
              chrome.tabs.sendMessage(tabId, { type: 'capture/clearTracked' }).catch(() => {});
            }
            void result.pendingPreviews;
            void processPreviewJobs();
            sendResponse({ ok: true, recordId: result.record.id });
          } catch (e) {
            const reason = String(e);
            const previewFailure = reason.includes('MEDIA_DATA_URL') || reason.includes('MEDIA_PREVIEW') || reason.includes('MEDIA_VIDEO');
            setSession(
              addError(
                session,
                createCaptureError(previewFailure ? 'MEDIA_PREVIEW_FAILED' : 'STORAGE_WRITE_FAILED', 'background/commit', {
                  canRetry: !previewFailure,
                  canSaveSourceOnly: false,
                }),
              ),
            );
            sendResponse({ ok: false, error: String(e) });
          }
          return;
        }

        case 'media/generateVideoPreview': {
          await ensureOffscreenDocument();
          const result = await chrome.runtime.sendMessage<ExtensionMessage, GenerateVideoPreviewResult>(message);
          return sendResponse(result);
        }

        case 'taxonomy/get': {
          await seedDefaults().catch(() => {});
          const categories = await categoryRepository.list();
          return sendResponse({
            categories: categories.sort((a, b) => a.sortOrder - b.sortOrder),
          });
        }

        case 'taxonomy/quickAddCategory': {
          const now = new Date().toISOString();
          const category = {
            id: crypto.randomUUID(),
            parentId: null,
            name: message.payload.name,
            isBuiltin: false,
            isActive: true,
            sortOrder: 999,
            createdAt: now,
            updatedAt: now,
          };
          await categoryRepository.save(category);
          return sendResponse({ category });
        }

        case 'navigation/openExtensionPage': {
          const page = message.payload.page === 'settings' ? 'settings.html' : message.payload.page === 'trash' ? 'trash.html' : 'library.html';
          const hash = message.payload.hash?.startsWith('#') ? message.payload.hash : '';
          await chrome.tabs.create({ url: chrome.runtime.getURL(`${page}${hash}`) });
          return sendResponse({ ok: true });
        }

        case 'library/listRecords': {
          const [records, allAssets, categories] = await Promise.all([
            recordRepository.listActive(),
            assetRepository.list(),
            categoryRepository.list(),
          ]);
          const catName = new Map(categories.map((c) => [c.id, c.name]));
          const assetsByRecord = new Map<string, typeof allAssets>();
          for (const a of allAssets) {
            const arr = assetsByRecord.get(a.recordId) ?? [];
            arr.push(a);
            assetsByRecord.set(a.recordId, arr);
          }
          const gallery = records
            .slice()
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) // newest first
            .map((r) => ({
              id: r.id,
              title: r.title,
              summary: r.summary,
              categoryId: r.categoryId,
              categoryName: r.categoryId ? catName.get(r.categoryId) : undefined,
              createdAt: r.createdAt,
              assets: (assetsByRecord.get(r.id) ?? [])
                .slice()
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((a) => ({
                  role: a.role,
                  assetType: a.assetType,
                  textContent: a.textContent,
                  originalUrl: a.originalUrl,
                  previewRef: a.previewRef,
                  previewStatus: a.previewStatus,
                  previewErrorCode: a.previewErrorCode,
                })),
            }));
          return sendResponse({ records: gallery });
        }

        case 'library/trashRecord': {
          const record = await recordRepository.trash(message.payload.recordId);
          return sendResponse({ ok: Boolean(record), trashedAt: record?.trashedAt });
        }

        case 'library/restoreRecord': {
          const record = await recordRepository.restore(message.payload.recordId);
          return sendResponse({ ok: Boolean(record) });
        }

        case 'library/purgeExpiredTrash': {
          const result = await purgeExpiredTrashNow();
          return sendResponse({ ok: true, ...result });
        }

        case 'library/deleteRecord': {
          await deleteRecordCascade(message.payload.recordId);
          return sendResponse({ ok: true });
        }

        case 'library/updateRecordMeta': {
          const rec = await recordRepository.get(message.payload.recordId);
          if (!rec) return sendResponse({ ok: false });
          const p = message.payload;
          await recordRepository.save({
            ...rec,
            categoryId: 'categoryId' in p ? (p.categoryId ?? null) : rec.categoryId,
            updatedAt: new Date().toISOString(),
          });
          return sendResponse({ ok: true });
        }

        case 'library/addRecordTextAsset': {
          const rec = await recordRepository.get(message.payload.recordId);
          if (!rec) return sendResponse({ ok: false, reason: 'record_not_found' });
          const text = message.payload.textContent.trim();
          if (!text) return sendResponse({ ok: false, reason: 'empty_text' });
          const now = new Date().toISOString();
          const assets = await assetRepository.byRecord(rec.id);
          await assetRepository.save({
            id: crypto.randomUUID(),
            recordId: rec.id,
            assetType: 'text',
            role: message.payload.role,
            textContent: text,
            orderIndex: Math.max(-1, ...assets.map((asset) => asset.orderIndex)) + 1,
            capturedAt: now,
          });
          await recordRepository.save({ ...rec, updatedAt: now });
          return sendResponse({ ok: true });
        }

        case 'library/addRecordMediaAsset': {
          const rec = await recordRepository.get(message.payload.recordId);
          if (!rec) return sendResponse({ ok: false, reason: 'record_not_found' });
          if (!isRoleAllowed(message.payload.assetType, message.payload.role)) {
            return sendResponse({ ok: false, reason: 'role_not_allowed' });
          }
          const source = message.payload.originalUrl.trim();
          if (!source) return sendResponse({ ok: false, reason: 'empty_source' });
          const now = new Date().toISOString();
          const assets = await assetRepository.byRecord(rec.id);
          const settings = await loadSettings();
          let prepared: PendingAsset;
          try {
            [prepared] = await preparePendingAssets([{
              id: crypto.randomUUID(),
              assetType: message.payload.assetType,
              role: message.payload.role,
              originalUrl: source,
              previewRef: message.payload.previewRef,
              pageUrl: rec.sourcePageUrl ?? '',
              pageTitle: rec.sourcePageTitle ?? '',
              capturedAt: now,
            }], settings.mediaQuality);
          } catch (error) {
            return sendResponse({ ok: false, reason: error instanceof Error ? error.message : String(error) });
          }
          const remoteSource = prepared.originalUrl && isDownloadableUrl(prepared.originalUrl);
          const newAsset: Asset = {
            id: crypto.randomUUID(),
            recordId: rec.id,
            assetType: message.payload.assetType,
            role: message.payload.role,
            originalUrl: prepared.originalUrl,
            previewRef: prepared.previewRef,
            previewStatus: prepared.previewRef ? 'ready' : remoteSource ? 'pending' : undefined,
            previewUpdatedAt: prepared.previewRef ? now : undefined,
            previewQuality: settings.mediaQuality,
            orderIndex: Math.max(-1, ...assets.map((asset) => asset.orderIndex)) + 1,
            capturedAt: now,
          };
          await assetRepository.save(newAsset);
          await recordRepository.save({ ...rec, updatedAt: now });
          if (remoteSource) void processPreviewJobs();
          return sendResponse({ ok: true });
        }

        case 'summary/summarizeRecord': {
          const result = await summarizeRecord(message.payload.recordId);
          return sendResponse(result);
        }

        case 'summary/runAuto': {
          await runAutoSummary();
          return sendResponse({ ok: true });
        }

        default:
          return;
      }
    })();
    return true; // keep the message channel open for async sendResponse
  });
});
