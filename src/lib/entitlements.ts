import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Course entitlements ("has this account bought this course?").
 *
 * Every gate in the viewing flow — the watch page, the streaming route, the
 * progress API — funnels through `hasPurchased`, so there is exactly one answer
 * to "may this user see these bytes".
 *
 * Rows are written today by the admin grant action (`provider = 'manual'`) and,
 * from Sprint 3 on, by the Stripe webhook (`provider = 'stripe'` plus the
 * Checkout Session id in `provider_ref`). Nothing else about this module has to
 * change when that lands.
 */

export type Purchase = {
  id: string;
  userId: string;
  courseId: string;
  amountJpy: number;
  status: "paid" | "refunded";
  provider: "manual" | "stripe";
  providerRef: string;
  purchasedAt: string;
};

export type Purchaser = Purchase & {
  userEmail: string;
  userName: string;
};

export class EntitlementError extends Error {}

/**
 * The single authorisation check for paid content. A refunded row deliberately
 * does not grant access.
 */
export async function hasPurchased(
  userId: string | null | undefined,
  courseId: string
): Promise<boolean> {
  if (!userId || !courseId) return false;

  const result = await db.execute({
    sql: `SELECT 1 FROM purchase
          WHERE user_id = ? AND course_id = ? AND status = 'paid'
          LIMIT 1`,
    args: [userId, courseId],
  });

  return result.rows.length > 0;
}

export async function getPurchase(
  userId: string,
  courseId: string
): Promise<Purchase | null> {
  const result = await db.execute({
    sql: `SELECT id, user_id, course_id, amount_jpy, status, provider,
                 provider_ref, purchased_at
          FROM purchase
          WHERE user_id = ? AND course_id = ?
          LIMIT 1`,
    args: [userId, courseId],
  });

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    userId: String(row.user_id),
    courseId: String(row.course_id),
    amountJpy: Number(row.amount_jpy ?? 0),
    status: row.status === "refunded" ? "refunded" : "paid",
    provider: row.provider === "stripe" ? "stripe" : "manual",
    providerRef: String(row.provider_ref ?? ""),
    purchasedAt: String(row.purchased_at ?? ""),
  };
}

/** Course ids the user owns — used to badge the catalogue and "My courses". */
export async function purchasedCourseIds(
  userId: string | null | undefined
): Promise<Set<string>> {
  if (!userId) return new Set();

  const result = await db.execute({
    sql: "SELECT course_id FROM purchase WHERE user_id = ? AND status = 'paid'",
    args: [userId],
  });

  return new Set(result.rows.map((row) => String(row.course_id)));
}

/** Everyone holding an entitlement for a course, newest first (admin view). */
export async function listPurchasers(courseId: string): Promise<Purchaser[]> {
  const result = await db.execute({
    sql: `SELECT p.id, p.user_id, p.course_id, p.amount_jpy, p.status,
                 p.provider, p.provider_ref, p.purchased_at,
                 u.email AS user_email, u.name AS user_name
          FROM purchase p
          JOIN user u ON u.id = p.user_id
          WHERE p.course_id = ?
          ORDER BY p.purchased_at DESC`,
    args: [courseId],
  });

  return result.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    courseId: String(row.course_id),
    amountJpy: Number(row.amount_jpy ?? 0),
    status: row.status === "refunded" ? ("refunded" as const) : ("paid" as const),
    provider: row.provider === "stripe" ? ("stripe" as const) : ("manual" as const),
    providerRef: String(row.provider_ref ?? ""),
    purchasedAt: String(row.purchased_at ?? ""),
    userEmail: String(row.user_email ?? ""),
    userName: String(row.user_name ?? ""),
  }));
}

export type AccountSummary = { id: string; email: string; name: string; role: string };

export async function findUserByEmail(email: string): Promise<AccountSummary | null> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;

  const result = await db.execute({
    sql: "SELECT id, email, name, role FROM user WHERE lower(email) = ? LIMIT 1",
    args: [normalised],
  });

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name ?? row.email),
    role: String(row.role ?? "viewer"),
  };
}

/** All accounts, so the admin grant form can offer a picker instead of typing. */
export async function listAccounts(): Promise<AccountSummary[]> {
  const result = await db.execute(
    "SELECT id, email, name, role FROM user ORDER BY createdAt ASC"
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    name: String(row.name ?? row.email),
    role: String(row.role ?? "viewer"),
  }));
}

/**
 * Creates (or re-activates) an entitlement. Idempotent on (user, course), which
 * is exactly what a Stripe webhook needs — the same event may arrive twice.
 */
export async function grantPurchase(input: {
  userId: string;
  courseId: string;
  amountJpy: number;
  provider?: "manual" | "stripe";
  providerRef?: string;
}): Promise<void> {
  const course = await db.execute({
    sql: "SELECT id FROM course WHERE id = ? LIMIT 1",
    args: [input.courseId],
  });
  if (course.rows.length === 0) {
    throw new EntitlementError(`コースが見つかりません: ${input.courseId}`);
  }

  const user = await db.execute({
    sql: "SELECT id FROM user WHERE id = ? LIMIT 1",
    args: [input.userId],
  });
  if (user.rows.length === 0) {
    throw new EntitlementError("ユーザーが見つかりません。");
  }

  await db.execute({
    sql: `INSERT INTO purchase
            (id, user_id, course_id, amount_jpy, status, provider, provider_ref,
             purchased_at)
          VALUES (?, ?, ?, ?, 'paid', ?, ?, datetime('now'))
          ON CONFLICT (user_id, course_id) DO UPDATE SET
            status       = 'paid',
            amount_jpy   = excluded.amount_jpy,
            provider     = excluded.provider,
            provider_ref = excluded.provider_ref,
            purchased_at = datetime('now')`,
    args: [
      randomUUID(),
      input.userId,
      input.courseId,
      Math.max(0, Math.round(input.amountJpy)),
      input.provider ?? "manual",
      input.providerRef ?? "",
    ],
  });
}

/**
 * Removes an entitlement outright. Refunds in the real product are handled by
 * the operator (see spec.md), and this is the operator's lever; viewing
 * progress is kept so re-granting restores the learner's history.
 */
export async function revokePurchase(
  userId: string,
  courseId: string
): Promise<boolean> {
  const result = await db.execute({
    sql: "DELETE FROM purchase WHERE user_id = ? AND course_id = ?",
    args: [userId, courseId],
  });
  return result.rowsAffected > 0;
}
