import { db } from "@/lib/db";
import type { Row } from "@libsql/client";
import { assetsHostname, signedAssetsUrl } from "@/lib/bunny";

/**
 * "My courses" (マイページ) — the signed-in learner's library.
 *
 * Reads the purchase table joined against the course catalogue so the page is
 * a single query per account: entitlement rows drive the list, the catalogue
 * supplies the presentation, and viewing progress is fetched separately per
 * course (it is only needed for owned courses).
 */

export type MyCourse = {
  courseId: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  level: string;
  priceJpy: number;
  amountPaidJpy: number;
  purchasedAt: string;
  provider: string;
  chapterCount: number;
};

function toMyCourse(row: Row): MyCourse {
  const storedThumbnail = String(row.thumbnail_url);
  return {
    courseId: String(row.course_id),
    title: String(row.title),
    subtitle: String(row.subtitle ?? ""),
    // CDN thumbnails are token-protected; sign at render time (see courses.ts).
    thumbnailUrl:
      assetsHostname() && storedThumbnail.startsWith(`https://${assetsHostname()}/`)
        ? signedAssetsUrl(storedThumbnail)
        : storedThumbnail,
    level: String(row.level),
    priceJpy: Number(row.price_jpy ?? 0),
    amountPaidJpy: Number(row.amount_jpy ?? 0),
    purchasedAt: String(row.purchased_at ?? ""),
    provider: String(row.provider ?? "manual"),
    chapterCount: Number(row.chapter_count ?? 0),
  };
}

/** Every paid entitlement of the user, newest purchase first. */
export async function listMyCourses(userId: string): Promise<MyCourse[]> {
  const result = await db.execute({
    sql: `SELECT p.course_id, p.amount_jpy, p.purchased_at, p.provider,
                 c.title, c.subtitle, c.thumbnail_url, c.level, c.price_jpy,
                 (SELECT COUNT(*) FROM chapter ch WHERE ch.course_id = c.id) AS chapter_count
          FROM purchase p
          JOIN course c ON c.id = p.course_id
          WHERE p.user_id = ? AND p.status = 'paid'
          ORDER BY p.purchased_at DESC, p.course_id ASC`,
    args: [userId],
  });

  return result.rows.map(toMyCourse);
}

/** "2026-08-16 12:34" style label for the Japanese UI. */
export function formatPurchaseDate(isoish: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(isoish);
  if (!match) return isoish;
  const [, y, m, d, hh, mm] = match;
  return `${y}年${Number(m)}月${Number(d)}日 ${hh}:${mm}`;
}
