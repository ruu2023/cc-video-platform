import { NextResponse } from "next/server";
import { getUpload, readUploadBytes } from "@/lib/uploads";
import { resolveUploadUsage } from "@/lib/resources";
import { getCurrentUser, isCreator } from "@/lib/session";
import { hasPurchased } from "@/lib/entitlements";

/**
 * The only route that ever emits uploaded bytes.
 *
 * Files live outside `public/`, so every request lands here and the access rule
 * is picked from what the file is *used for* (`resolveUploadUsage`):
 *
 *   chapter attachment → gated, exactly like `/api/stream/[chapterId]`:
 *       1. the chapter's course is published        → 404
 *       2. a signed-in session                      → 401
 *       3. a paid entitlement for that course       → 403
 *   course thumbnail   → public while the course is published (it is rendered
 *                        on the catalogue, which signed-out visitors can see).
 *   unattached         → creator-only; nobody else has a reason to fetch it.
 *
 * The creator bypasses all of it: the admin screens preview and re-download
 * their own uploads, and those screens are already creator-gated by
 * `requireCreator`.
 *
 * Gated responses are `no-store` so a revoked entitlement cannot be replayed
 * out of a browser or proxy cache.
 */

export const dynamic = "force-dynamic";

function deny(status: number, message: string, reason: string) {
  return new NextResponse(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-download-denied": reason,
    },
  });
}

const NOT_FOUND = () => deny(404, "ファイルが見つかりません。", "not-found");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const record = await getUpload(id);

  if (!record) {
    return NOT_FOUND();
  }

  const usage = await resolveUploadUsage(id);
  const user = await getCurrentUser();
  const creator = isCreator(user);

  // Whether the bytes may be cached at all. Only genuinely public files are.
  let cacheable = false;

  if (usage.kind === "chapter-resource") {
    if (!usage.coursePublished && !creator) {
      // A draft course must not even confirm that the attachment exists.
      return NOT_FOUND();
    }
    if (!creator) {
      if (!user) {
        return deny(
          401,
          "この資料をダウンロードするにはログインが必要です。",
          "unauthenticated"
        );
      }
      if (!(await hasPurchased(user.id, usage.courseId))) {
        return deny(
          403,
          "このコースを購入したアカウントでのみ資料をダウンロードできます。",
          "not-purchased"
        );
      }
    }
  } else if (usage.kind === "course-thumbnail") {
    if (!usage.coursePublished && !creator) {
      return NOT_FOUND();
    }
    cacheable = usage.coursePublished;
  } else if (!creator) {
    // Uploaded but not linked to anything yet — only its owner can see it.
    return user
      ? deny(403, "このファイルにアクセスする権限がありません。", "not-entitled")
      : deny(401, "このファイルを開くにはログインが必要です。", "unauthenticated");
  }

  try {
    const bytes = await readUploadBytes(record);
    const inline =
      usage.kind === "course-thumbnail" && record.mimeType !== "image/svg+xml";
    const filename = encodeURIComponent(record.originalName);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": record.mimeType,
        "content-length": String(bytes.byteLength),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
        // Public thumbnails are immutable (the id is a UUID minted per upload).
        // Everything else must be re-authorised on every request.
        "cache-control": cacheable
          ? "public, max-age=31536000, immutable"
          : "no-store, private, max-age=0",
        "x-content-type-options": "nosniff",
        "x-robots-tag": cacheable ? "all" : "noindex, nofollow",
      },
    });
  } catch (error) {
    console.error(`GET /api/uploads/${id} failed`, error);
    return deny(410, "この資料はすでに削除されています。", "bytes-missing");
  }
}

/**
 * HEAD runs the identical gate, so a probe can never confirm the existence of
 * a file the caller is not allowed to download.
 *
 * The GET body is cancelled rather than dropped: it is a materialised buffer
 * plus an open handle, and letting it fall out of scope unread would leak one
 * per probe.
 */
export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const response = await GET(request, context);
  await response.body?.cancel().catch(() => {});
  return new NextResponse(null, {
    status: response.status,
    headers: response.headers,
  });
}
