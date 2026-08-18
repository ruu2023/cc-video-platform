/**
 * Sprint 6 contract tests — bunny.net production playback.
 *
 * Runs against the live app AND the live bunny.net account (Stream library,
 * Storage Zone, both CDNs). No mocks: tokens are really signed, the CDN
 * really serves bytes, the Storage API really stores files, and the upload
 * test really waits for bunny to finish encoding.
 *
 *   npm run dev            # terminal 1
 *   npm test               # terminal 2
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");

const CREATOR = { email: "creator@kouza.test", password: "creator-pass-2026" };
const VIEWER = { email: "viewer@kouza.test", password: "viewer-pass-2026" };

const STREAM_HOST = process.env.BUNNY_STREAM_HOSTNAME?.trim();
const ASSETS_HOST = process.env.BUNNY_ASSETS_HOSTNAME?.trim();
const STREAM_TOKEN_KEY = process.env.BUNNY_STREAM_TOKEN_KEY?.trim();
const CDN_TOKEN_KEY = process.env.BUNNY_CDN_TOKEN_KEY?.trim();
const STREAM_API_KEY = process.env.BUNNY_STREAM_API_KEY?.trim();
const STORAGE_KEY = process.env.BUNNY_STORAGE_KEY?.trim();
const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE?.trim();
const STORAGE_API_HOST = (
  process.env.BUNNY_STORAGE_API_HOST?.trim() || "https://storage.bunnycdn.com"
).replace(/\/+$/, "");

/** The finished video that already exists in the bunny.net library. */
const EXISTING_GUID = "a0058ffd-91ce-46b0-a39e-c593be7f9a52";

const LINK_COURSE = "next-app-router"; // chapter 6 gets the existing video
const LINK_CHAPTER_POSITION = 6;
const UPLOAD_COURSE = "typescript-type-design"; // chapter 5 receives an upload
const UPLOAD_CHAPTER_POSITION = 5;

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

const b64url = (buffer) =>
  Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The bunny.net pull-zone token scheme both CDNs accept (verified live). */
function cdnToken(key, path, expires) {
  return `HS256-${b64url(
    createHmac("sha256", key).update(`${path}${expires}`).digest()
  )}`;
}

async function chapterAt(courseId, position) {
  const result = await db.execute({
    sql: "SELECT id, bunny_video_id FROM chapter WHERE course_id = ? AND position = ?",
    args: [courseId, position],
  });
  const row = result.rows[0];
  assert.ok(row, `chapter ${courseId}#${position} is missing`);
  return { id: String(row.id), bunnyVideoId: String(row.bunny_video_id ?? "") };
}

async function grant(userId, courseId) {
  const { randomUUID } = await import("node:crypto");
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

async function userIdOf(email) {
  const result = await db.execute({
    sql: "SELECT id FROM user WHERE email = ? LIMIT 1",
    args: [email],
  });
  assert.ok(result.rows[0], `no seeded user ${email}`);
  return String(result.rows[0].id);
}

/** Extracts the first signed CDN media URL from a watch page's HTML. */
function extractPlaybackUrl(html) {
  const match = new RegExp(
    `https://${STREAM_HOST.replace(/\./g, "\\.")}/[0-9a-f-]+/play_720p\\.mp4\\?token=HS256-[A-Za-z0-9_-]+(?:&amp;|&)expires=\\d+`
  ).exec(html);
  return match ? match[0].replace(/&amp;/g, "&") : null;
}

function extractThumbnailUrls(html) {
  const pattern = new RegExp(
    `https://${ASSETS_HOST.replace(/\./g, "\\.")}/[^"'\\s]+?\\?token=HS256-[A-Za-z0-9_-]+(?:&amp;|&)expires=\\d+`,
    "g"
  );
  return [...html.matchAll(pattern)].map((match) => match[0].replace(/&amp;/g, "&"));
}

/* ------------------------------------------------------------------ suite */

describe("Sprint 6 — bunny.net 本番配信", () => {
  let viewerId;
  let viewerJar;
  let creatorJar;
  let linkChapter;
  let uploadChapter;
  let uploadedGuid;

  before(async () => {
    for (const [name, value] of [
      ["BUNNY_STREAM_HOSTNAME", STREAM_HOST],
      ["BUNNY_ASSETS_HOSTNAME", ASSETS_HOST],
      ["BUNNY_STREAM_TOKEN_KEY", STREAM_TOKEN_KEY],
      ["BUNNY_CDN_TOKEN_KEY", CDN_TOKEN_KEY],
      ["BUNNY_STREAM_API_KEY", STREAM_API_KEY],
      ["BUNNY_STORAGE_KEY", STORAGE_KEY],
      ["BUNNY_STORAGE_ZONE", STORAGE_ZONE],
    ]) {
      assert.ok(value, `${name} must be set`);
    }

    viewerId = await userIdOf(VIEWER.email);
    viewerJar = await signIn(VIEWER);
    creatorJar = await signIn(CREATOR);

    linkChapter = await chapterAt(LINK_COURSE, LINK_CHAPTER_POSITION);
    uploadChapter = await chapterAt(UPLOAD_COURSE, UPLOAD_CHAPTER_POSITION);

    // What the admin screen does when a bunny video id is attached (feature C):
    // the guid lands on the chapter row; the app pulls duration/title from
    // bunny on save. The duration write is replicated here directly.
    await db.execute({
      sql: "UPDATE chapter SET bunny_video_id = ?, duration_seconds = 4 WHERE id = ?",
      args: [EXISTING_GUID, linkChapter.id],
    });

    await grant(viewerId, LINK_COURSE);
    await grant(viewerId, UPLOAD_COURSE);
  });

  after(async () => {
    await revoke(viewerId, LINK_COURSE);
    await revoke(viewerId, UPLOAD_COURSE);
    db.close();
  });

  /* --- 機能A: 署名付き再生URL ------------------------------------------- */

  test("購入済みユーザーの視聴ページは BUNNY_STREAM_HOSTNAME 配下の token/expires 付きURLを読み込む", async () => {
    const response = await request(
      `/courses/${LINK_COURSE}/watch/${linkChapter.id}`,
      { jar: viewerJar }
    );
    assert.equal(response.status, 200);
    const html = await response.text();

    const playbackUrl = extractPlaybackUrl(html);
    assert.ok(playbackUrl, `no signed CDN URL in the page:\n${html.slice(0, 400)}`);
    assert.ok(
      playbackUrl.startsWith(`https://${STREAM_HOST}/${EXISTING_GUID}/play_720p.mp4?`),
      `unexpected playback url: ${playbackUrl}`
    );
    assert.match(playbackUrl, /[?&]token=HS256-/);
    assert.match(playbackUrl, /[?&]expires=\d+/);
  });

  test("発行される token は HS256- プレフィックスの base64url で、鍵の生値と path+expires から計算される", async () => {
    const response = await request(
      `/courses/${LINK_COURSE}/watch/${linkChapter.id}`,
      { jar: viewerJar }
    );
    const html = await response.text();
    const playbackUrl = extractPlaybackUrl(html);
    assert.ok(playbackUrl);

    const url = new URL(playbackUrl);
    const token = url.searchParams.get("token");
    const expires = url.searchParams.get("expires");
    assert.match(token, /^HS256-[A-Za-z0-9_-]+$/);

    // Reproduce the signature the way bunny does; a byte-different key or a
    // subject-suffixed message would not match.
    const expected = cdnToken(STREAM_TOKEN_KEY, url.pathname, expires);
    assert.equal(token, expected);
  });

  test("署名付き再生URLはそのまま取得すると 200、改変・期限切れでは取得できない", async () => {
    const page = await request(`/courses/${LINK_COURSE}/watch/${linkChapter.id}`, {
      jar: viewerJar,
    });
    const playbackUrl = extractPlaybackUrl(await page.text());
    assert.ok(playbackUrl);

    const valid = await fetch(playbackUrl);
    assert.equal(valid.status, 200);
    assert.match(valid.headers.get("content-type") ?? "", /^video\/mp4/);

    const tampered = playbackUrl.replace(/token=HS256-(.)/, "token=HS256-X");
    const tamperedResponse = await fetch(tampered);
    assert.equal(tamperedResponse.status, 403);

    const url = new URL(playbackUrl);
    const past = Math.floor(Date.now() / 1000) - 100;
    const expired = `https://${url.host}${url.pathname}?token=${encodeURIComponent(
      cdnToken(STREAM_TOKEN_KEY, url.pathname, past)
    )}&expires=${past}`;
    const expiredResponse = await fetch(expired);
    assert.equal(expiredResponse.status, 403);

    // No token at all — direct access without going through the issuing path.
    const bare = await fetch(`https://${url.host}${url.pathname}`);
    assert.equal(bare.status, 403);
  });

  test("MP4再生はレンジリクエスト（シーク）に対応し、途中からも取得できる", async () => {
    const page = await request(`/courses/${LINK_COURSE}/watch/${linkChapter.id}`, {
      jar: viewerJar,
    });
    const playbackUrl = extractPlaybackUrl(await page.text());
    assert.ok(playbackUrl);

    const size = Number((await fetch(playbackUrl)).headers.get("content-length"));
    assert.ok(size > 0, "no content-length on the media response");
    const mid = Math.floor(size / 2);

    const range = await fetch(playbackUrl, {
      headers: { range: `bytes=${mid}-${mid + 1023}` },
    });
    assert.equal(range.status, 206);
    assert.match(range.headers.get("content-range") ?? "", /^bytes /);
    assert.equal(Number(range.headers.get("content-length")), 1024);
  });

  test("未ログイン・未購入では署名URLが発行されない（Sprint 4 の保護の維持）", async () => {
    const anonymous = await request(
      `/courses/${LINK_COURSE}/watch/${linkChapter.id}`
    );
    assert.ok(anonymous.status >= 300 && anonymous.status < 400, "expected login redirect");
    assert.ok(!(await anonymous.text()).includes(STREAM_HOST));

    await revoke(viewerId, LINK_COURSE);
    const locked = await request(`/courses/${LINK_COURSE}/watch/${linkChapter.id}`, {
      jar: viewerJar,
    });
    assert.equal(locked.status, 200);
    const html = await locked.text();
    assert.ok(!/<video/.test(html), "a player was rendered for a non-buyer");
    assert.ok(!html.includes(STREAM_HOST), "a CDN URL leaked to a non-buyer");
    await grant(viewerId, LINK_COURSE);
  });

  /* --- 機能B: サムネイルのStorage保存・CDN配信 -------------------------- */

  test("コース一覧・詳細のサムネイルは BUNNY_ASSETS_HOSTNAME 配下の署名付きURLで 200", async () => {
    for (const path of ["/courses", `/courses/${LINK_COURSE}`]) {
      const response = await request(path, { jar: viewerJar });
      assert.equal(response.status, 200);
      const urls = extractThumbnailUrls(await response.text());
      assert.ok(urls.length > 0, `no CDN thumbnail on ${path}`);
      const image = await fetch(urls[0]);
      assert.equal(image.status, 200);
      assert.match(image.headers.get("content-type") ?? "", /^image\//);
    }
  });

  test("Storage Zone への書き込みはリージョン別APIホストでのみ成功する", async () => {
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
        "01f15c4890000000d49444154789c626001000000ffff03000006000557bfabd400" +
        "00000049454e44ae426082",
      "hex"
    );
    const path = `thumbnails/sprint6-test-${Date.now()}.png`;

    const put = await fetch(`${STORAGE_API_HOST}/${STORAGE_ZONE}/${path}`, {
      method: "PUT",
      headers: { AccessKey: STORAGE_KEY, "content-type": "image/png" },
      body: png,
    });
    assert.ok(put.ok, `regional PUT failed: ${put.status}`);

    // The signed pull-zone URL serves it back…
    const expires = Math.floor(Date.now() / 1000) + 600;
    const token = cdnToken(CDN_TOKEN_KEY, `/${path}`, expires);
    const throughCdn = await fetch(
      `https://${ASSETS_HOST}/${path}?token=${encodeURIComponent(token)}&expires=${expires}`
    );
    assert.equal(throughCdn.status, 200);

    // …and the unsigned URL does not (token auth is really on).
    const unsigned = await fetch(`https://${ASSETS_HOST}/${path}`);
    assert.equal(unsigned.status, 403);

    // The default (jp) API host must reject this zone's key, proving writes
    // could never have been aimed at the wrong region.
    const wrongHost = await fetch(`https://storage.bunnycdn.com/${STORAGE_ZONE}/${path}`, {
      method: "PUT",
      headers: { AccessKey: STORAGE_KEY, "content-type": "image/png" },
      body: png,
    });
    assert.equal(wrongHost.status, 401);
  });

  /* --- 機能D: チャプター編集画面からの動画アップロード ------------------- */

  test("アップロードAPIは未ログインに 401、viewer権限に 403 で拒否される", async () => {
    const anonymous = await request(
      `/api/admin/chapters/${uploadChapter.id}/video`,
      { method: "POST", body: "x", headers: { "content-type": "video/mp4" } }
    );
    assert.equal(anonymous.status, 401);

    const asViewer = await request(
      `/api/admin/chapters/${uploadChapter.id}/video`,
      {
        jar: viewerJar,
        method: "POST",
        body: "x",
        headers: { "content-type": "video/mp4", "x-file-name": "test.mp4" },
      }
    );
    assert.equal(asViewer.status, 403);

    const statusAsViewer = await request(
      `/api/admin/chapters/${uploadChapter.id}/video`,
      { jar: viewerJar }
    );
    assert.equal(statusAsViewer.status, 403);
  });

  test("creatorがアップロードするとエンコード完了後にチャプターで再生できる", async () => {
    const bytes = await readFile(join(process.cwd(), "data", "videos", "lesson-02.mp4"));

    const upload = await request(`/api/admin/chapters/${uploadChapter.id}/video`, {
      jar: creatorJar,
      method: "POST",
      body: bytes,
      headers: {
        "content-type": "video/mp4",
        "x-file-name": encodeURIComponent("sprint6-lesson.mp4"),
      },
    });
    if (upload.status !== 200) {
      assert.fail(`upload failed: ${(await upload.text()).slice(0, 200)}`);
    }
    const payload = await upload.json();
    assert.ok(payload.videoId, "no videoId in the upload response");
    uploadedGuid = payload.videoId;

    // Poll until bunny reports encode status 4 (finished).
    let status = payload.status;
    const deadline = Date.now() + 5 * 60 * 1000;
    while (status !== 4 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const poll = await request(`/api/admin/chapters/${uploadChapter.id}/video`, {
        jar: creatorJar,
      });
      assert.equal(poll.status, 200);
      const body = await poll.json();
      assert.equal(body.videoId, uploadedGuid);
      assert.ok([0, 1, 2, 3, 4, 5].includes(body.status));
      status = body.status;
      if (status === 5) assert.fail("bunny reported an encode error");
    }
    assert.equal(status, 4, "encode did not finish in time");

    // The guid is attached to the chapter…
    const after = await chapterAt(UPLOAD_COURSE, UPLOAD_CHAPTER_POSITION);
    assert.equal(after.bunnyVideoId, uploadedGuid);

    // …and a buyer can play it through a signed URL on the watch page.
    const page = await request(
      `/courses/${UPLOAD_COURSE}/watch/${uploadChapter.id}`,
      { jar: viewerJar }
    );
    assert.equal(page.status, 200);
    const playbackUrl = extractPlaybackUrl(await page.text());
    assert.ok(playbackUrl, "uploaded video is not playable on the watch page");
    assert.ok(playbackUrl.includes(`/${uploadedGuid}/play_720p.mp4?`));

    const media = await fetch(playbackUrl);
    assert.equal(media.status, 200);
    assert.match(media.headers.get("content-type") ?? "", /^video\/mp4/);
  });

  /* --- 秘密鍵の非露出 ---------------------------------------------------- */

  test("ブラウザ向け応答に Bunny の鍵が含まれない", async () => {
    const secrets = [STREAM_API_KEY, STORAGE_KEY, STREAM_TOKEN_KEY, CDN_TOKEN_KEY];
    const pages = [
      ["/admin", creatorJar],
      [`/admin/courses/${LINK_COURSE}`, creatorJar],
      [`/courses/${LINK_COURSE}/watch/${linkChapter.id}`, viewerJar],
      ["/courses", viewerJar],
    ];
    for (const [path, jar] of pages) {
      const response = await request(path, { jar });
      assert.equal(response.status, 200, `${path} did not render`);
      const html = await response.text();
      for (const secret of secrets) {
        assert.ok(secret);
        assert.ok(!html.includes(secret), `a secret leaked on ${path}`);
      }
    }
  });
});
