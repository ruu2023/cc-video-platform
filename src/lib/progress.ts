import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  completionPercent,
  emptyChapterProgress,
  reachedCompletion,
  type ChapterProgress,
  type CourseProgress,
} from "@/lib/watch-types";

/**
 * Reading and writing per-chapter viewing progress.
 *
 * Callers must have already established that the user owns the course
 * (`hasPurchased`); this module deals only in storage.
 */

function toProgress(row: Record<string, unknown>): ChapterProgress {
  return {
    chapterId: String(row.chapter_id),
    positionSeconds: Number(row.position_seconds ?? 0),
    durationSeconds: Number(row.duration_seconds ?? 0),
    completed: Number(row.completed ?? 0) === 1,
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  };
}

export async function getChapterProgress(
  userId: string,
  chapterId: string
): Promise<ChapterProgress> {
  const result = await db.execute({
    sql: `SELECT chapter_id, position_seconds, duration_seconds, completed,
                 completed_at
          FROM chapter_progress
          WHERE user_id = ? AND chapter_id = ?
          LIMIT 1`,
    args: [userId, chapterId],
  });

  const row = result.rows[0];
  return row
    ? toProgress(row as unknown as Record<string, unknown>)
    : emptyChapterProgress(chapterId);
}

/**
 * The whole course at once: one row per chapter that has been touched, plus the
 * rolled-up percentage. `totalChapters` comes from the chapter table rather
 * than from the progress rows, so a course with untouched chapters can never
 * report 100%.
 */
export async function getCourseProgress(
  userId: string | null | undefined,
  courseId: string
): Promise<CourseProgress> {
  const totalResult = await db.execute({
    sql: "SELECT COUNT(*) AS total FROM chapter WHERE course_id = ?",
    args: [courseId],
  });
  const totalChapters = Number(totalResult.rows[0]?.total ?? 0);

  if (!userId) {
    return {
      courseId,
      totalChapters,
      completedChapters: 0,
      percent: 0,
      byChapter: {},
    };
  }

  // Joined against `chapter` so progress left behind by a deleted chapter can
  // never inflate the count.
  const result = await db.execute({
    sql: `SELECT p.chapter_id, p.position_seconds, p.duration_seconds,
                 p.completed, p.completed_at
          FROM chapter_progress p
          JOIN chapter c ON c.id = p.chapter_id
          WHERE p.user_id = ? AND c.course_id = ?`,
    args: [userId, courseId],
  });

  const byChapter: Record<string, ChapterProgress> = {};
  let completedChapters = 0;

  for (const row of result.rows) {
    const progress = toProgress(row as unknown as Record<string, unknown>);
    byChapter[progress.chapterId] = progress;
    if (progress.completed) completedChapters += 1;
  }

  return {
    courseId,
    totalChapters,
    completedChapters,
    percent: completionPercent(completedChapters, totalChapters),
    byChapter,
  };
}

export type SaveProgressInput = {
  userId: string;
  courseId: string;
  chapterId: string;
  positionSeconds: number;
  durationSeconds: number;
  /** Explicit signal from the player (the `ended` event). */
  completed?: boolean;
};

export type SaveProgressResult = ChapterProgress;

/**
 * Upserts a playback position.
 *
 * Two rules that matter:
 * - completion is sticky. Once a chapter is done, rewinding to re-watch a
 *   section must not un-tick it.
 * - the position is clamped to the clip length, so a bogus client payload
 *   cannot park a learner past the end of the video. (Reopening a *completed*
 *   chapter starts from the top — that decision lives in `resumePosition`.)
 */
export async function saveChapterProgress(
  input: SaveProgressInput
): Promise<SaveProgressResult> {
  const previous = await getChapterProgress(input.userId, input.chapterId);

  const duration = Number.isFinite(input.durationSeconds)
    ? Math.max(0, input.durationSeconds)
    : previous.durationSeconds;

  const rawPosition = Number.isFinite(input.positionSeconds)
    ? Math.max(0, input.positionSeconds)
    : 0;
  const position = duration > 0 ? Math.min(rawPosition, duration) : rawPosition;

  const completed =
    previous.completed ||
    input.completed === true ||
    reachedCompletion(position, duration);

  const completedAt = completed
    ? previous.completedAt ?? new Date().toISOString()
    : null;

  await db.execute({
    sql: `INSERT INTO chapter_progress
            (id, user_id, course_id, chapter_id, position_seconds,
             duration_seconds, completed, completed_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT (user_id, chapter_id) DO UPDATE SET
            course_id        = excluded.course_id,
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            completed        = excluded.completed,
            completed_at     = excluded.completed_at,
            updated_at       = datetime('now')`,
    args: [
      randomUUID(),
      input.userId,
      input.courseId,
      input.chapterId,
      position,
      duration,
      completed ? 1 : 0,
      completedAt,
    ],
  });

  return {
    chapterId: input.chapterId,
    positionSeconds: position,
    durationSeconds: duration,
    completed,
    completedAt,
  };
}
