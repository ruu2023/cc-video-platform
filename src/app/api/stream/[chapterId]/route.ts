import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { hasPurchased } from "@/lib/entitlements";
import { getWatchChapter } from "@/lib/watch";
import {
  parseRange,
  readVideoRange,
  resolveVideoSource,
  statLocalVideo,
  VideoSourceError,
} from "@/lib/video-source";
import { TOKEN_FAILURE_MESSAGE, verifyPlayback } from "@/lib/video-token";

/**
 * The only route that ever emits video bytes.
 *
 * Four independent gates, all of which must pass — the token alone is never
 * enough, so a leaked URL cannot outlive the entitlement behind it:
 *
 *   1. a signed-in session                    → 401
 *   2. a `token`/`expires` pair that verifies
 *      against this exact path and has not
 *      expired (bunny.net HS256 scheme)        → 403
 *   3. a paid entitlement for the course       → 403
 *   4. the chapter's course is published       → 404
 *
 * Responses are `no-store` and carry `Content-Disposition: inline` plus
 * `X-Robots-Tag: noindex`: nothing here should be cached by a shared proxy or
 * turned into a file by the browser's own download UI.
 */

export const dynamic = "force-dynamic";

function streamPath(chapterId: string): string {
  return `/api/stream/${chapterId}`;
}

function deny(status: number, message: string, reason: string) {
  return new NextResponse(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      // Read by the player so it can show a precise explanation (expired token
      // vs. lost entitlement) instead of the browser's generic media error.
      "x-playback-denied": reason,
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chapterId: string }> }
) {
  const { chapterId } = await params;

  // 1 — session
  const user = await getCurrentUser();
  if (!user) {
    return deny(401, "この動画を再生するにはログインが必要です。", "unauthenticated");
  }

  // 2 — signed, unexpired, path-bound token
  const url = new URL(request.url);
  const verification = verifyPlayback(
    streamPath(chapterId),
    url.searchParams.get("token"),
    url.searchParams.get("expires")
  );
  if (!verification.ok) {
    return deny(403, TOKEN_FAILURE_MESSAGE[verification.reason], verification.reason);
  }

  const chapter = await getWatchChapter(chapterId);
  if (!chapter || !chapter.coursePublished) {
    return deny(404, "チャプターが見つかりません。", "not-found");
  }

  // 3 — entitlement, re-checked on every single request
  if (!(await hasPurchased(user.id, chapter.courseId))) {
    return deny(403, "このコースを購入したアカウントでのみ再生できます。", "not-purchased");
  }

  try {
    // The redirect target's own lifetime is whatever is left on the presented
    // token, so a minted URL can never outlive the entitlement check above.
    const remainingTtl = Math.max(
      5,
      verification.expires - Math.floor(Date.now() / 1000)
    );
    const source = await resolveVideoSource(chapter, remainingTtl);

    // Once bunny.net is configured the signed CDN URL is handed straight to the
    // player instead of proxying bytes through this server.
    if (source.kind === "bunny") {
      return NextResponse.redirect(source.url, 307);
    }

    const file = await statLocalVideo(source);
    const range = parseRange(request.headers.get("range"), file.size);

    if (range === "unsatisfiable") {
      return new NextResponse("Range Not Satisfiable", {
        status: 416,
        headers: { "content-range": `bytes */${file.size}`, "cache-control": "no-store" },
      });
    }

    const headers = new Headers({
      "content-type": file.contentType,
      "accept-ranges": "bytes",
      // Private + no-store: a signed URL must not be replayable from a cache
      // after the entitlement or the token is gone.
      "cache-control": "no-store, private, max-age=0",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      "x-playback-expires": String(verification.expires),
    });

    if (range) {
      headers.set("content-range", `bytes ${range.start}-${range.end}/${file.size}`);
      headers.set("content-length", String(range.end - range.start + 1));
      return new NextResponse(readVideoRange(file, range), { status: 206, headers });
    }

    headers.set("content-length", String(file.size));
    return new NextResponse(readVideoRange(file, null), { status: 200, headers });
  } catch (error) {
    if (error instanceof VideoSourceError) {
      console.error(`GET /api/stream/${chapterId}: ${error.message}`);
      return deny(404, error.message, "source-missing");
    }
    console.error(`GET /api/stream/${chapterId} failed`, error);
    return deny(500, "動画の配信に失敗しました。", "server-error");
  }
}

/**
 * HEAD is what some browsers probe with before opening a media stream — and
 * what the player uses to find out *why* playback was refused.
 *
 * The GET body is cancelled rather than dropped: it is backed by an open file
 * descriptor, and letting it fall out of scope unread would leak one per probe.
 */
export async function HEAD(
  request: Request,
  context: { params: Promise<{ chapterId: string }> }
) {
  const response = await GET(request, context);
  await response.body?.cancel().catch(() => {});
  return new NextResponse(null, {
    status: response.status,
    headers: response.headers,
  });
}
