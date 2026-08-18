import { db } from "@/lib/db";
import type { Row } from "@libsql/client";
import { assetsHostname, signedAssetsUrl } from "@/lib/bunny";
import type { Course, CourseDetail, CourseLevel } from "@/lib/course-types";

export type {
  Course,
  CourseDetail,
  Chapter,
  CourseLevel,
} from "@/lib/course-types";
export { LEVEL_LABEL, formatPrice } from "@/lib/course-types";

const COURSE_COLUMNS = `
  c.id, c.title, c.subtitle, c.description, c.thumbnail_url, c.price_jpy,
  c.instructor_name, c.instructor_title, c.level,
  (SELECT COUNT(*) FROM chapter ch WHERE ch.course_id = c.id) AS chapter_count
`;

/**
 * Thumbnails stored on the bunny.net assets CDN sit behind Token
 * Authentication, so a bare `https://<pull-zone>/...` URL answers 403. Every
 * public surface therefore signs the stored URL at render time (30-day
 * lifetime — pages are force-dynamic, so the signature is minted per request
 * and cannot go stale in a cache).
 */
function publicThumbnail(stored: string): string {
  if (assetsHostname() && stored.startsWith(`https://${assetsHostname()}/`)) {
    return signedAssetsUrl(stored);
  }
  return stored;
}

function toCourse(row: Row): Course {
  return {
    id: String(row.id),
    title: String(row.title),
    subtitle: String(row.subtitle ?? ""),
    description: String(row.description ?? ""),
    thumbnailUrl: publicThumbnail(String(row.thumbnail_url)),
    priceJpy: Number(row.price_jpy),
    instructorName: String(row.instructor_name),
    instructorTitle: String(row.instructor_title ?? ""),
    level: String(row.level) as CourseLevel,
    chapterCount: Number(row.chapter_count ?? 0),
  };
}

/** Every published course, in curation order. Drafts are never returned. */
export async function listPublishedCourses(): Promise<Course[]> {
  const result = await db.execute(
    `SELECT ${COURSE_COLUMNS}
     FROM course c
     WHERE c.published = 1
     ORDER BY c.sort_order ASC, c.title ASC`
  );
  return result.rows.map(toCourse);
}

/**
 * A single published course with its chapter list, or null when the id does
 * not exist or the course is still a draft — both surface as a 404.
 */
export async function getPublishedCourse(id: string): Promise<CourseDetail | null> {
  if (!id) return null;

  const courseResult = await db.execute({
    sql: `SELECT ${COURSE_COLUMNS}
          FROM course c
          WHERE c.id = ? AND c.published = 1
          LIMIT 1`,
    args: [id],
  });

  const row = courseResult.rows[0];
  if (!row) return null;

  const chapterResult = await db.execute({
    sql: `SELECT ch.id, ch.position, ch.title, ch.duration_seconds,
                 (SELECT COUNT(*) FROM chapter_resource r
                   WHERE r.chapter_id = ch.id) AS resource_count
          FROM chapter ch
          WHERE ch.course_id = ?
          ORDER BY ch.position ASC`,
    args: [id],
  });

  return {
    ...toCourse(row),
    chapters: chapterResult.rows.map((chapter) => ({
      id: String(chapter.id),
      position: Number(chapter.position),
      title: String(chapter.title),
      resourceCount: Number(chapter.resource_count ?? 0),
      durationSeconds: Number(chapter.duration_seconds ?? 0),
    })),
  };
}
