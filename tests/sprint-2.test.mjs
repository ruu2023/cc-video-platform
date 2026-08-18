/**
 * Sprint 2 contract tests — admin area, roles, and public reflection.
 *
 * Exercises the running app over HTTP against the real database. No mocks.
 *
 *   npm run dev            # terminal 1
 *   npm test               # terminal 2
 *
 * Requires the seeded demo accounts (`npm run db:seed`).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");

const CREATOR = { email: "creator@kouza.test", password: "creator-pass-2026" };
const VIEWER = { email: "viewer@kouza.test", password: "viewer-pass-2026" };
const DRAFT_ID = "stripe-billing-handson";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./data/app.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

/** Minimal cookie jar so one "browser session" persists across requests. */
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
  assert.ok(jar.size() > 0, "sign-in set no session cookie");
  return jar;
}

/** Follows Next.js redirects manually so the final URL can be asserted. */
async function follow(path, jar) {
  let current = path;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await request(current, { jar });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      current = location.startsWith("http")
        ? new URL(location).pathname + new URL(location).search
        : location;
      continue;
    }
    return { path: current, response };
  }
  throw new Error(`Too many redirects starting at ${path}`);
}

const UPLOAD_DIR = resolve(process.cwd(), "data", "uploads");

/**
 * Registers an attachment exactly the way the admin upload does (catalogue row
 * + bytes on disk) so the download route and the public badge can be asserted
 * without depending on data left behind by a previous run.
 */
async function attachFixture(chapterId, label) {
  const id = randomUUID();
  const storedName = `${id}.pdf`;
  const bytes = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
  );

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, storedName), bytes);

  await db.execute({
    sql: `INSERT INTO upload
            (id, original_name, stored_name, mime_type, size_bytes, kind)
          VALUES (?, ?, ?, 'application/pdf', ?, 'resource')`,
    args: [id, "contract-fixture.pdf", storedName, bytes.byteLength],
  });

  const resourceId = `res-${id}`;
  await db.execute({
    sql: `INSERT INTO chapter_resource (id, chapter_id, upload_id, label, position)
          VALUES (?, ?, ?, ?, 999)`,
    args: [resourceId, chapterId, id, label],
  });

  return {
    uploadId: id,
    sizeBytes: bytes.byteLength,
    async cleanup() {
      await db.execute({
        sql: "DELETE FROM chapter_resource WHERE id = ?",
        args: [resourceId],
      });
      await db.execute({ sql: "DELETE FROM upload WHERE id = ?", args: [id] });
      await unlink(join(UPLOAD_DIR, storedName)).catch(() => {});
    },
  };
}

async function firstChapterOf(courseId) {
  const result = await db.execute({
    sql: "SELECT id FROM chapter WHERE course_id = ? ORDER BY position LIMIT 1",
    args: [courseId],
  });
  assert.ok(result.rows[0], `course ${courseId} has no chapters`);
  return String(result.rows[0].id);
}

async function setPublished(courseId, published) {
  await db.execute({
    sql: "UPDATE course SET published = ? WHERE id = ?",
    args: [published ? 1 : 0, courseId],
  });
}

before(async () => {
  try {
    const probe = await fetch(`${BASE_URL}/courses`);
    assert.ok(probe.ok, `${BASE_URL}/courses responded ${probe.status}`);
  } catch (error) {
    throw new Error(
      `The app is not reachable at ${BASE_URL}. Start it with \`npm run dev\` first. (${error.message})`
    );
  }
});

after(() => db.close());

describe("管理画面のアクセス制御", () => {
  test("未ログインでは /admin がログイン画面へリダイレクトされる", async () => {
    const response = await request("/admin");
    assert.ok(
      response.status >= 300 && response.status < 400,
      `expected a redirect, got ${response.status}`
    );
    const location = response.headers.get("location") ?? "";
    assert.match(location, /\/login/);
    assert.match(decodeURIComponent(location), /next=\/admin/);
  });

  test("クリエイターは管理画面にアクセスできる", async () => {
    const jar = await signIn(CREATOR);

    const dashboard = await follow("/admin", jar);
    assert.equal(dashboard.path, "/admin");
    assert.equal(dashboard.response.status, 200);

    const html = await dashboard.response.text();
    assert.match(html, /admin-course-list/);
    assert.match(html, /新しいコースを作成/);
  });

  test("クリエイターはコース作成・編集画面を開ける", async () => {
    const jar = await signIn(CREATOR);

    for (const path of ["/admin/courses/new", `/admin/courses/${DRAFT_ID}`]) {
      const result = await follow(path, jar);
      assert.equal(result.path, path, `${path} redirected away`);
      assert.equal(result.response.status, 200);
    }
  });

  test("視聴者アカウントは管理画面にアクセスできない", async () => {
    const jar = await signIn(VIEWER);

    for (const path of ["/admin", "/admin/courses/new", `/admin/courses/${DRAFT_ID}`]) {
      const result = await follow(path, jar);
      assert.equal(
        result.path,
        "/access-denied",
        `${path} should be refused for a viewer`
      );
      const html = await result.response.text();
      assert.match(html, /管理画面へのアクセス権がありません/);
    }
  });

  test("新規登録したアカウントは viewer 権限で作られ、管理画面に入れない", async () => {
    const email = `signup-${Date.now()}@example.com`;
    const jar = createJar();

    const signup = await request("/api/auth/sign-up/email", {
      jar,
      method: "POST",
      body: JSON.stringify({
        email,
        password: "test-pass-2026",
        name: "新規 受講者",
        // A self-declared role must not be honoured.
        role: "creator",
      }),
    });
    assert.equal(signup.status, 200);

    const row = await db.execute({
      sql: "SELECT role FROM user WHERE email = ?",
      args: [email],
    });
    assert.equal(row.rows[0]?.role, "viewer");

    const result = await follow("/admin", jar);
    assert.equal(result.path, "/access-denied");

    await db.execute({ sql: "DELETE FROM user WHERE email = ?", args: [email] });
  });
});

describe("公開・非公開の切り替えが公開ページに反映される", () => {
  test("非公開コースは一覧に出ず、詳細は 404 になる", async () => {
    await setPublished(DRAFT_ID, false);

    const list = await request("/courses");
    const html = await list.text();
    assert.equal(list.status, 200);
    assert.ok(
      !html.includes(`/courses/${DRAFT_ID}`),
      "draft course leaked into the public list"
    );

    const detail = await request(`/courses/${DRAFT_ID}`);
    assert.equal(detail.status, 404);
  });

  test("公開に切り替えると一覧と詳細に現れる", async () => {
    await setPublished(DRAFT_ID, true);
    try {
      const list = await request("/courses");
      const html = await list.text();
      assert.ok(
        html.includes(`/courses/${DRAFT_ID}`),
        "published course missing from the public list"
      );

      const detail = await request(`/courses/${DRAFT_ID}`);
      assert.equal(detail.status, 200);
    } finally {
      await setPublished(DRAFT_ID, false);
    }
  });
});

describe("チャプターと付属資料が視聴者向けページに反映される", () => {
  test("詳細ページのカリキュラムが position 順に並ぶ", async () => {
    const courseId = "next-app-router";
    const chapters = await db.execute({
      sql: "SELECT title FROM chapter WHERE course_id = ? ORDER BY position ASC",
      args: [courseId],
    });
    assert.ok(chapters.rows.length > 1, "fixture course needs several chapters");

    const html = await (await request(`/courses/${courseId}`)).text();
    const positions = chapters.rows.map((row) => html.indexOf(String(row.title)));

    for (const [index, at] of positions.entries()) {
      assert.ok(at > -1, `chapter "${chapters.rows[index].title}" missing from page`);
      if (index > 0) {
        assert.ok(
          at > positions[index - 1],
          "chapters are not rendered in position order"
        );
      }
    }
  });

  test("資料を紐付けたチャプターには件数バッジが表示される", async () => {
    const courseId = "next-app-router";
    const chapterId = await firstChapterOf(courseId);

    const before = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM chapter_resource WHERE chapter_id = ?",
      args: [chapterId],
    });
    const expected = Number(before.rows[0].n) + 1;

    const fixture = await attachFixture(chapterId, "契約テスト資料");
    try {
      // React splits interpolated text with `<!-- -->` markers, so strip
      // comments before looking for the rendered "資料 N 件" label.
      const html = (await (await request(`/courses/${courseId}`)).text()).replace(
        /<!--.*?-->/g,
        ""
      );
      assert.match(html, /chapter-resources/);
      assert.ok(
        html.includes(`資料 ${expected} 件`),
        `expected an attachment count of ${expected} on /courses/${courseId}`
      );
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("アップロードされたファイルの配信", () => {
  /*
   * Sprint 5 put attachments behind the purchase gate, so this Sprint 2
   * contract ("the file comes back with its original name and type") is now
   * exercised as the creator — the role that uploaded it and still previews it
   * from the admin screens. The gate itself is covered by tests/sprint-5.
   */
  test("登録済みの資料は元のファイル名・種別でダウンロードできる", async () => {
    const chapterId = await firstChapterOf("next-app-router");
    const fixture = await attachFixture(chapterId, "ダウンロード確認用");
    const jar = await signIn(CREATOR);

    try {
      const response = await request(`/api/uploads/${fixture.uploadId}`, { jar });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.match(
        response.headers.get("content-disposition") ?? "",
        /attachment/,
        "attachments must download rather than render inline"
      );
      assert.match(
        response.headers.get("content-disposition") ?? "",
        /contract-fixture\.pdf/
      );
      const body = await response.arrayBuffer();
      assert.equal(body.byteLength, fixture.sizeBytes);
    } finally {
      await fixture.cleanup();
    }
  });

  test("存在しないアップロードIDは 404 を返す", async () => {
    const jar = await signIn(CREATOR);
    const response = await request(
      "/api/uploads/00000000-0000-4000-8000-000000000000",
      { jar }
    );
    assert.equal(response.status, 404);
  });
});
