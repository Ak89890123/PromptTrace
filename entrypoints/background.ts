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
import type { PendingAsset } from '@/src/core/domain/entities';
import { isRoleAllowed } from '@/src/core/domain/validation';
import { createConflict } from '@/src/core/errors/conflictTypes';
import { createCaptureError, mapDownloadError } from '@/src/core/errors/errorTypes';
import type { ExtensionMessage } from '@/src/core/messages';
import { commitSessionToLibrary, downloadPathFor } from '@/src/storage/commitSession';
import {
  assetRepository,
  categoryRepository,
  fileRecordRepository,
  modelPresetRepository,
} from '@/src/storage/repositories';
import { seedDefaults } from '@/src/storage/seed';

const MENU_TEXT = 'prompttrace-add-selection';
const MENU_IMAGE = 'prompttrace-add-image';
const MENU_VIDEO = 'prompttrace-add-video';

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

  // ---------- setup ----------
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: MENU_TEXT, title: 'PromptTrace：加入選取文字', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_IMAGE, title: 'PromptTrace：加入圖片', contexts: ['image'] });
    chrome.contextMenus.create({ id: MENU_VIDEO, title: 'PromptTrace：加入影片', contexts: ['video'] });
    seedDefaults().catch((e) => console.error('[PromptTrace] seed failed', e));
  });
  seedDefaults().catch(() => {});

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id != null) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
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
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});

    if (info.menuItemId === MENU_TEXT) {
      // Ask the content script for selection details (text + overlap info + overlay anchor).
      chrome.tabs
        .sendMessage(tab.id, { type: 'overlay/captureSelection' })
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
      // Tell the content script to draw an overlay frame on the media element.
      chrome.tabs
        .sendMessage(tab.id, { type: 'overlay/markMedia', payload: { srcUrl: info.srcUrl, assetType } })
        .catch(() => {});
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
      if (payload.tabId != null) {
        chrome.tabs
          .sendMessage(payload.tabId, { type: 'overlay/flash', payload: { pendingAssetId: check.existingId } })
          .catch(() => {});
      }
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
        .sendMessage(payload.tabId, { type: 'overlay/assetAdded', payload: { asset } })
        .catch(() => {});
    }
  }

  function preview(a?: { textContent?: string; originalUrl?: string } | null): string {
    if (!a) return '';
    return (a.textContent ?? a.originalUrl ?? '').slice(0, 120);
  }

  // ---------- downloads ----------
  async function startDownload(fileRecordId: string, url: string, recordId: string): Promise<void> {
    const fileRecord = await fileRecordRepository.get(fileRecordId);
    if (!fileRecord) return;
    try {
      const downloadId = await chrome.downloads.download({
        url,
        filename: downloadPathFor(recordId, fileRecord),
        conflictAction: 'uniquify',
      });
      await fileRecordRepository.save({
        ...fileRecord,
        downloadId,
        downloadStatus: 'downloading',
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      await fileRecordRepository.save({
        ...fileRecord,
        downloadStatus: 'failed',
        updatedAt: new Date().toISOString(),
      });
      setSession(
        addError(
          session,
          createCaptureError(mapDownloadError(String(e)), 'background/download', {
            sourceUrl: url,
            assetId: fileRecord.assetId,
            canSaveSourceOnly: true,
            canRetry: true,
          }),
        ),
      );
    }
  }

  chrome.downloads.onChanged.addListener(async (delta) => {
    const matches = await fileRecordRepository.byDownloadId(delta.id);
    const fileRecord = matches[0];
    if (!fileRecord) return;

    if (delta.state?.current === 'complete') {
      const [item] = await chrome.downloads.search({ id: delta.id });
      await fileRecordRepository.save({
        ...fileRecord,
        downloadStatus: 'completed',
        localPath: item?.filename,
        mimeType: item?.mime,
        fileSize: item?.fileSize,
        downloadedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      chrome.runtime
        .sendMessage({ type: 'media/fileRecordChanged', payload: { fileRecordId: fileRecord.id } })
        .catch(() => {});
    } else if (delta.state?.current === 'interrupted' || delta.error) {
      await fileRecordRepository.save({
        ...fileRecord,
        downloadStatus: 'failed',
        updatedAt: new Date().toISOString(),
      });
      const asset = await assetRepository.get(fileRecord.assetId);
      setSession(
        addError(
          session,
          createCaptureError(mapDownloadError(delta.error?.current), 'background/download', {
            sourceUrl: asset?.originalUrl,
            assetId: fileRecord.assetId,
            canSaveSourceOnly: true,
            canRetry: true,
          }),
        ),
      );
      chrome.runtime
        .sendMessage({ type: 'media/fileRecordChanged', payload: { fileRecordId: fileRecord.id } })
        .catch(() => {});
    }
  });

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
          if (asset.tabId != null) {
            chrome.tabs
              .sendMessage(asset.tabId, { type: 'overlay/roleChanged', payload: { pendingAssetId, role } })
              .catch(() => {});
          }
          return sendResponse({ ok: true });
        }

        case 'capture/removeAsset': {
          const asset = session.assets.find((a) => a.id === message.payload.pendingAssetId);
          setSession(removeAsset(session, message.payload.pendingAssetId));
          if (asset?.tabId != null) {
            chrome.tabs
              .sendMessage(asset.tabId, {
                type: 'overlay/removeFrame',
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
            chrome.tabs.sendMessage(tabId, { type: 'overlay/clearAll' }).catch(() => {});
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
                  type: 'overlay/replaceFrame',
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
          if (error?.assetId) {
            const fileRecords = await fileRecordRepository.byAsset(error.assetId);
            const fileRecord = fileRecords[0];
            if (message.payload.action === 'retry' && fileRecord) {
              const asset = await assetRepository.get(error.assetId);
              if (asset?.originalUrl) {
                setSession(dismissError(session, message.payload.errorId));
                await startDownload(fileRecord.id, asset.originalUrl, asset.recordId);
                return sendResponse({ ok: true });
              }
            } else if (message.payload.action === 'save_source_only' && fileRecord) {
              // Keep the asset with its source URL, give up on the file download.
              await fileRecordRepository.save({
                ...fileRecord,
                downloadStatus: 'not_required',
                updatedAt: new Date().toISOString(),
              });
            }
          }
          setSession(dismissError(session, message.payload.errorId));
          return sendResponse({ ok: true });
        }

        case 'capture/commitSession': {
          try {
            const result = await commitSessionToLibrary(session.assets, message.payload);
            const tabIds = new Set(session.assets.map((a) => a.tabId).filter((t): t is number => t != null));
            conflictCandidates.clear();
            setSession({ ...emptySession(), lastCommittedRecordId: result.record.id });
            for (const tabId of tabIds) {
              chrome.tabs.sendMessage(tabId, { type: 'overlay/clearAll' }).catch(() => {});
            }
            for (const { fileRecord, url } of result.pendingDownloads) {
              startDownload(fileRecord.id, url, result.record.id);
            }
            sendResponse({ ok: true, recordId: result.record.id });
          } catch (e) {
            setSession(
              addError(
                session,
                createCaptureError('STORAGE_WRITE_FAILED', 'background/commit', { canRetry: true }),
              ),
            );
            sendResponse({ ok: false, error: String(e) });
          }
          return;
        }

        case 'media/retryDownload': {
          const fileRecord = await fileRecordRepository.get(message.payload.fileRecordId);
          if (!fileRecord) return sendResponse({ ok: false });
          const asset = await assetRepository.get(fileRecord.assetId);
          if (asset?.originalUrl) {
            await startDownload(fileRecord.id, asset.originalUrl, asset.recordId);
            return sendResponse({ ok: true });
          }
          return sendResponse({ ok: false });
        }

        case 'media/deleteRecordFiles': {
          // Delete local files for all file records of a record (downloads we created).
          const assets = await assetRepository.byRecord(message.payload.recordId);
          const failures: string[] = [];
          for (const asset of assets) {
            for (const fileRecord of await fileRecordRepository.byAsset(asset.id)) {
              if (fileRecord.downloadId == null) continue;
              try {
                await chrome.downloads.removeFile(fileRecord.downloadId);
                await fileRecordRepository.save({
                  ...fileRecord,
                  deleteStatus: 'deleted',
                  updatedAt: new Date().toISOString(),
                });
              } catch (e) {
                const msg = String(e);
                const status = msg.includes('not found') || msg.includes('No such')
                  ? 'file_not_found'
                  : 'delete_failed';
                await fileRecordRepository.save({
                  ...fileRecord,
                  deleteStatus: status,
                  updatedAt: new Date().toISOString(),
                });
                failures.push(fileRecord.id);
              }
            }
          }
          return sendResponse({ ok: failures.length === 0, failures });
        }

        case 'taxonomy/get': {
          await seedDefaults().catch(() => {});
          const [categories, presets] = await Promise.all([
            categoryRepository.list(),
            modelPresetRepository.list(),
          ]);
          return sendResponse({
            categories: categories.sort((a, b) => a.sortOrder - b.sortOrder),
            presets: presets.sort((a, b) => a.sortOrder - b.sortOrder),
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

        default:
          return;
      }
    })();
    return true; // keep the message channel open for async sendResponse
  });
});
