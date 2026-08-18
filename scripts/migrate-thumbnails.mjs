/**
 * Sprint 6 one-off: moves the seeded local thumbnails (public/thumbnails/*)
 * into the bunny.net Storage Zone and repoints each course's thumbnail_url at
 * the assets Pull Zone, so the catalogue is served through the CDN from day
 * one. Safe to re-run — files are content-identical overwrites and the URL
 * update is idempotent.
 *
 *   node --env-file=.env scripts/migrate-thumbnails.mjs
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const MIME = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

const zone = process.env.BUNNY_STORAGE_ZONE?.trim();
const storageKey = process.env.BUNNY_STORAGE_KEY?.trim();
const apiHost = (
  process.env.BUNNY_STORAGE_API_HOST?.trim() || "https://storage.bunnycdn.com"
).replace(/\/+$/, "");
const assetsHost = process.env.BUNNY_ASSETS_HOSTNAME?.trim().replace(/\/+$/, "");

if (!zone || !storageKey || !assetsHost) {
  console.error("BUNNY_STORAGE_ZONE / BUNNY_STORAGE_KEY / BUNNY_ASSETS_HOSTNAME が必要です。");
  process.exit(1);
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./data/app.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

const dir = join(process.cwd(), "public", "thumbnails");
const files = (await readdir(dir)).filter((name) => MIME[ext(name)]);

function ext(name) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

let uploaded = 0;
let repointed = 0;

for (const name of files) {
  const bytes = new Uint8Array(await readFile(join(dir, name)));
  const storedPath = `thumbnails/${name}`;
  const response = await fetch(`${apiHost}/${zone}/${storedPath}`, {
    method: "PUT",
    headers: {
      AccessKey: storageKey,
      "content-type": MIME[ext(name)],
    },
    body: bytes,
  });
  if (!response.ok && response.status !== 201) {
    console.error(`PUT ${storedPath} failed: ${response.status}`);
    process.exit(1);
  }
  uploaded += 1;

  const url = `https://${assetsHost}/${storedPath}`;
  const result = await db.execute({
    sql: "UPDATE course SET thumbnail_url = ? WHERE thumbnail_url = ?",
    args: [url, `/thumbnails/${name}`],
  });
  repointed += Number(result.rowsAffected ?? 0);
  console.log(`${storedPath} → ${url} (${result.rowsAffected} rows)`);
}

// Courses whose thumbnails were uploaded through the admin UI before the
// migration (they already live under /api/uploads/...) are moved as well.
const localRows = await db.execute(
  "SELECT id, thumbnail_url FROM course WHERE thumbnail_url LIKE '/api/uploads/%'"
);
for (const row of localRows.rows) {
  const uploadId = String(row.thumbnail_url).split("/").pop();
  try {
    const upload = await db.execute({
      sql: "SELECT stored_name, mime_type FROM upload WHERE id = ? LIMIT 1",
      args: [uploadId],
    });
    const record = upload.rows[0];
    if (!record) continue;
    const storedPath = `thumbnails/migrated-${record.stored_name}`;
    const { readFile: read } = await import("node:fs/promises");
    const bytes = new Uint8Array(
      await read(join(process.cwd(), "data", "uploads", String(record.stored_name)))
    );
    const put = await fetch(`${apiHost}/${zone}/${storedPath}`, {
      method: "PUT",
      headers: {
        AccessKey: storageKey,
        "content-type": String(record.mime_type),
      },
      body: bytes,
    });
    if (!put.ok && put.status !== 201) continue;
    uploaded += 1;
    await db.execute({
      sql: "UPDATE course SET thumbnail_url = ? WHERE id = ?",
      args: [`https://${assetsHost}/${storedPath}`, String(row.id)],
    });
    repointed += 1;
    console.log(`${storedPath} → course ${row.id}`);
  } catch (error) {
    console.warn(`skip ${row.id}: ${error.message}`);
  }
}

console.log(`done: ${uploaded} files uploaded, ${repointed} courses repointed.`);
db.close();
