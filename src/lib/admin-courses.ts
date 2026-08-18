import { db } from "@/lib/db";
import type { Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import type { CourseLevel } from "@/lib/course-types";
import { deleteUpload } from "@/lib/uploads";

export type AdminResource = {
  id: string;
  uploadId: string;
  label: string;
  position: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type AdminChapter = {
  id: string;
  position: number;
  title: string;
  bunnyVideoId: string;
  videoUrl: string;
  videoAsset: string;
  durationSeconds: number;
  resources: AdminResource[];
};

export type AdminCourse = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnailUrl: string;
  priceJpy: number;
  instructorName: string;
  instructorTitle: string;
  level: CourseLevel;
  published: boolean;
  sortOrder: number;
  updatedAt: string;
  chapterCount: number;
  resourceCount: number;
};

export type AdminCourseDetail = AdminCourse & { chapters: AdminChapter[] };

export type CourseInput = {
  id?: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnailUrl: string;
  priceJpy: number;
  instructorName: string;
  instructorTitle: string;
  level: CourseLevel;
  published: boolean;
};

export type ChapterInput = {
  title: string;
  bunnyVideoId: string;
  videoUrl: string;
};

/** Raised by the mutations below for problems worth showing to the creator. */
export class AdminError extends Error {}

const ADMIN_COLUMNS = `
  c.id, c.title, c.subtitle, c.description, c.thumbnail_url, c.price_jpy,
  c.instructor_name, c.instructor_title, c.level, c.published, c.sort_order,
  c.updated_at,
  (SELECT COUNT(*) FROM chapter ch WHERE ch.course_id = c.id) AS chapter_count,
  (SELECT COUNT(*) FROM chapter_resource r
     JOIN chapter ch2 ON ch2.id = r.chapter_id
    WHERE ch2.course_id = c.id) AS resource_count
`;

function toAdminCourse(row: Row): AdminCourse {
  return {
    id: String(row.id),
    title: String(row.title),
    subtitle: String(row.subtitle ?? ""),
    description: String(row.description ?? ""),
    thumbnailUrl: String(row.thumbnail_url),
    priceJpy: Number(row.price_jpy),
    instructorName: String(row.instructor_name),
    instructorTitle: String(row.instructor_title ?? ""),
    level: String(row.level) as CourseLevel,
    published: Number(row.published) === 1,
    sortOrder: Number(row.sort_order),
    updatedAt: String(row.updated_at ?? ""),
    chapterCount: Number(row.chapter_count ?? 0),
    resourceCount: Number(row.resource_count ?? 0),
  };
}

/** Drafts included — this is the creator's own view of the catalogue. */
export async function listAllCourses(): Promise<AdminCourse[]> {
  const result = await db.execute(
    `SELECT ${ADMIN_COLUMNS} FROM course c
     ORDER BY c.sort_order ASC, c.updated_at DESC`
  );
  return result.rows.map(toAdminCourse);
}

export async function getAdminCourse(id: string): Promise<AdminCourseDetail | null> {
  if (!id) return null;

  const courseResult = await db.execute({
    sql: `SELECT ${ADMIN_COLUMNS} FROM course c WHERE c.id = ? LIMIT 1`,
    args: [id],
  });
  const row = courseResult.rows[0];
  if (!row) return null;

  const chapterResult = await db.execute({
    sql: `SELECT id, position, title, bunny_video_id, video_url, video_asset,
                 duration_seconds
          FROM chapter WHERE course_id = ? ORDER BY position ASC`,
    args: [id],
  });

  const resourceResult = await db.execute({
    sql: `SELECT r.id, r.chapter_id, r.upload_id, r.label, r.position,
                 u.original_name, u.mime_type, u.size_bytes
          FROM chapter_resource r
          JOIN upload u ON u.id = r.upload_id
          JOIN chapter ch ON ch.id = r.chapter_id
          WHERE ch.course_id = ?
          ORDER BY r.position ASC, r.created_at ASC`,
    args: [id],
  });

  const byChapter = new Map<string, AdminResource[]>();
  for (const resource of resourceResult.rows) {
    const chapterId = String(resource.chapter_id);
    const list = byChapter.get(chapterId) ?? [];
    list.push({
      id: String(resource.id),
      uploadId: String(resource.upload_id),
      label: String(resource.label),
      position: Number(resource.position),
      fileName: String(resource.original_name),
      mimeType: String(resource.mime_type),
      sizeBytes: Number(resource.size_bytes),
    });
    byChapter.set(chapterId, list);
  }

  return {
    ...toAdminCourse(row),
    chapters: chapterResult.rows.map((chapter) => ({
      id: String(chapter.id),
      position: Number(chapter.position),
      title: String(chapter.title),
      bunnyVideoId: String(chapter.bunny_video_id ?? ""),
      videoUrl: String(chapter.video_url ?? ""),
      videoAsset: String(chapter.video_asset ?? ""),
      durationSeconds: Number(chapter.duration_seconds ?? 0),
      resources: byChapter.get(String(chapter.id)) ?? [],
    })),
  };
}

/* ----------------------------------------------------------------- courses */

export async function createCourse(input: CourseInput): Promise<string> {
  const id = input.id?.trim() || `course-${randomUUID().slice(0, 8)}`;

  const clash = await db.execute({
    sql: "SELECT id FROM course WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (clash.rows.length > 0) {
    throw new AdminError(`コースID「${id}」はすでに使われています。`);
  }

  const next = await db.execute(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM course"
  );

  await db.execute({
    sql: `INSERT INTO course
            (id, title, subtitle, description, thumbnail_url, price_jpy,
             instructor_name, instructor_title, level, published, sort_order,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    args: [
      id,
      input.title,
      input.subtitle,
      input.description,
      input.thumbnailUrl,
      input.priceJpy,
      input.instructorName,
      input.instructorTitle,
      input.level,
      input.published ? 1 : 0,
      Number(next.rows[0]?.next ?? 1),
    ],
  });

  return id;
}

export async function updateCourse(id: string, input: CourseInput): Promise<void> {
  const result = await db.execute({
    sql: `UPDATE course SET
            title = ?, subtitle = ?, description = ?, thumbnail_url = ?,
            price_jpy = ?, instructor_name = ?, instructor_title = ?, level = ?,
            published = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [
      input.title,
      input.subtitle,
      input.description,
      input.thumbnailUrl,
      input.priceJpy,
      input.instructorName,
      input.instructorTitle,
      input.level,
      input.published ? 1 : 0,
      id,
    ],
  });

  if (result.rowsAffected === 0) {
    throw new AdminError("対象のコースが見つかりませんでした。");
  }
}

/** Flips the publish flag and returns the state the course ended up in. */
export async function setCoursePublished(
  id: string,
  published: boolean
): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE course SET published = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [published ? 1 : 0, id],
  });

  if (result.rowsAffected === 0) {
    throw new AdminError("対象のコースが見つかりませんでした。");
  }
  return published;
}

export async function courseExists(id: string): Promise<boolean> {
  const result = await db.execute({
    sql: "SELECT 1 FROM course WHERE id = ? LIMIT 1",
    args: [id],
  });
  return result.rows.length > 0;
}

/* ---------------------------------------------------------------- chapters */

export async function addChapter(
  courseId: string,
  input: ChapterInput
): Promise<string> {
  if (!(await courseExists(courseId))) {
    throw new AdminError("対象のコースが見つかりませんでした。");
  }

  const next = await db.execute({
    sql: `SELECT COALESCE(MAX(position), 0) + 1 AS next
          FROM chapter WHERE course_id = ?`,
    args: [courseId],
  });

  const id = `ch-${randomUUID()}`;
  await db.execute({
    sql: `INSERT INTO chapter
            (id, course_id, position, title, bunny_video_id, video_url)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      courseId,
      Number(next.rows[0]?.next ?? 1),
      input.title,
      input.bunnyVideoId,
      input.videoUrl,
    ],
  });

  await touchCourse(courseId);
  return id;
}

export async function updateChapter(
  chapterId: string,
  input: ChapterInput
): Promise<void> {
  const courseId = await chapterCourseId(chapterId);
  const result = await db.execute({
    sql: `UPDATE chapter SET title = ?, bunny_video_id = ?, video_url = ?
          WHERE id = ?`,
    args: [input.title, input.bunnyVideoId, input.videoUrl, chapterId],
  });

  if (result.rowsAffected === 0) {
    throw new AdminError("対象のチャプターが見つかりませんでした。");
  }
  await touchCourse(courseId);
}

/**
 * Records what bunny.net reported about the linked video — most importantly
 * its duration, so course-level totals and the rail's clock labels match the
 * real asset instead of the placeholder clip's length.
 */
export async function setChapterDuration(
  chapterId: string,
  durationSeconds: number
): Promise<void> {
  const value = Number(durationSeconds);
  if (!Number.isFinite(value) || value <= 0) return;
  await db.execute({
    sql: "UPDATE chapter SET duration_seconds = ? WHERE id = ?",
    args: [Math.round(value), chapterId],
  });
}

/** Attaches (or replaces) the bunny.net Stream video guid on a chapter. */
export async function setChapterBunnyVideo(
  chapterId: string,
  bunnyVideoId: string
): Promise<void> {
  const result = await db.execute({
    sql: "UPDATE chapter SET bunny_video_id = ? WHERE id = ?",
    args: [bunnyVideoId, chapterId],
  });
  if (result.rowsAffected === 0) {
    throw new AdminError("対象のチャプターが見つかりませんでした。");
  }
  const courseId = await chapterCourseId(chapterId);
  await touchCourse(courseId);
}

export async function deleteChapter(chapterId: string): Promise<void> {
  const courseId = await chapterCourseId(chapterId);

  // Attachments are cascade-deleted by SQLite only when foreign keys are on, so
  // the uploads (rows *and* bytes) are removed explicitly first.
  const resources = await db.execute({
    sql: "SELECT upload_id FROM chapter_resource WHERE chapter_id = ?",
    args: [chapterId],
  });

  await db.execute({
    sql: "DELETE FROM chapter_resource WHERE chapter_id = ?",
    args: [chapterId],
  });
  for (const resource of resources.rows) {
    await deleteUpload(String(resource.upload_id));
  }

  await db.execute({ sql: "DELETE FROM chapter WHERE id = ?", args: [chapterId] });

  await normalisePositions(courseId);
  await touchCourse(courseId);
}

/**
 * Writes an explicit chapter order (drag & drop) or a one-step move (buttons).
 *
 * `chapter` carries UNIQUE (course_id, position) *and* CHECK (position > 0), so
 * the update runs in two passes inside one transaction: park every row above
 * the highest position currently in use, then write the final 1..n numbering.
 * A single pass would collide with the rows not yet moved.
 */
export async function reorderChapters(
  courseId: string,
  orderedIds: string[]
): Promise<void> {
  const current = await db.execute({
    sql: "SELECT id, position FROM chapter WHERE course_id = ? ORDER BY position ASC",
    args: [courseId],
  });
  const existing = current.rows.map((row) => String(row.id));
  const parkBase = current.rows.reduce(
    (max, row) => Math.max(max, Number(row.position)),
    0
  );

  if (existing.length === 0) {
    throw new AdminError("並べ替えるチャプターがありません。");
  }

  const unique = [...new Set(orderedIds)];
  const sameSet =
    unique.length === existing.length &&
    unique.every((id) => existing.includes(id));

  if (!sameSet) {
    throw new AdminError(
      "並び順の指定が現在のチャプター一覧と一致しません。ページを再読み込みしてください。"
    );
  }

  const tx = await db.transaction("write");
  try {
    for (const [index, id] of unique.entries()) {
      await tx.execute({
        sql: "UPDATE chapter SET position = ? WHERE id = ? AND course_id = ?",
        args: [parkBase + index + 1, id, courseId],
      });
    }
    for (const [index, id] of unique.entries()) {
      await tx.execute({
        sql: "UPDATE chapter SET position = ? WHERE id = ? AND course_id = ?",
        args: [index + 1, id, courseId],
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }

  await touchCourse(courseId);
}

/** Moves one chapter a single slot up or down. */
export async function moveChapter(
  chapterId: string,
  direction: "up" | "down"
): Promise<void> {
  const courseId = await chapterCourseId(chapterId);

  const result = await db.execute({
    sql: "SELECT id FROM chapter WHERE course_id = ? ORDER BY position ASC",
    args: [courseId],
  });
  const ids = result.rows.map((row) => String(row.id));
  const index = ids.indexOf(chapterId);
  if (index === -1) {
    throw new AdminError("対象のチャプターが見つかりませんでした。");
  }

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return; // already at the edge

  [ids[index], ids[target]] = [ids[target], ids[index]];
  await reorderChapters(courseId, ids);
}

export async function chapterCourseId(chapterId: string): Promise<string> {
  const result = await db.execute({
    sql: "SELECT course_id FROM chapter WHERE id = ? LIMIT 1",
    args: [chapterId],
  });
  const row = result.rows[0];
  if (!row) throw new AdminError("対象のチャプターが見つかりませんでした。");
  return String(row.course_id);
}

/** Closes gaps left by a delete so positions stay 1..n. */
async function normalisePositions(courseId: string): Promise<void> {
  const result = await db.execute({
    sql: "SELECT id FROM chapter WHERE course_id = ? ORDER BY position ASC",
    args: [courseId],
  });
  const ids = result.rows.map((row) => String(row.id));
  if (ids.length === 0) return;
  await reorderChapters(courseId, ids);
}

async function touchCourse(courseId: string): Promise<void> {
  await db.execute({
    sql: "UPDATE course SET updated_at = datetime('now') WHERE id = ?",
    args: [courseId],
  });
}

/* --------------------------------------------------------------- resources */

export async function addChapterResource(
  chapterId: string,
  uploadId: string,
  label: string
): Promise<void> {
  const courseId = await chapterCourseId(chapterId);

  const next = await db.execute({
    sql: `SELECT COALESCE(MAX(position), 0) + 1 AS next
          FROM chapter_resource WHERE chapter_id = ?`,
    args: [chapterId],
  });

  await db.execute({
    sql: `INSERT INTO chapter_resource (id, chapter_id, upload_id, label, position)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      `res-${randomUUID()}`,
      chapterId,
      uploadId,
      label,
      Number(next.rows[0]?.next ?? 1),
    ],
  });

  await touchCourse(courseId);
}

export async function deleteChapterResource(resourceId: string): Promise<void> {
  const result = await db.execute({
    sql: `SELECT r.upload_id, ch.course_id
          FROM chapter_resource r
          JOIN chapter ch ON ch.id = r.chapter_id
          WHERE r.id = ? LIMIT 1`,
    args: [resourceId],
  });
  const row = result.rows[0];
  if (!row) throw new AdminError("対象の資料が見つかりませんでした。");

  await db.execute({
    sql: "DELETE FROM chapter_resource WHERE id = ?",
    args: [resourceId],
  });
  await deleteUpload(String(row.upload_id));
  await touchCourse(String(row.course_id));
}
