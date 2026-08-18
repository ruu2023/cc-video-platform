import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { hasPurchased } from "@/lib/entitlements";
import { getWatchChapter } from "@/lib/watch";
import { saveChapterProgress } from "@/lib/progress";

/**
 * Playback-position sink for the player.
 *
 * The client posts every few seconds while playing, on pause, on `ended`, and
 * once more when the page is being hidden (via `sendBeacon`). The payload is
 * fully untrusted: the course id is taken from the chapter row, never from the
 * request, and the same entitlement gate as the streaming route applies — a
 * user cannot record progress on a course they do not own.
 */

export const dynamic = "force-dynamic";

type Payload = {
  chapterId?: unknown;
  positionSeconds?: unknown;
  durationSeconds?: unknown;
  completed?: unknown;
};

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function seconds(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  // A day is far beyond any plausible lesson; anything above is a bad payload.
  return Math.min(number, 60 * 60 * 24);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return json({ error: "ログインが必要です。" }, 401);
  }

  let payload: Payload;
  try {
    // sendBeacon posts a Blob, so the content-type is not always JSON —
    // parse the raw text instead of relying on request.json().
    const raw = await request.text();
    payload = raw ? (JSON.parse(raw) as Payload) : {};
  } catch {
    return json({ error: "リクエストの形式が不正です。" }, 400);
  }

  const chapterId = typeof payload.chapterId === "string" ? payload.chapterId : "";
  if (!chapterId) {
    return json({ error: "chapterId は必須です。" }, 400);
  }

  const chapter = await getWatchChapter(chapterId);
  if (!chapter || !chapter.coursePublished) {
    return json({ error: "チャプターが見つかりません。" }, 404);
  }

  if (!(await hasPurchased(user.id, chapter.courseId))) {
    return json({ error: "このコースを購入していません。" }, 403);
  }

  try {
    const saved = await saveChapterProgress({
      userId: user.id,
      courseId: chapter.courseId,
      chapterId: chapter.id,
      positionSeconds: seconds(payload.positionSeconds),
      // Fall back to the length recorded on the chapter when the client has
      // not read metadata yet, so completion can still be computed.
      durationSeconds:
        seconds(payload.durationSeconds) || chapter.durationSeconds,
      completed: payload.completed === true,
    });

    return json({ ok: true, progress: saved }, 200);
  } catch (error) {
    console.error("POST /api/progress failed", error);
    return json({ error: "進捗の保存に失敗しました。" }, 500);
  }
}
