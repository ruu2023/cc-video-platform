import { createHmac, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { nowSeconds, resolveTtlSeconds } from "@/lib/video-token";

/**
 * The single server-side integration point for bunny.net (Sprint 6).
 *
 * Three surfaces, three sets of credentials — none of which may ever reach
 * the browser:
 *
 * - **Stream CDN playback** (`BUNNY_STREAM_HOSTNAME` + `BUNNY_STREAM_TOKEN_KEY`):
 *   `HS256-` prefixed HMAC-SHA256 tokens minted over `path + expires`, see
 *   `src/lib/video-token.ts`. The player receives only the finished,
 *   already-signed URL.
 * - **Stream management API** (`BUNNY_STREAM_API_KEY`): creating videos,
 *   uploading bytes and polling encode status. Called from route handlers /
 *   server actions only.
 * - **Storage Zone + assets Pull Zone** (`BUNNY_STORAGE_KEY`,
 *   `BUNNY_STORAGE_API_HOST`, `BUNNY_ASSETS_HOSTNAME`, `BUNNY_CDN_TOKEN_KEY`):
 *   thumbnails are PUT to the region-specific Storage API host (the zone lives
 *   in Singapore, so `https://sg.storage.bunnycdn.com/...` — the default
 *   `storage.bunnycdn.com` host answers 401 for it) and read back through the
 *   signed Pull Zone URL.
 */

export class BunnyError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ config */

export function streamHostname(): string {
  return process.env.BUNNY_STREAM_HOSTNAME?.trim().replace(/\/+$/, "") ?? "";
}

export function streamConfigured(): boolean {
  return streamHostname() !== "" && Boolean(process.env.BUNNY_STREAM_TOKEN_KEY?.trim());
}

export function assetsHostname(): string {
  return process.env.BUNNY_ASSETS_HOSTNAME?.trim().replace(/\/+$/, "") ?? "";
}

export function assetsConfigured(): boolean {
  return assetsHostname() !== "" && Boolean(process.env.BUNNY_CDN_TOKEN_KEY?.trim());
}

export function storageConfigured(): boolean {
  return Boolean(
    process.env.BUNNY_STORAGE_ZONE?.trim() &&
      process.env.BUNNY_STORAGE_KEY?.trim() &&
      storageApiHost().trim()
  );
}

/** Region-specific Storage API host. Singapore zone → https://sg.storage.bunnycdn.com */
export function storageApiHost(): string {
  const host = process.env.BUNNY_STORAGE_API_HOST?.trim() || "https://storage.bunnycdn.com";
  return host.replace(/\/+$/, "");
}

function streamApiKey(): string {
  const key = process.env.BUNNY_STREAM_API_KEY?.trim();
  if (!key) {
    throw new BunnyError("BUNNY_STREAM_API_KEY が設定されていません。", 500);
  }
  return key;
}

function libraryId(): string {
  const id = process.env.BUNNY_LIBRARY_ID?.trim();
  if (!id) {
    throw new BunnyError("BUNNY_LIBRARY_ID が設定されていません。", 500);
  }
  return id;
}

function storageKey(): string {
  const key = process.env.BUNNY_STORAGE_KEY?.trim();
  if (!key) {
    throw new BunnyError("BUNNY_STORAGE_KEY が設定されていません。", 500);
  }
  return key;
}

/* ------------------------------------------------------- playback signing */

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A signed, absolute playback URL on the Stream CDN.
 *
 * MP4 fallback (`play_720p.mp4`) rather than HLS: playlist.m3u8 references its
 * segments with relative URLs, so the `token`/`expires` query — which bunny
 * validates per request — does not carry over to the `.ts` segments and
 * playback dies mid-stream with 403s. A single signed MP4 has no secondary
 * requests, seeks fine over byte ranges, and was verified against the real
 * library.
 */
export function signedStreamPlaybackUrl(
  bunnyVideoId: string,
  ttlSeconds: number = 30 * 60,
  file = "play_720p.mp4"
): { url: string; expires: number } {
  const host = streamHostname();
  const key = process.env.BUNNY_STREAM_TOKEN_KEY!.trim();
  const path = `/${bunnyVideoId}/${file}`;
  const ttl = resolveTtlSeconds(ttlSeconds);
  const expires = nowSeconds() + ttl;
  const token = `HS256-${base64url(
    createHmac("sha256", key).update(`${path}${expires}`).digest()
  )}`;
  const query = new URLSearchParams({ token, expires: String(expires) });
  return { url: `https://${host}${path}?${query.toString()}`, expires };
}

/**
 * Signs a thumbnail URL for the assets Pull Zone.
 *
 * Accepts either a bare path (`/thumbnails/x.png`) or a full URL already on
 * the assets hostname, and returns the URL with `token`/`expires` appended
 * (the pull zone has Token Authentication enabled, so the bare URL answers
 * 403).
 */
export function signedAssetsUrl(
  pathOrUrl: string,
  ttlSeconds = 60 * 60 * 24 * 30
): string {
  const host = assetsHostname();
  if (!host) return pathOrUrl;

  let path = pathOrUrl;
  const prefix = `https://${host}/`;
  if (pathOrUrl.startsWith(prefix)) {
    path = `/${pathOrUrl.slice(prefix.length)}`;
  }
  if (!path.startsWith("/")) return pathOrUrl;

  const key = process.env.BUNNY_CDN_TOKEN_KEY!.trim();
  const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), 60 * 60 * 24 * 365);
  const expires = nowSeconds() + ttl;
  const token = `HS256-${base64url(
    createHmac("sha256", key).update(`${path}${expires}`).digest())
  }`;
  const query = new URLSearchParams({ token, expires: String(expires) });
  return `https://${host}${path}?${query.toString()}`;
}

/* --------------------------------------------------- stream management API */

export type BunnyVideo = {
  guid: string;
  title: string;
  /** Duration in seconds, once bunny has probed the file. */
  lengthSeconds: number;
  /** 0=新規作成, 1=アップロード済み, 2=エンコード中(旧), 3=処理中, 4=完了, 5=エラー */
  status: number;
};

const STREAM_API = "https://video.bunnycdn.com";

export const BUNNY_STATUS_LABEL: Record<number, string> = {
  0: "準備中",
  1: "アップロード待ち",
  2: "エンコード中",
  3: "エンコード中",
  4: "完了",
  5: "エラー",
};

export function bunnyStatusLabel(status: number): string {
  return BUNNY_STATUS_LABEL[status] ?? "不明";
}

function toBunnyVideo(payload: Record<string, unknown>): BunnyVideo {
  return {
    guid: String(payload.guid ?? ""),
    title: String(payload.title ?? ""),
    lengthSeconds: Number(payload.length ?? 0) || 0,
    status: Number(payload.status ?? 0),
  };
}

/**
 * One video of the library, or null when the guid does not exist there
 * (e.g. a placeholder id seeded before the real account existed).
 */
export async function getBunnyVideo(guid: string): Promise<BunnyVideo | null> {
  const id = guid.trim();
  if (!id) return null;

  const response = await fetch(
    `${STREAM_API}/library/${libraryId()}/videos/${encodeURIComponent(id)}`,
    {
      headers: { AccessKey: streamApiKey() },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new BunnyError(
      `Bunny Stream API が動画の取得に失敗しました（${response.status}）。`
    );
  }
  return toBunnyVideo(await response.json());
}

/** Creates an empty video entry in the library and returns its guid. */
export async function createBunnyVideo(title: string): Promise<string> {
  const response = await fetch(`${STREAM_API}/library/${libraryId()}/videos`, {
    method: "POST",
    headers: {
      AccessKey: streamApiKey(),
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: title.slice(0, 200) }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new BunnyError(
      `Bunny Stream への動画作成に失敗しました（${response.status}）。`
    );
  }
  const payload = (await response.json()) as { guid?: string };
  const guid = String(payload.guid ?? "");
  if (!guid) throw new BunnyError("Bunny Stream が動画GUIDを返しませんでした。");
  return guid;
}

/**
 * Uploads media bytes into a created video entry. `body` may be a web stream,
 * so a large upload never has to sit in memory.
 */
export async function uploadBunnyVideo(
  guid: string,
  body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array,
  contentType: string,
  contentLength?: number
): Promise<void> {
  const headers: Record<string, string> = {
    AccessKey: streamApiKey(),
  };
  if (contentType) headers["content-type"] = contentType;
  if (typeof contentLength === "number" && Number.isFinite(contentLength)) {
    headers["content-length"] = String(contentLength);
  }

  const response = await fetch(
    `${STREAM_API}/library/${libraryId()}/videos/${encodeURIComponent(guid)}`,
    {
      method: "PUT",
      headers,
      body: body as BodyInit,
      // The request body is a live stream from the client, not a string.
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`Bunny upload failed (${response.status}): ${detail.slice(0, 400)}`);
    throw new BunnyError(
      `Bunny Stream への動画アップロードに失敗しました（${response.status}）。`
    );
  }
}

/* ------------------------------------------------------------- storage API */

/** MIME allow-list mirrors the admin thumbnail picker (SVG is excluded). */
const THUMBNAIL_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

export const STORAGE_THUMBNAIL_DIR = "thumbnails";

/**
 * PUTs a thumbnail into the Storage Zone (via the region-specific API host)
 * and returns its Pull Zone URL — unsigned; signing happens at render time
 * (`signedAssetsUrl`) so stored URLs never go stale.
 */
export async function saveThumbnailToStorage(
  file: File
): Promise<{ url: string; storedPath: string }> {
  if (!storageConfigured()) {
    throw new BunnyError("Bunny Storage の設定が不完全です。", 500);
  }

  const declared = (file.type || "").toLowerCase();
  let mimeType = declared && THUMBNAIL_TYPES[declared] ? declared : "";
  if (!mimeType) {
    const extension = extname(file.name).toLowerCase();
    const guessedType = Object.entries(THUMBNAIL_TYPES).find(
      ([, extensionForType]) => extensionForType === extension
    )?.[0];
    if (guessedType) mimeType = guessedType;
  }
  if (!mimeType) {
    throw new BunnyError(
      "サムネイルは PNG / JPEG / WebP / GIF / AVIF のみアップロードできます。"
    );
  }

  const extension = THUMBNAIL_TYPES[mimeType];
  const storedPath = `${STORAGE_THUMBNAIL_DIR}/${randomUUID()}${extension}`;
  const zone = process.env.BUNNY_STORAGE_ZONE!.trim();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const response = await fetch(`${storageApiHost()}/${zone}/${storedPath}`, {
    method: "PUT",
    headers: {
      AccessKey: storageKey(),
      "content-type": mimeType,
    },
    body: bytes,
  });

  if (!response.ok && response.status !== 201) {
    throw new BunnyError(
      `サムネイルのBunny Storageへの保存に失敗しました（${response.status}）。`
    );
  }

  return { url: `https://${assetsHostname()}/${storedPath}`, storedPath };
}

/** Uploads arbitrary bytes (used by the one-off thumbnail migration script). */
export async function putStorageObject(
  storedPath: string,
  bytes: Uint8Array,
  mimeType: string
): Promise<void> {
  const zone = process.env.BUNNY_STORAGE_ZONE!.trim();
  const response = await fetch(`${storageApiHost()}/${zone}/${storedPath}`, {
    method: "PUT",
    headers: {
      AccessKey: storageKey(),
      "content-type": mimeType,
    },
    body: bytes as BodyInit,
  });
  if (!response.ok && response.status !== 201) {
    throw new BunnyError(
      `Bunny Storage への書き込みに失敗しました（${response.status}）。`
    );
  }
}
