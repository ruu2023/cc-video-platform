import { db } from "@/lib/db";
import type { Row } from "@libsql/client";

/**
 * Chapter lookups for the viewing flow.
 *
 * Unlike `src/lib/courses.ts` these queries carry the fields that only matter
 * once someone is actually allowed to watch — the video reference and its
 * length — so the public catalogue never has to load them.
 */

export type WatchChapter = {
  id: string;
  courseId: string;
  courseTitle: string;
  coursePublished: boolean;
  position: number;
  title: string;
  bunnyVideoId: string;
  videoAsset: string;
  durationSeconds: number;
};

function toWatchChapter(row: Row): WatchChapter {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    courseTitle: String(row.course_title ?? ""),
    coursePublished: Number(row.course_published ?? 0) === 1,
    position: Number(row.position),
    title: String(row.title),
    bunnyVideoId: String(row.bunny_video_id ?? ""),
    videoAsset: String(row.video_asset ?? ""),
    durationSeconds: Number(row.duration_seconds ?? 0),
  };
}

const WATCH_CHAPTER_COLUMNS = `
  ch.id, ch.course_id, ch.position, ch.title, ch.bunny_video_id,
  ch.video_asset, ch.duration_seconds,
  c.title AS course_title, c.published AS course_published
`;

/** A single chapter by id, or null when it does not exist. */
export async function getWatchChapter(
  chapterId: string
): Promise<WatchChapter | null> {
  if (!chapterId) return null;

  const result = await db.execute({
    sql: `SELECT ${WATCH_CHAPTER_COLUMNS}
          FROM chapter ch
          JOIN course c ON c.id = ch.course_id
          WHERE ch.id = ?
          LIMIT 1`,
    args: [chapterId],
  });

  const row = result.rows[0];
  return row ? toWatchChapter(row) : null;
}

/** Every chapter of a course in playback order — powers prev/next navigation. */
export async function listWatchChapters(
  courseId: string
): Promise<WatchChapter[]> {
  const result = await db.execute({
    sql: `SELECT ${WATCH_CHAPTER_COLUMNS}
          FROM chapter ch
          JOIN course c ON c.id = ch.course_id
          WHERE ch.course_id = ?
          ORDER BY ch.position ASC`,
    args: [courseId],
  });

  return result.rows.map(toWatchChapter);
}

/*
 * Chapter attachments are deliberately absent from these queries. Since Sprint 5
 * the watch page does surface them, but through `src/lib/resources.ts` and only
 * after the entitlement gate — so the "may I watch?" lookup and the "may I
 * download?" lookup stay separate, and no video query can ever hand out a file
 * link by accident. The *video* itself remains non-downloadable: the player has
 * no download control and the stream route serves `Content-Disposition: inline`.
 */
