# ADR-0005：Canonical 媒體預覽只儲存於 IndexedDB

## Status

Accepted. Supersedes the media-storage and download behavior in ADR-0001, ADR-0002, and ADR-0003 for the current implementation.

## Context

PrompTrace needs saved media to remain visible after signed source URLs expire, browser restarts, and page CSP changes. The previous design automatically downloaded media into `Downloads/PrompTrace/`, tracked those files with `FileRecord`, and removed extension-created files during deletion. That created filesystem side effects during capture, made restore dependent on Chrome Downloads state, and required the `downloads` permission.

## Decision

1. New image captures are canonicalized to a compact WebP preview (decoded bytes no larger than 2 MiB).
2. New video captures are canonicalized to a GIF preview, with a WebP still-image fallback. The selected low/medium/high preset caps generated previews at 3/6/10 MiB respectively; 10 MiB is the global canonical ceiling.
3. Canonical preview bytes are stored as `Asset.previewRef` in IndexedDB. A raw Data URL is transport-only and is never persisted as `Asset.originalUrl`, backup metadata, or a second preview copy.
4. Remote HTTP(S) captures retain `originalUrl` as source metadata and create an Asset-backed durable preview job. The job uses `pending`/`processing`/`ready`/`failed`, a claim token, and an expiring lease. A stale worker cannot commit a result after ownership changes.
5. Record + Asset capture commit is one IndexedDB transaction. Preview completion/failure is one compare-and-set Asset transaction. Restore preflights validation, canonicalization, and IDs, then writes Record, Asset, Tag, and Category stores atomically with no-overwrite `add()` calls.
6. v2 backup stores metadata in `records.json` and one canonical preview file per media asset under `media/{recordId}/{assetId}.{ext}`. Each media entry records MIME, byte size, and SHA-256. v1 archives remain readable and are converted through the same canonical pipeline.
7. Delete, Trash purge, migration, and restore only modify IndexedDB. Existing legacy `FileRecord` metadata remains readable but is not used to touch files. Automatic `chrome.downloads.*` calls and the `downloads` manifest permission are removed. User-triggered ZIP export uses an ordinary download anchor.
8. New media captures record `Asset.previewQuality` (`low`, `medium`, or `high`) at commit time. Preview workers use the value stored on the Asset, so later settings changes do not recompress or alter existing assets. The default for new users is `medium`; assets created before this field existed keep the former compact (`low`) behavior when a pending job resumes.

## Consequences

- Captures have no automatic filesystem side effects and work without the Downloads permission.
- Local previews survive remote source expiry and page-level CSP restrictions.
- Large or undecodable media can fail with a visible Asset preview status while retaining a usable source URL when one exists.
- IndexedDB quota and preview-size limits are explicit and testable.
- Existing downloaded files are intentionally left untouched; users manage those legacy files outside PrompTrace.
