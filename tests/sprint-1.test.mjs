/**
 * Sprint 1 contract tests.
 *
 * Exercises the running app over HTTP — no mocks, no stubs. Start the dev
 * server first, then:
 *
 *   npm run dev            # terminal 1
 *   npm test               # terminal 2
 *
 * Override the target with BASE_URL=http://localhost:3100 npm test
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");

const PUBLISHED_IDS = [
  "next-app-router",
  "typescript-type-design",
  "sqlite-turso-edge",
  "auth-from-scratch",
  "design-tokens-for-devs",
];
const DRAFT_ID = "stripe-billing-handson";

/** Minimal cookie jar so one "browser session" persists across requests. */
function createJar() {
  const jar = new Map();

  return {
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    absorb(response) {
      const raw = response.headers.getSetCookie?.() ?? [];
      for (const cookie of raw) {
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
  // better-auth enforces an Origin check on state-changing requests, exactly as
  // a real browser would supply it.
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

describe("データ層: 公開コースのみが読み出される", () => {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "file:./data/app.db",
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });

  test("course テーブルに公開コースとドラフトが存在する", async () => {
    const { rows } = await db.execute(
      "SELECT id, published FROM course ORDER BY sort_order"
    );
    const published = rows.filter((r) => Number(r.published) === 1).map((r) => String(r.id));
    const drafts = rows.filter((r) => Number(r.published) === 0).map((r) => String(r.id));

    // Courses created from the admin area (Sprint 2) also land here, so the
    // seeded catalogue is asserted as a subset rather than an exact list.
    for (const id of PUBLISHED_IDS) {
      assert.ok(published.includes(id), `seeded course ${id} is no longer published`);
    }
    assert.ok(drafts.includes(DRAFT_ID));
  });

  test("各公開コースがチャプターを 1 件以上持ち、position が連番である", async () => {
    for (const id of PUBLISHED_IDS) {
      const { rows } = await db.execute({
        sql: "SELECT position FROM chapter WHERE course_id = ? ORDER BY position",
        args: [id],
      });
      assert.ok(rows.length > 0, `${id} にチャプターがありません`);
      rows.forEach((row, index) => {
        assert.equal(Number(row.position), index + 1, `${id} の position が連番ではありません`);
      });
    }
  });

  test("価格はすべて 0 より大きい整数である", async () => {
    const { rows } = await db.execute("SELECT id, price_jpy FROM course");
    for (const row of rows) {
      assert.ok(Number.isInteger(Number(row.price_jpy)), `${row.id} の価格が整数ではありません`);
      assert.ok(Number(row.price_jpy) > 0, `${row.id} の価格が 0 以下です`);
    }
  });
});

describe("契約: コース一覧ページ（未ログイン）", () => {
  let html;

  before(async () => {
    const response = await request("/courses");
    assert.equal(response.status, 200);
    html = await response.text();
  });

  test("公開コースのタイトルがすべて表示される", () => {
    for (const id of PUBLISHED_IDS) {
      assert.match(html, new RegExp(`/courses/${id}`), `${id} へのリンクがありません`);
    }
  });

  test("サムネイルと価格が表示される", () => {
    assert.match(html, /thumbnails%2Fnext-app-router\.svg|thumbnails\/next-app-router\.svg/);
    // Intl formats JPY as ￥ (fullwidth) in the ja-JP locale.
    assert.match(html, /[￥¥]14,800/);
    assert.match(html, /[￥¥]6,800/);
  });

  test("未公開コースは一覧に現れない", () => {
    assert.doesNotMatch(html, new RegExp(`/courses/${DRAFT_ID}`));
    assert.doesNotMatch(html, /Stripe 課金実装ハンズオン/);
  });
});

describe("契約: コース詳細ページ（未ログイン）", () => {
  let html;

  before(async () => {
    const response = await request("/courses/next-app-router");
    assert.equal(response.status, 200, "未ログインでも詳細ページは 200 で閲覧できる必要があります");
    html = await response.text();
  });

  test("説明文が表示される", () => {
    assert.match(html, /Pages Router の常識をいったん捨て/);
  });

  test("サムネイルが表示される", () => {
    assert.match(html, /next-app-router\.svg|next-app-router%2Esvg|thumbnails/);
  });

  test("チャプタータイトルがすべて表示される", () => {
    const titles = [
      "App Router のメンタルモデルとレンダリング境界",
      "Server Components でのデータ取得とキャッシュ設計",
      "Client Components に落とす判断基準",
      "Server Actions によるフォームと楽観的更新",
      "Suspense とストリーミングで体感速度を作る",
      "本番運用：再検証・エラー境界・計測",
    ];
    for (const title of titles) {
      assert.ok(html.includes(title), `チャプター「${title}」が表示されていません`);
    }
  });

  test("動画プレイヤーは一切埋め込まれていない", () => {
    assert.doesNotMatch(html, /<video[\s>]/i);
    assert.doesNotMatch(html, /<iframe[\s>]/i);
    assert.doesNotMatch(html, /\.(mp4|m3u8|webm)/i);
    assert.doesNotMatch(html, /iframe\.mediadelivery\.net|player\.vimeo|youtube\.com\/embed/i);
  });

  test("購入導線は表示されるがログインは強制されない", () => {
    assert.match(html, /アカウントを作成して購入/);
    assert.match(html, /無料プレビューを提供していません/);
  });
});

describe("契約: 存在しない・未公開のコース ID は 404", () => {
  test("存在しない ID は 404 を返す", async () => {
    const response = await request("/courses/definitely-not-a-course");
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.match(html, /コースが見つかりませんでした/);
  });

  test("未公開コースの ID も 404 を返す", async () => {
    const response = await request(`/courses/${DRAFT_ID}`);
    assert.equal(response.status, 404);
  });
});

describe("契約: 登録・ログイン・ログアウト", () => {
  const jar = createJar();
  const email = `test-${Date.now()}@example.com`;
  const password = "Passw0rd!2026";

  test("メールアドレスとパスワードで新規アカウントを作成できる", async () => {
    const response = await request("/api/auth/sign-up/email", {
      jar,
      method: "POST",
      body: JSON.stringify({ email, password, name: "契約テスト" }),
    });
    const raw = await response.text();
    assert.equal(response.status, 200, raw);
    assert.equal(JSON.parse(raw).user.email, email);
  });

  test("作成直後はセッションが確立している", async () => {
    const response = await request("/api/auth/get-session", { jar });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body?.user?.email, email);
  });

  test("ログイン中はページにメールアドレスが表示される", async () => {
    const response = await request("/courses", { jar });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(email), "ヘッダーにログイン中のメールアドレスが表示されていません");
  });

  test("ログアウトできる", async () => {
    const response = await request("/api/auth/sign-out", { jar, method: "POST", body: "{}" });
    assert.equal(response.status, 200);

    const session = await request("/api/auth/get-session", { jar });
    const body = await session.json();
    assert.ok(!body?.user, "ログアウト後もセッションが残っています");

    const page = await request("/courses", { jar });
    const html = await page.text();
    assert.ok(!html.includes(email), "ログアウト後もメールアドレスが表示されています");
  });

  test("作成したアカウントで再ログインできる", async () => {
    const fresh = createJar();
    const response = await request("/api/auth/sign-in/email", {
      jar: fresh,
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200, `sign-in failed: ${await response.text()}`);

    const page = await request("/courses", { jar: fresh });
    const html = await page.text();
    assert.ok(html.includes(email), "再ログイン後にメールアドレスが表示されていません");
  });

  test("誤ったパスワードではログインできない", async () => {
    const fresh = createJar();
    const response = await request("/api/auth/sign-in/email", {
      jar: fresh,
      method: "POST",
      body: JSON.stringify({ email, password: "totally-wrong-password" }),
    });
    assert.ok(response.status >= 400, "誤ったパスワードが受理されました");
  });

  test("重複したメールアドレスでは登録できない", async () => {
    const response = await request("/api/auth/sign-up/email", {
      jar: createJar(),
      method: "POST",
      body: JSON.stringify({ email, password, name: "重複" }),
    });
    assert.ok(response.status >= 400, "同じメールアドレスで二重に登録できてしまいました");
  });
});
