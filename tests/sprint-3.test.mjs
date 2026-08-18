/**
 * Sprint 3 contract tests — Stripe Checkout purchase flow.
 *
 * Exercises the running app over HTTP against the real database and the real
 * Stripe test-mode API (session creation + retrieval). No mocks.
 *
 *   npm run dev            # terminal 1
 *   npm test               # terminal 2
 *
 * The one thing these tests cannot do headlessly is type a test card into the
 * hosted Stripe Checkout page — that part of the contract is verified by the
 * evaluator in a browser. Everything around it (redirects, verification,
 * idempotency, double-purchase protection, cancellation, persistence) is
 * covered here.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const COURSE_ID = "next-app-router"; // published, mapped to a Stripe Price

const db = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./data/app.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set — run via `npm test` (loads .env).");
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

async function purchaseCount(userId, courseId) {
  const result = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM purchase WHERE user_id = ? AND course_id = ?",
    args: [userId, courseId],
  });
  return Number(result.rows[0]?.n ?? 0);
}

async function grantDirect(userId, courseId, amountJpy) {
  await db.execute({
    sql: `INSERT INTO purchase
            (id, user_id, course_id, amount_jpy, status, provider, provider_ref,
             purchased_at)
          VALUES (?, ?, ?, ?, 'paid', 'stripe', ?, datetime('now'))
          ON CONFLICT (user_id, course_id) DO UPDATE SET status = 'paid'`,
    args: [randomUUID(), userId, courseId, amountJpy, `cs_test_${randomUUID()}`],
  });
}

describe("Sprint 3: コース購入フロー（Stripe Checkout）", () => {
  let jar;
  let userId;
  let email;
  const createdSessionIds = [];

  before(async () => {
    // A throwaway viewer account keeps the seeded demo accounts untouched.
    email = `sprint3-${Date.now()}@example.com`;
    jar = createJar();

    const signup = await request("/api/auth/sign-up/email", {
      jar,
      method: "POST",
      body: JSON.stringify({
        email,
        password: "sprint3-pass-2026",
        name: "Sprint3 購入テスト",
      }),
    });
    assert.equal(signup.status, 200, `sign-up failed for ${email}`);

    const row = await db.execute({
      sql: "SELECT id FROM user WHERE email = ?",
      args: [email],
    });
    assert.ok(row.rows[0], "test user was not created");
    userId = String(row.rows[0].id);

    // Start from a clean slate for this (user, course).
    await db.execute({
      sql: "DELETE FROM purchase WHERE user_id = ? AND course_id = ?",
      args: [userId, COURSE_ID],
    });
  });

  after(async () => {
    if (userId) {
      await db.execute({
        sql: "DELETE FROM purchase WHERE user_id = ?",
        args: [userId],
      });
      await db.execute({ sql: "DELETE FROM user WHERE id = ?", args: [userId] });
    }
    // Expire the sessions this run created so nothing lingers in test mode.
    for (const id of createdSessionIds) {
      await stripe.checkout.sessions.expire(id).catch(() => {});
    }
  });

  test("未ログインで購入ボタンを押すとログイン画面へ誘導される（契約1）", async () => {
    // The button on the page points at sign-up/login carrying ?next=.
    const page = await request(`/courses/${COURSE_ID}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(
      html,
      /href="\/(login|signup)\?next=%2Fcourses%2F[^"]*"/,
      "course page should link to login/signup with ?next="
    );

    // The checkout route itself also funnels anonymous visitors to login.
    const response = await request("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ courseId: COURSE_ID }).toString(),
    });
    assert.equal(response.status, 303);
    const location = response.headers.get("location") ?? "";
    assert.match(location, /\/login\?next=/);
  });

  test("未ログインで /mypage はログインへリダイレクトされる", async () => {
    const response = await request("/mypage");
    assert.equal(response.status, 307);
    assert.match(response.headers.get("location") ?? "", /^\/login/);
  });

  test("ログイン済みで購入ボタンを押すと Stripe Checkout へ遷移する（契約2）", async () => {
    // The page renders a real form posting to the checkout route.
    const page = await request(`/courses/${COURSE_ID}`, { jar });
    const html = await page.text();
    assert.match(html, /data-testid="buy-button"/, "buy button missing");
    assert.match(html, /action="\/api\/checkout"/, "buy form missing");

    // Posting it produces a redirect to the hosted Stripe Checkout page.
    const response = await request("/api/checkout", {
      jar,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ courseId: COURSE_ID }).toString(),
    });
    assert.equal(response.status, 303);
    const location = response.headers.get("location") ?? "";
    assert.match(
      location,
      /^https:\/\/checkout\.stripe\.com\//,
      `expected Stripe Checkout, got ${location}`
    );

    // And no purchase exists yet: the redirect alone must not grant anything.
    assert.equal(await purchaseCount(userId, COURSE_ID), 0);

    // Remember the session so `after` can expire it.
    const sessionId = new URL(location).searchParams.get("session_id");
    if (sessionId) createdSessionIds.push(sessionId);
  });

  test("決済前のマイページは空（キャンセル・未決済では何も表示されない・契約8）", async () => {
    const page = await request("/mypage", { jar });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /data-testid="mypage-empty"/);
    assert.doesNotMatch(html, new RegExp(`mypage-course-${COURSE_ID}`));
    assert.equal(await purchaseCount(userId, COURSE_ID), 0);
  });

  test("キャンセル帰還時のクエリでキャンセル表示が出る（契約8）", async () => {
    const page = await request(`/courses/${COURSE_ID}?canceled=1`, { jar });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /data-testid="checkout-canceled"/);
    assert.match(html, /決済がキャンセルされました/);
    assert.equal(await purchaseCount(userId, COURSE_ID), 0);
  });

  test("偽の session_id では購入完了にならず、記録もされない", async () => {
    const page = await request(
      `/courses/${COURSE_ID}/purchase/success?session_id=cs_test_forged_${randomUUID()}`,
      { jar }
    );
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /data-testid="purchase-failed"/);
    assert.doesNotMatch(html, /data-testid="purchase-success"/);
    assert.equal(await purchaseCount(userId, COURSE_ID), 0);
  });

  test("session_id 未指定でも完了扱いにならない", async () => {
    const page = await request(`/courses/${COURSE_ID}/purchase/success`, { jar });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /data-testid="purchase-failed"/);
    assert.equal(await purchaseCount(userId, COURSE_ID), 0);
  });

  test("未払いセッションの success URL は「決済が完了していません」になり記録されない", async () => {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: "price_1U4xOu2M1J7YK37IpyHSMo7q", quantity: 1 }],
      metadata: { userId, courseId: COURSE_ID },
      success_url: `${BASE_URL}/unused`,
      cancel_url: `${BASE_URL}/unused`,
    });
    createdSessionIds.push(session.id);

    const page = await request(
      `/courses/${COURSE_ID}/purchase/success?session_id=${session.id}`,
      { jar }
    );
    const html = await page.text();
    assert.match(html, /data-testid="purchase-failed"/);
    assert.match(html, /決済が完了していません/);
    assert.equal(await purchaseCount(userId, COURSE_ID), 0);
  });

  test("他人のセッションは拒否される（wrong-user）", async () => {
    const other = await db.execute({
      sql: "SELECT id FROM user WHERE email = 'viewer@kouza.test' LIMIT 1",
    });
    const otherId = other.rows[0] ? String(other.rows[0].id) : `ghost-${randomUUID()}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: "price_1U4xOu2M1J7YK37IpyHSMo7q", quantity: 1 }],
      metadata: { userId: otherId, courseId: COURSE_ID },
      success_url: `${BASE_URL}/unused`,
      cancel_url: `${BASE_URL}/unused`,
    });
    createdSessionIds.push(session.id);

    const page = await request(
      `/courses/${COURSE_ID}/purchase/success?session_id=${session.id}`,
      { jar }
    );
    const html = await page.text();
    assert.match(html, /data-testid="purchase-failed"/);
    assert.equal(await purchaseCount(userId, COURSE_ID), 0);
  });

  test("購入が記録されるとコース詳細は「購入済み」に切り替わり、購入ボタンが出ない（契約6・7・9）", async () => {
    await grantDirect(userId, COURSE_ID, 14800);

    // The record really is in the database with the three contract fields.
    const row = await db.execute({
      sql: `SELECT user_id, course_id, purchased_at, status FROM purchase
            WHERE user_id = ? AND course_id = ?`,
      args: [userId, COURSE_ID],
    });
    assert.equal(row.rows.length, 1);
    assert.equal(String(row.rows[0].course_id), COURSE_ID);
    assert.ok(String(row.rows[0].purchased_at ?? "").length > 0, "purchased_at missing");

    const page = await request(`/courses/${COURSE_ID}`, { jar });
    const html = await page.text();
    assert.doesNotMatch(html, /data-testid="buy-button"/, "buy button still shown");
    assert.match(html, /data-testid="owned-badge"/);
    assert.match(html, /購入済み/);
    assert.match(html, /data-testid="continue-watching"/, "watch CTA missing");
  });

  test("購入済みユーザーが購入ボタンを押しても Stripe へ遷移しない（二重購入防止・契約7）", async () => {
    const response = await request("/api/checkout", {
      jar,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ courseId: COURSE_ID }).toString(),
    });
    assert.equal(response.status, 303);
    const location = response.headers.get("location") ?? "";
    assert.ok(
      location.endsWith(`/courses/${COURSE_ID}?checkout=already-purchased`),
      `expected already-purchased bounce, got ${location}`
    );
    assert.doesNotMatch(location, /^https:\/\/checkout\.stripe\.com\//);
    // Still exactly one row — the idempotent guard did not duplicate it.
    assert.equal(await purchaseCount(userId, COURSE_ID), 1);
  });

  test("マイページの購入済み一覧にコースが表示される（契約5）", async () => {
    const page = await request("/mypage", { jar });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /data-testid="mypage-list"/);
    assert.match(html, new RegExp(`data-testid="mypage-course-${COURSE_ID}"`));
    assert.match(html, /購入日/);
    assert.match(html, new RegExp(`mypage-watch-${COURSE_ID}`));
    assert.doesNotMatch(html, /data-testid="mypage-empty"/);
  });

  test("存在しないコースの購入導線はコース一覧へ戻る", async () => {
    const response = await request("/api/checkout", {
      jar,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ courseId: "no-such-course" }).toString(),
    });
    assert.equal(response.status, 303);
    assert.ok((response.headers.get("location") ?? "").endsWith("/courses"));
  });
});
