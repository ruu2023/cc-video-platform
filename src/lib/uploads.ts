import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { db } from "@/lib/db";

/**
 * Uploaded bytes live outside `public/` so they are always served through a
 * route handler. That keeps a single place to add purchase checks later, and
 * stops anything from being executed or listed straight off the filesystem.
 */
export const UPLOAD_DIR = resolve(process.cwd(), "data", "uploads");

export const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_RESOURCE_BYTES = 25 * 1024 * 1024; // 25 MB

export type UploadKind = "thumbnail" | "resource";

export type UploadRecord = {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  kind: UploadKind;
};

const THUMBNAIL_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  // SVG is deliberately absent: an uploaded SVG is executable markup, and the
  // thumbnail is rendered inline on public pages.
};

const RESOURCE_TYPES: Record<string, string> = {
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "application/json": ".json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  ...THUMBNAIL_TYPES,
};

/** Extension fallback for browsers that send an empty or generic MIME type. */
const EXTENSION_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export class UploadError extends Error {}

function limitFor(kind: UploadKind) {
  return kind === "thumbnail" ? MAX_THUMBNAIL_BYTES : MAX_RESOURCE_BYTES;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveMimeType(file: File, kind: UploadKind): string {
  const allowed = kind === "thumbnail" ? THUMBNAIL_TYPES : RESOURCE_TYPES;
  const declared = (file.type || "").toLowerCase();
  if (declared && allowed[declared]) return declared;

  const guessed = EXTENSION_TYPES[extname(file.name).toLowerCase()];
  if (guessed && allowed[guessed]) return guessed;

  throw new UploadError(
    kind === "thumbnail"
      ? "サムネイルは PNG / JPEG / WebP / GIF / AVIF のみアップロードできます。"
      : "対応していないファイル形式です。PDF・ZIP・テキスト・画像・Office 形式に対応しています。"
  );
}

/** Persists one uploaded file and returns its catalogue row. */
export async function saveUpload(file: File, kind: UploadKind): Promise<UploadRecord> {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) {
    throw new UploadError("ファイルが選択されていません。");
  }

  const limit = limitFor(kind);
  if (file.size > limit) {
    throw new UploadError(
      `ファイルサイズが上限（${formatBytes(limit)}）を超えています。`
    );
  }

  const mimeType = resolveMimeType(file, kind);
  const id = randomUUID();
  const extension = extname(file.name).toLowerCase() || THUMBNAIL_TYPES[mimeType] || "";
  const storedName = `${id}${extension}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(join(UPLOAD_DIR, storedName), bytes);

  const originalName = file.name.slice(0, 200) || storedName;

  await db.execute({
    sql: `INSERT INTO upload
            (id, original_name, stored_name, mime_type, size_bytes, kind)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, originalName, storedName, mimeType, bytes.byteLength, kind],
  });

  return {
    id,
    originalName,
    storedName,
    mimeType,
    sizeBytes: bytes.byteLength,
    kind,
  };
}

export async function getUpload(id: string): Promise<UploadRecord | null> {
  if (!id) return null;
  const result = await db.execute({
    sql: `SELECT id, original_name, stored_name, mime_type, size_bytes, kind
          FROM upload WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    originalName: String(row.original_name),
    storedName: String(row.stored_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    kind: String(row.kind) as UploadKind,
  };
}

export async function readUploadBytes(record: UploadRecord): Promise<Buffer> {
  // `stored_name` is generated server-side from a UUID, but re-checking keeps a
  // corrupted row from ever escaping the upload directory.
  const target = resolve(UPLOAD_DIR, record.storedName);
  if (!target.startsWith(UPLOAD_DIR)) {
    throw new UploadError("不正なファイルパスです。");
  }
  return readFile(target);
}

/** Removes the catalogue row and the bytes; a missing file is not an error. */
export async function deleteUpload(id: string): Promise<void> {
  const record = await getUpload(id);
  if (!record) return;

  await db.execute({ sql: "DELETE FROM upload WHERE id = ?", args: [id] });

  try {
    await unlink(join(UPLOAD_DIR, record.storedName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("deleteUpload: failed to remove file", error);
    }
  }
}

export function uploadHref(id: string): string {
  return `/api/uploads/${id}`;
}
