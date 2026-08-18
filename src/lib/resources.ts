import { extname } from "node:path";
import { db } from "@/lib/db";
import type { Row } from "@libsql/client";

/**
 * Chapter attachments as the *learner* sees them.
 *
 * `src/lib/admin-courses.ts` already reads `chapter_resource` for the creator's
 * editing screens; this module is the read-only counterpart used by the public
 * pages and by the download route's authorisation check, so the two never share
 * a query that could accidentally leak an admin-only field.
 *
 * Nothing here decides access. Every caller that emits bytes goes through
 * `resolveUploadUsage` + `hasPurchased` — see src/app/api/uploads/[id]/route.ts.
 */

export type CourseResource = {
  id: string;
  chapterId: string;
  chapterPosition: number;
  chapterTitle: string;
  uploadId: string;
  label: string;
  position: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Download endpoint — the only way to reach the bytes. */
  href: string;
  /** Short uppercase type tag ("PDF", "ZIP", …) for the UI badge. */
  kindLabel: string;
};

const RESOURCE_COLUMNS = `
  r.id, r.chapter_id, r.upload_id, r.label, r.position,
  ch.position AS chapter_position, ch.title AS chapter_title,
  u.original_name, u.mime_type, u.size_bytes
`;

/** Best-effort human tag for a file, from its extension and then its MIME type. */
export function resourceKindLabel(fileName: string, mimeType: string): string {
  const extension = extname(fileName).replace(".", "").toUpperCase();
  if (extension) return extension === "JPEG" ? "JPG" : extension;

  const subtype = mimeType.split("/")[1] ?? "";
  if (!subtype) return "FILE";
  if (subtype.includes("wordprocessingml")) return "DOCX";
  if (subtype.includes("spreadsheetml")) return "XLSX";
  if (subtype.includes("presentationml")) return "PPTX";
  return subtype.replace(/^x-/, "").slice(0, 5).toUpperCase();
}

function toResource(row: Row): CourseResource {
  const fileName = String(row.original_name);
  const mimeType = String(row.mime_type);

  return {
    id: String(row.id),
    chapterId: String(row.chapter_id),
    chapterPosition: Number(row.chapter_position ?? 0),
    chapterTitle: String(row.chapter_title ?? ""),
    uploadId: String(row.upload_id),
    label: String(row.label) || fileName,
    position: Number(row.position ?? 1),
    fileName,
    mimeType,
    sizeBytes: Number(row.size_bytes ?? 0),
    href: `/api/uploads/${String(row.upload_id)}`,
    kindLabel: resourceKindLabel(fileName, mimeType),
  };
}

/** Attachments of a single chapter, in the creator's chosen order. */
export async function listChapterResources(
  chapterId: string
): Promise<CourseResource[]> {
  if (!chapterId) return [];

  const result = await db.execute({
    sql: `SELECT ${RESOURCE_COLUMNS}
          FROM chapter_resource r
          JOIN chapter ch ON ch.id = r.chapter_id
          JOIN upload u   ON u.id  = r.upload_id
          WHERE r.chapter_id = ?
          ORDER BY r.position ASC, r.created_at ASC`,
    args: [chapterId],
  });

  return result.rows.map(toResource);
}

/** Every attachment in a course, ordered by chapter then by position. */
export async function listCourseResources(
  courseId: string
): Promise<CourseResource[]> {
  if (!courseId) return [];

  const result = await db.execute({
    sql: `SELECT ${RESOURCE_COLUMNS}
          FROM chapter_resource r
          JOIN chapter ch ON ch.id = r.chapter_id
          JOIN upload u   ON u.id  = r.upload_id
          WHERE ch.course_id = ?
          ORDER BY ch.position ASC, r.position ASC, r.created_at ASC`,
    args: [courseId],
  });

  return result.rows.map(toResource);
}

export type ResourceGroup = {
  chapterId: string;
  chapterPosition: number;
  chapterTitle: string;
  resources: CourseResource[];
};

/** The same rows as `listCourseResources`, bucketed per chapter for the UI. */
export function groupByChapter(resources: CourseResource[]): ResourceGroup[] {
  const groups: ResourceGroup[] = [];
  const index = new Map<string, ResourceGroup>();

  for (const resource of resources) {
    let group = index.get(resource.chapterId);
    if (!group) {
      group = {
        chapterId: resource.chapterId,
        chapterPosition: resource.chapterPosition,
        chapterTitle: resource.chapterTitle,
        resources: [],
      };
      index.set(resource.chapterId, group);
      groups.push(group);
    }
    group.resources.push(resource);
  }

  return groups;
}

export function totalResourceBytes(resources: CourseResource[]): number {
  return resources.reduce((sum, resource) => sum + resource.sizeBytes, 0);
}

/* ------------------------------------------------------------- authorisation */

/**
 * What an uploaded file is actually *used for* — the input the download route
 * needs to pick an access rule.
 *
 * Resolved from usage rather than from `upload.kind` on purpose: the `kind`
 * column records how a file was uploaded, while access has to follow where it
 * ended up. A chapter attachment therefore stays gated even if it happens to be
 * an image, and a file nobody linked anywhere stays creator-only.
 */
export type UploadUsage =
  | {
      kind: "chapter-resource";
      courseId: string;
      coursePublished: boolean;
      chapterId: string;
      label: string;
    }
  | { kind: "course-thumbnail"; courseId: string; coursePublished: boolean }
  | { kind: "unattached" };

export async function resolveUploadUsage(uploadId: string): Promise<UploadUsage> {
  if (!uploadId) return { kind: "unattached" };

  // A chapter attachment always wins: it is the stricter of the two rules, so
  // a file used in both places is gated rather than public.
  const attached = await db.execute({
    sql: `SELECT r.chapter_id, r.label, ch.course_id, c.published
          FROM chapter_resource r
          JOIN chapter ch ON ch.id = r.chapter_id
          JOIN course c   ON c.id  = ch.course_id
          WHERE r.upload_id = ?
          LIMIT 1`,
    args: [uploadId],
  });

  const attachedRow = attached.rows[0];
  if (attachedRow) {
    return {
      kind: "chapter-resource",
      courseId: String(attachedRow.course_id),
      coursePublished: Number(attachedRow.published ?? 0) === 1,
      chapterId: String(attachedRow.chapter_id),
      label: String(attachedRow.label ?? ""),
    };
  }

  // Course thumbnails are rendered on the public catalogue, so they must stay
  // reachable without a session — but only while the course itself is public.
  const thumbnail = await db.execute({
    sql: `SELECT id, published FROM course
          WHERE thumbnail_url = ? OR thumbnail_url = ?
          LIMIT 1`,
    args: [`/api/uploads/${uploadId}`, uploadId],
  });

  const thumbnailRow = thumbnail.rows[0];
  if (thumbnailRow) {
    return {
      kind: "course-thumbnail",
      courseId: String(thumbnailRow.id),
      coursePublished: Number(thumbnailRow.published ?? 0) === 1,
    };
  }

  return { kind: "unattached" };
}
