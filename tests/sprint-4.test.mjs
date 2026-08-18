/**
 * Sprint 4 contract tests — protected playback, expiry, and progress.
 *
 * Exercises the running app over HTTP against the real database. No mocks: the
 * streaming route really serves bytes, the tokens are really signed, and the
 * progress rows are really written.
 *
 *   npm run dev            # terminal 1
 *   npm test               # terminal 2
 *
 * Requires the seeded demo accounts and the generated placeholder clips
 * (`npm run setup`).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { createHmac, randomUUID } from "node:crypto";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");

const CREATOR = { email: "creator@kouza.test", password: "creator-pass-2026" };
const VIEWER = { email: "viewer@kouza.test", password: "viewer-pass-2026" };

/** A published course with several chapters (see scripts/seed-data.mjs). */
const COURSE_ID = "next-app-router";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./data/app.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

const SECURITY_KEY =
  process.env.BUNNY_STREAM_TOKEN_KEY?.trim() ||
  process.env.BETTER_AUTH_SECRET?.trim();

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

/**
 * The same signature the server mints — bunny.net's production Token
 * Authentication scheme (Sprint 6): "HS256-" + base64url(HMAC-SHA256 over
 * path + expires). See src/lib/video-token.ts.
 */
function signPlayback(path, expires) {
  return (
    "HS256-" +
    createHmac("sha256", SECURITY_KEY)
      .update(`${path}${expires}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
}

function streamUrl(chapterId, ttlSeconds) {
  const path = `/api/stream/${chapterId}`;
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = signPlayback(path, expires);
  return `${path}?token=${encodeURIComponent(token)}&expires=${expires}`;
}

async function userIdOf(email) {
  const result = await db.execute({
    sql: "SELECT id FROM user WHERE email = ? LIMIT 1",
    args: [email],
  });
  assert.ok(result.rows[0], `no seeded user ${email}`);
  return String(result.rows[0].id);
}

async function chapterIds(courseId) {
  const result = await db.execute({
    sql: "SELECT id FROM chapter WHERE course_id = ? ORDER BY position ASC",
    args: [courseId],
  });
  return result.rows.map((row) => String(row.id));
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

async function clearProgress(userId, courseId) {
  await db.execute({
    sql: "DELETE FROM chapter_progress WHERE user_id = ? AND course_id = ?",
    args: [userId, courseId],
  });
}

/* ------------------------------------------------------------------ suite */

describe("Sprint 4 — protected playback and progress", () => {
  let viewerId;
  let creatorId;
  let chapters;
  let viewerJar;

  before(async () => {
    assert.ok(SECURITY_KEY, "BUNNY_STREAM_TOKEN_KEY / BETTER_AUTH_SECRET must be set");
    viewerId = await userIdOf(VIEWER.email);
    creatorId = await userIdOf(CREATOR.email);
    chapters = await chapterIds(COURSE_ID);
    assert.ok(chapters.length >= 3, "seeded course needs several chapters");
    viewerJar = await signIn(VIEWER);
    await clearProgress(viewerId, COURSE_ID);
    await revoke(viewerId, COURSE_ID);
    await revoke(creatorId, COURSE_ID);
  });

  after(async () => {
    await clearProgress(viewerId, COURSE_ID);
    await revoke(viewerId, COURSE_ID);
    db.close();
  });

  /* --- 契約: 購入済みユーザーは再生できる ------------------------------- */

  test("購入済みユーザーは署名付きURLで動画を取得できる", async () => {
    await grant(viewerId, COURSE_ID);

    const response = await request(streamUrl(chapters[0], 600), {
      jar: viewerJar,
      headers: { range: "bytes=0-1023" },
    });

    assert.equal(response.status, 206);
    assert.match(response.headers.get("content-type") ?? "", /^video\//);
    assert.equal(response.headers.get("accept-ranges"), "bytes");

    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.byteLength, 1024);
    // "ftyp" at offset 4 — this really is an MP4, not an error page.
    assert.equal(String.fromCharCode(...bytes.slice(4, 8)), "ftyp");
  });

  test("購入済みユーザーの再生ページに video 要素が描画される", async () => {
    await grant(viewerId, COURSE_ID);

    const response = await request(
      `/courses/${COURSE_ID}/watch/${chapters[0]}`,
      { jar: viewerJar }
    );
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /<video/, "player is missing");
    assert.match(html, /\/api\/stream\//, "signed stream URL is missing");
    assert.match(html, /token=/, "playback token is missing");
  });

  /* --- 契約: 動画のダウンロード導線が存在しない -------------------------- */

  /*
   * Sprint 5 added purchase-gated *attachment* downloads to this same page, so
   * this check is about the video specifically: no download affordance may point
   * at the stream, and the raw media path must never appear. Attachment links
   * (`/api/uploads/...`) are a separate, gated surface and are expected here.
   */
  test("再生ページに動画のダウンロード導線が存在しない", async () => {
    await grant(viewerId, COURSE_ID);

    const response = await request(
      `/courses/${COURSE_ID}/watch/${chapters[0]}`,
      { jar: viewerJar }
    );
    const html = await response.text();

    assert.match(html, /controlsList="[^"]*nodownload/, "controlsList is missing");
    assert.ok(!/\.mp4/.test(html), "a raw media file path is exposed");
    assert.ok(
      !/href="[^"]*\/api\/stream\//.test(html),
      "the stream URL is linkable"
    );
    for (const attribute of html.match(/download="[^"]*"/g) ?? []) {
      assert.ok(
        !/\.mp4|stream/i.test(attribute),
        `a video download attribute is present: ${attribute}`
      );
    }
  });

  test("ストリーミング応答は inline かつ no-store で返る", async () => {
    await grant(viewerId, COURSE_ID);

    const response = await request(streamUrl(chapters[0], 600), {
      jar: viewerJar,
      headers: { range: "bytes=0-99" },
    });

    assert.equal(response.headers.get("content-disposition"), "inline");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    await response.arrayBuffer();
  });

  /* --- 契約: 未ログイン / 未購入は再生できない --------------------------- */

  test("未ログインでは再生URLが 401 になる", async () => {
    const response = await request(streamUrl(chapters[0], 600));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("x-playback-denied"), "unauthenticated");
  });

  test("未ログインで再生ページを開くとログインへリダイレクトされる", async () => {
    const response = await request(`/courses/${COURSE_ID}/watch/${chapters[0]}`);
    assert.ok(
      response.status >= 300 && response.status < 400,
      `expected a redirect, got ${response.status}`
    );
    assert.match(response.headers.get("location") ?? "", /\/login/);
  });

  test("未購入ユーザーは正しい署名でも再生できない", async () => {
    await revoke(viewerId, COURSE_ID);

    const response = await request(streamUrl(chapters[0], 600), {
      jar: viewerJar,
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("x-playback-denied"), "not-purchased");
  });

  test("未購入ユーザーの再生ページには video 要素が無い", async () => {
    await revoke(viewerId, COURSE_ID);

    const response = await request(
      `/courses/${COURSE_ID}/watch/${chapters[0]}`,
      { jar: viewerJar }
    );
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.ok(!/<video/.test(html), "a player was rendered for a non-buyer");
    assert.ok(!/\/api\/stream\//.test(html), "a stream URL leaked to a non-buyer");
  });

  test("別のパス宛てに署名されたトークンは通らない", async () => {
    await grant(viewerId, COURSE_ID);

    // bunny.net tokens are bound to the exact media path: a token minted for
    // chapter 2 must not open chapter 1.
    const path = `/api/stream/${chapters[0]}`;
    const expires = Math.floor(Date.now() / 1000) + 600;
    const token = signPlayback(`/api/stream/${chapters[1]}`, expires);

    const response = await request(
      `${path}?token=${encodeURIComponent(token)}&expires=${expires}`,
      { jar: viewerJar }
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("x-playback-denied"), "invalid");
  });

  test("トークンは HS256- プレフィックス付きの base64url 形式である", async () => {
    await grant(viewerId, COURSE_ID);

    const path = `/api/stream/${chapters[0]}`;
    const expires = Math.floor(Date.now() / 1000) + 600;
    const token = signPlayback(path, expires);
    assert.match(token, /^HS256-[A-Za-z0-9_-]+$/);

    const response = await request(
      `${path}?token=${encodeURIComponent(token)}&expires=${expires}`,
      { jar: viewerJar, headers: { range: "bytes=0-99" } }
    );
    assert.equal(response.status, 206);
  });

  /* --- 契約: トークンの有効期限 ----------------------------------------- */

  test("期限切れトークンでは再生できない", async () => {
    await grant(viewerId, COURSE_ID);

    const path = `/api/stream/${chapters[0]}`;
    const expires = Math.floor(Date.now() / 1000) - 5;
    const token = signPlayback(path, expires);

    const response = await request(
      `${path}?token=${encodeURIComponent(token)}&expires=${expires}`,
      { jar: viewerJar }
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("x-playback-denied"), "expired");
  });

  test("有効期限を書き換えたURLは署名不一致で弾かれる", async () => {
    await grant(viewerId, COURSE_ID);

    const path = `/api/stream/${chapters[0]}`;
    const expires = Math.floor(Date.now() / 1000) + 60;
    const token = signPlayback(path, expires);
    const tampered = expires + 60 * 60 * 24;

    const response = await request(
      `${path}?token=${encodeURIComponent(token)}&expires=${tampered}`,
      { jar: viewerJar }
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("x-playback-denied"), "invalid");
  });

  test("トークンなしのアクセスは拒否される", async () => {
    await grant(viewerId, COURSE_ID);

    const response = await request(`/api/stream/${chapters[0]}`, { jar: viewerJar });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("x-playback-denied"), "missing");
  });

  test("?ttl= で短命なトークンを発行でき、経過後は失効する", async () => {
    await grant(viewerId, COURSE_ID);

    const page = await request(
      `/courses/${COURSE_ID}/watch/${chapters[0]}?ttl=5`,
      { jar: viewerJar }
    );
    const html = await page.text();
    const match = /\/api\/stream\/[^"&]+\?token=([^"&]+)&(?:amp;)?expires=(\d+)/.exec(
      html
    );
    assert.ok(match, "no signed stream URL in the page");

    const expires = Number(match[2]);
    const lifetime = expires - Math.floor(Date.now() / 1000);
    assert.ok(
      lifetime > 0 && lifetime <= 6,
      `expected a ~5s lifetime, got ${lifetime}s`
    );
  });

  /* --- 契約: 視聴進捗の保存と再開 ---------------------------------------- */

  test("再生位置が保存され、再訪時に続きから再開する", async () => {
    await grant(viewerId, COURSE_ID);
    await clearProgress(viewerId, COURSE_ID);

    const saved = await request("/api/progress", {
      jar: viewerJar,
      method: "POST",
      body: JSON.stringify({
        chapterId: chapters[0],
        positionSeconds: 9.5,
        durationSeconds: 24,
        completed: false,
      }),
    });
    assert.equal(saved.status, 200);

    const body = await saved.json();
    assert.equal(body.progress.completed, false);
    assert.ok(Math.abs(body.progress.positionSeconds - 9.5) < 0.01);

    const row = await db.execute({
      sql: "SELECT position_seconds FROM chapter_progress WHERE user_id = ? AND chapter_id = ?",
      args: [viewerId, chapters[0]],
    });
    assert.ok(Math.abs(Number(row.rows[0].position_seconds) - 9.5) < 0.01);

    // Reopening the chapter must announce the resume, which only happens when
    // the server hands the player a non-zero start position.
    const page = await request(
      `/courses/${COURSE_ID}/watch/${chapters[0]}`,
      { jar: viewerJar }
    );
    const html = await page.text();
    assert.match(html, /resumeSeconds\\?":9\.5|9\.5/, "resume position not sent to the player");
  });

  test("未購入ユーザーは進捗を保存できない", async () => {
    await revoke(viewerId, COURSE_ID);

    const response = await request("/api/progress", {
      jar: viewerJar,
      method: "POST",
      body: JSON.stringify({
        chapterId: chapters[0],
        positionSeconds: 5,
        durationSeconds: 24,
      }),
    });
    assert.equal(response.status, 403);
  });

  test("未ログインユーザーは進捗を保存できない", async () => {
    const response = await request("/api/progress", {
      method: "POST",
      body: JSON.stringify({ chapterId: chapters[0], positionSeconds: 5 }),
    });
    assert.equal(response.status, 401);
  });

  /* --- 契約: 視聴完了マークと進捗表示 ------------------------------------ */

  test("最後まで視聴すると視聴完了としてマークされる", async () => {
    await grant(viewerId, COURSE_ID);
    await clearProgress(viewerId, COURSE_ID);

    const response = await request("/api/progress", {
      jar: viewerJar,
      method: "POST",
      body: JSON.stringify({
        chapterId: chapters[0],
        positionSeconds: 24,
        durationSeconds: 24,
        completed: true,
      }),
    });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.progress.completed, true);
    assert.ok(body.progress.completedAt, "completedAt was not recorded");
  });

  test("95% を超えた時点で完了扱いになり、巻き戻しても解除されない", async () => {
    await grant(viewerId, COURSE_ID);
    await clearProgress(viewerId, COURSE_ID);

    const first = await request("/api/progress", {
      jar: viewerJar,
      method: "POST",
      body: JSON.stringify({
        chapterId: chapters[1],
        positionSeconds: 29,
        durationSeconds: 30,
      }),
    });
    assert.equal((await first.json()).progress.completed, true);

    const rewound = await request("/api/progress", {
      jar: viewerJar,
      method: "POST",
      body: JSON.stringify({
        chapterId: chapters[1],
        positionSeconds: 2,
        durationSeconds: 30,
      }),
    });
    assert.equal((await rewound.json()).progress.completed, true);
  });

  test("コース詳細に各チャプターの完了状況が一覧表示される", async () => {
    await grant(viewerId, COURSE_ID);
    await clearProgress(viewerId, COURSE_ID);

    await request("/api/progress", {
      jar: viewerJar,
      method: "POST",
      body: JSON.stringify({
        chapterId: chapters[0],
        positionSeconds: 24,
        durationSeconds: 24,
        completed: true,
      }),
    });

    const response = await request(`/courses/${COURSE_ID}`, { jar: viewerJar });
    const html = await response.text();

    assert.match(html, /視聴完了/, "no completion label");
    assert.match(html, /未完了/, "no not-yet label");
    assert.match(html, /チャプター視聴完了/, "no completion count");

    const percent = Math.round((1 / chapters.length) * 100);
    assert.match(
      html,
      new RegExp(`data-percent="${percent}"`),
      `course progress should read ${percent}%`
    );
  });

  test("全チャプター完了でコース進捗が 100% になる", async () => {
    await grant(viewerId, COURSE_ID);
    await clearProgress(viewerId, COURSE_ID);

    for (const chapterId of chapters) {
      const response = await request("/api/progress", {
        jar: viewerJar,
        method: "POST",
        body: JSON.stringify({
          chapterId,
          positionSeconds: 999,
          durationSeconds: 24,
          completed: true,
        }),
      });
      assert.equal(response.status, 200);
    }

    const response = await request(`/courses/${COURSE_ID}`, { jar: viewerJar });
    const html = await response.text();

    assert.match(html, /data-percent="100"/, "course progress is not 100%");
    assert.match(html, /このコースをすべて視聴しました/, "no completion banner");
    assert.ok(!/未完了/.test(html), "a chapter is still marked incomplete");
  });

  test("未購入ユーザーのコース詳細には進捗が出ない", async () => {
    await revoke(viewerId, COURSE_ID);

    const response = await request(`/courses/${COURSE_ID}`, { jar: viewerJar });
    const html = await response.text();

    assert.ok(!/data-testid="course-progress"/.test(html));
    assert.match(html, /購入後に視聴/);
  });
});
