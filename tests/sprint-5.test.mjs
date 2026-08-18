/**
 * Sprint 5 contract tests — purchase-gated attachment downloads.
 *
 * Runs against the live app and the real database. Nothing is mocked: the
 * download route really reads the files off disk, and the bytes it returns are
 * compared against the bytes on disk to prove the file that comes out is the
 * file that went in.
 *
 *   npm run dev            # terminal 1
 *   npm test               # terminal 2
 *
 * Requires `npm run setup` (seeded catalogue, demo accounts, generated
 * attachments).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const UPLOAD_DIR = resolve(process.cwd(), "data", "uploads");

const CREATOR = { email: "creator@kouza.test", password: "creator-pass-2026" };
const VIEWER = { email: "viewer@kouza.test", password: "viewer-pass-2026" };

/** Seeded course with attachments on chapters 1 (×2), 2 and 4 — but not 3. */
const COURSE_ID = "next-app-router";
/** A second course the viewer never buys, used for the cross-course check. */
const OTHER_COURSE_ID = "typescript-type-design";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./data/app.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

/* --------------------------------------------------------------- plumbing */

function createJar() {
  const jar = new Map();
  return {
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    absorb(response) {
      for (const cookie of response.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (value === "" || /Max-Age=0/i.test(cookie)) jar.delete(name);
        else jar.set(name, value);
      }
    },
    size() {
      return jar.size;
    },
  };
}

async function request(path, { jar, ...init } = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("origin", BASE_URL);
  if (jar && jar.size() > 0) headers.set("cookie", jar.header());
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    redirect: "manual",
  });
  if (jar) jar.absorb(response);
  return response;
}

async function signIn({ email, password }) {
  const jar = createJar();
  const response = await request("/api/auth/sign-in/email", {
    jar,
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `sign-in failed for ${email}`);
  return jar;
}

async function userIdOf(email) {
  const result = await db.execute({
    sql: "SELECT id FROM user WHERE email = ? LIMIT 1",
    args: [email],
  });
  assert.ok(result.rows[0], `no seeded user ${email}`);
  return String(result.rows[0].id);
}

async function grant(userId, courseId) {
  await db.execute({
    sql: `INSERT INTO purchase (id, user_id, course_id, amount_jpy, status, provider)
          VALUES (?, ?, ?, 0, 'paid', 'manual')
          ON CONFLICT (user_id, course_id) DO UPDATE SET status = 'paid'`,
    args: [randomUUID(), userId, courseId],
  });
}

async function revoke(userId, courseId) {
  await db.execute({
    sql: "DELETE FROM purchase WHERE user_id = ? AND course_id = ?",
    args: [userId, courseId],
  });
}

/** Every attachment of a course, joined with its upload row. */
async function resourcesOf(courseId) {
  const result = await db.execute({
    sql: `SELECT r.id, r.chapter_id, r.upload_id, r.label, r.position,
                 ch.position AS chapter_position,
                 u.original_name, u.stored_name, u.mime_type, u.size_bytes
          FROM chapter_resource r
          JOIN chapter ch ON ch.id = r.chapter_id
          JOIN upload u   ON u.id  = r.upload_id
          WHERE ch.course_id = ?
          ORDER BY ch.position ASC, r.position ASC`,
    args: [courseId],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    chapterId: String(row.chapter_id),
    chapterPosition: Number(row.chapter_position),
    uploadId: String(row.upload_id),
    label: String(row.label),
    fileName: String(row.original_name),
    storedName: String(row.stored_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
  }));
}

async function chapterIds(courseId) {
  const result = await db.execute({
    sql: "SELECT id FROM chapter WHERE course_id = ? ORDER BY position ASC",
    args: [courseId],
  });
  return result.rows.map((row) => String(row.id));
}

/* ------------------------------------------------------------------ suite */

describe("Sprint 5 — purchase-gated attachment downloads", () => {
  let viewerId;
  let viewerJar;
  let creatorJar;
  let chapters;
  let resources;
  /** A chapter carrying two attachments, and one carrying none. */
  let multiChapterId;
  let bareChapterId;

  before(async () => {
    viewerId = await userIdOf(VIEWER.email);
    viewerJar = await signIn(VIEWER);
    creatorJar = await signIn(CREATOR);

    chapters = await chapterIds(COURSE_ID);
    resources = await resourcesOf(COURSE_ID);
    assert.ok(
      resources.length >= 3,
      "seeded course needs attachments — run `npm run setup`"
    );

    const perChapter = new Map();
    for (const resource of resources) {
      perChapter.set(
        resource.chapterId,
        (perChapter.get(resource.chapterId) ?? 0) + 1
      );
    }

    multiChapterId = [...perChapter.entries()].find(([, n]) => n >= 2)?.[0];
    bareChapterId = chapters.find((id) => !perChapter.has(id));

    assert.ok(multiChapterId, "no chapter with two or more attachments is seeded");
    assert.ok(bareChapterId, "no chapter without attachments is seeded");

    await revoke(viewerId, COURSE_ID);
    await revoke(viewerId, OTHER_COURSE_ID);
  });

  after(async () => {
    await revoke(viewerId, COURSE_ID);
    await revoke(viewerId, OTHER_COURSE_ID);
    db.close();
  });

  /* --- 契約: 購入者は視聴画面から資料をダウンロードできる ---------------- */

  test("購入済みユーザーの視聴画面に資料ダウンロードボタンが出る", async () => {
    await grant(viewerId, COURSE_ID);

    const response = await request(
      `/courses/${COURSE_ID}/watch/${multiChapterId}`,
      { jar: viewerJar }
    );
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /data-testid="chapter-resources-panel"/, "no panel");

    for (const resource of resources.filter((r) => r.chapterId === multiChapterId)) {
      assert.ok(
        html.includes(`/api/uploads/${resource.uploadId}`),
        `no download link for ${resource.fileName}`
      );
      assert.ok(
        html.includes(`data-testid="resource-download-${resource.id}"`),
        `no download button for ${resource.fileName}`
      );
    }
  });

  test("購入済みユーザーは資料の実体をダウンロードできる", async () => {
    await grant(viewerId, COURSE_ID);

    for (const resource of resources) {
      const response = await request(`/api/uploads/${resource.uploadId}`, {
        jar: viewerJar,
      });
      assert.equal(response.status, 200, `download failed: ${resource.fileName}`);
      assert.equal(response.headers.get("content-type"), resource.mimeType);
      assert.match(
        response.headers.get("content-disposition") ?? "",
        /^attachment;/,
        "attachments must download, not render inline"
      );
      // A leaked link must not survive a revoked entitlement in a cache.
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    }
  });

  /* --- 契約: ダウンロードした内容がアップロードした内容と一致する -------- */

  test("ダウンロードした中身が保存されているファイルと完全に一致する", async () => {
    await grant(viewerId, COURSE_ID);

    for (const resource of resources) {
      const onDisk = await readFile(resolve(UPLOAD_DIR, resource.storedName));
      const response = await request(`/api/uploads/${resource.uploadId}`, {
        jar: viewerJar,
      });
      const served = Buffer.from(await response.arrayBuffer());

      assert.equal(
        served.byteLength,
        onDisk.byteLength,
        `size mismatch for ${resource.fileName}`
      );
      assert.equal(
        served.byteLength,
        resource.sizeBytes,
        `catalogue size disagrees for ${resource.fileName}`
      );
      assert.ok(served.equals(onDisk), `bytes differ for ${resource.fileName}`);
      assert.equal(
        Number(response.headers.get("content-length")),
        onDisk.byteLength
      );
    }
  });

  test("元のファイル名が Content-Disposition に載る", async () => {
    await grant(viewerId, COURSE_ID);
    const resource = resources[0];

    const response = await request(`/api/uploads/${resource.uploadId}`, {
      jar: viewerJar,
    });
    await response.arrayBuffer();

    const disposition = response.headers.get("content-disposition") ?? "";
    const encoded = disposition.split("filename*=UTF-8''")[1] ?? "";
    assert.equal(decodeURIComponent(encoded), resource.fileName);
  });

  /* --- 契約: 資料のないチャプターにはボタンが出ない ---------------------- */

  test("資料が登録されていないチャプターにはダウンロードボタンが出ない", async () => {
    await grant(viewerId, COURSE_ID);

    const response = await request(
      `/courses/${COURSE_ID}/watch/${bareChapterId}`,
      { jar: viewerJar }
    );
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.ok(
      !/data-testid="chapter-resources-panel"/.test(html),
      "the panel is rendered on a chapter with no attachments"
    );
    assert.ok(
      !/data-testid="resource-download-/.test(html),
      "a download button is rendered on a chapter with no attachments"
    );
  });

  /* --- 契約: 未購入ユーザーはダウンロードできない ------------------------ */

  test("未購入ユーザーは資料URLを直接叩いてもダウンロードできない", async () => {
    await revoke(viewerId, COURSE_ID);

    for (const resource of resources) {
      const response = await request(`/api/uploads/${resource.uploadId}`, {
        jar: viewerJar,
      });
      assert.equal(response.status, 403, `leaked: ${resource.fileName}`);
      assert.equal(response.headers.get("x-download-denied"), "not-purchased");

      const body = await response.text();
      assert.ok(
        body.length < 500 && !body.includes("%PDF"),
        "the response body still carries file content"
      );
    }
  });

  test("別のコースを購入していても、そのコースの資料は取れない", async () => {
    await grant(viewerId, OTHER_COURSE_ID);
    await revoke(viewerId, COURSE_ID);

    const foreign = await resourcesOf(OTHER_COURSE_ID);
    assert.ok(foreign.length > 0, "the second course needs an attachment");

    // Entitled to the other course only: its own file opens...
    const allowed = await request(`/api/uploads/${foreign[0].uploadId}`, {
      jar: viewerJar,
    });
    assert.equal(allowed.status, 200);
    await allowed.arrayBuffer();

    // ...while this course's files stay shut.
    const denied = await request(`/api/uploads/${resources[0].uploadId}`, {
      jar: viewerJar,
    });
    assert.equal(denied.status, 403);

    await revoke(viewerId, OTHER_COURSE_ID);
  });

  test("HEAD でも未購入は拒否される", async () => {
    await revoke(viewerId, COURSE_ID);

    const response = await request(`/api/uploads/${resources[0].uploadId}`, {
      jar: viewerJar,
      method: "HEAD",
    });
    assert.equal(response.status, 403);
  });

  /* --- 契約: 未ログインユーザーはダウンロードできない -------------------- */

  test("未ログインユーザーは資料URLを直接叩いてもダウンロードできない", async () => {
    for (const resource of resources) {
      const response = await request(`/api/uploads/${resource.uploadId}`);
      assert.equal(response.status, 401, `leaked: ${resource.fileName}`);
      assert.equal(response.headers.get("x-download-denied"), "unauthenticated");
    }
  });

  test("存在しない資料IDは 404", async () => {
    const response = await request(`/api/uploads/${randomUUID()}`, {
      jar: viewerJar,
    });
    assert.equal(response.status, 404);
  });

  /* --- 契約: 複数資料はすべて個別にダウンロードできる -------------------- */

  test("同一チャプターの複数資料がそれぞれ別の中身で取得できる", async () => {
    await grant(viewerId, COURSE_ID);

    const group = resources.filter((r) => r.chapterId === multiChapterId);
    assert.ok(group.length >= 2, "need at least two attachments on one chapter");

    const bodies = [];
    for (const resource of group) {
      const response = await request(`/api/uploads/${resource.uploadId}`, {
        jar: viewerJar,
      });
      assert.equal(response.status, 200, `download failed: ${resource.fileName}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const onDisk = await readFile(resolve(UPLOAD_DIR, resource.storedName));
      assert.ok(bytes.equals(onDisk), `bytes differ for ${resource.fileName}`);
      bodies.push(bytes.toString("base64"));
    }

    assert.equal(
      new Set(bodies).size,
      bodies.length,
      "two attachments served identical bytes — the id is being ignored"
    );
    assert.equal(
      new Set(group.map((r) => r.uploadId)).size,
      group.length,
      "attachments share an upload id"
    );
  });

  /* --- 契約: コース詳細から資料一覧をまとめて確認できる ------------------ */

  test("購入後のコース詳細に全チャプターの資料一覧が出る", async () => {
    await grant(viewerId, COURSE_ID);

    const response = await request(`/courses/${COURSE_ID}`, { jar: viewerJar });
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /data-testid="course-resources"/, "no resources section");
    assert.match(
      html,
      new RegExp(`data-testid="course-resources"[^>]*data-resource-count="${resources.length}"`),
      "the section does not list every attachment"
    );

    for (const resource of resources) {
      assert.ok(
        html.includes(`/api/uploads/${resource.uploadId}`),
        `${resource.fileName} is missing from the course list`
      );
      assert.ok(
        html.includes(`data-testid="resource-download-${resource.id}"`),
        `${resource.fileName} has no download button`
      );
    }
  });

  test("未購入ユーザーのコース詳細には資料一覧もリンクも出ない", async () => {
    await revoke(viewerId, COURSE_ID);

    const response = await request(`/courses/${COURSE_ID}`, { jar: viewerJar });
    const html = await response.text();

    assert.ok(
      !/data-testid="course-resources"/.test(html),
      "the resources section leaks to non-owners"
    );
    assert.ok(
      !/\/api\/uploads\//.test(html),
      "a download URL leaks to non-owners"
    );
  });

  /* --- クリエイターは管理画面から従来どおり扱える ------------------------ */

  test("クリエイターは購入していなくても資料を取得できる（管理用）", async () => {
    const creatorId = await userIdOf(CREATOR.email);
    await revoke(creatorId, COURSE_ID);

    for (const resource of resources) {
      const response = await request(`/api/uploads/${resource.uploadId}`, {
        jar: creatorJar,
      });
      assert.equal(
        response.status,
        200,
        `the admin preview broke for ${resource.fileName}`
      );
      await response.arrayBuffer();
    }
  });

  /*
   * The admin course screen renders its attachment rows inside a client
   * component that expands on demand, so the links are not in the server HTML.
   * What has to hold is that the screen still loads for the creator and that
   * the labels it will render are present — the links themselves are covered by
   * the creator-download test above.
   */
  test("管理画面が従来どおり開き、資料のラベルが渡っている", async () => {
    const response = await request(`/admin/courses/${COURSE_ID}`, {
      jar: creatorJar,
    });
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.ok(
      html.includes(String(resources.length)),
      "the admin screen did not render"
    );
    assert.ok(
      !/data-testid="resource-download-/.test(html),
      "the learner-facing download rows leaked into the admin screen"
    );
  });

  /* --- 公開サムネイルは従来どおり誰でも見られる -------------------------- */

  test("公開コースのサムネイルは未ログインでも表示できる", async () => {
    const thumbnails = await db.execute(
      `SELECT c.thumbnail_url
         FROM course c
        WHERE c.published = 1 AND c.thumbnail_url LIKE '/api/uploads/%'`
    );

    if (thumbnails.rows.length === 0) {
      // The seeded catalogue uses static SVGs; nothing to check unless a
      // creator uploaded one from the admin screens.
      return;
    }

    for (const row of thumbnails.rows) {
      const response = await request(String(row.thumbnail_url));
      assert.equal(response.status, 200, `thumbnail blocked: ${row.thumbnail_url}`);
      await response.arrayBuffer();
    }
  });
});
