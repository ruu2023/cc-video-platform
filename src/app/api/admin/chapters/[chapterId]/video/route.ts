import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireCreatorApi } from "@/lib/admin-guard";
import { getWatchChapter } from "@/lib/watch";
import {
  BunnyError,
  createBunnyVideo,
  getBunnyVideo,
  uploadBunnyVideo,
  bunnyStatusLabel,
} from "@/lib/bunny";
import { setChapterBunnyVideo, setChapterDuration } from "@/lib/admin-courses";

/**
 * Server-side video upload for the chapter editor (Sprint 6, feature D).
 *
 * The browser posts the raw media bytes here; this route — and only this
 * route — talks to bunny.net with BUNNY_STREAM_API_KEY. No request the browser
 * ever sends (headers, body, or page source) contains that key.
 *
 *   POST /api/admin/chapters/{chapterId}/video   body = media bytes
 *     → create video in the library → upload bytes → save guid on the chapter
 *   GET  /api/admin/chapters/{chapterId}/video   → encode status from bunny
 *
 * Both require a creator session; a viewer gets 403 even posting directly.
 */

export const dynamic = "force-dynamic";

/** Bunny's simple (non-TUS) upload endpoint tops out at 2 GB. */
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-m4v": ".m4v",
  "video/x-matroska": ".mkv",
};

const ALLOWED_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".mkv",
]);

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function fileNameFromRequest(request: Request): string {
  const raw = request.headers.get("x-file-name") ?? "";
  // The header cannot carry non-ASCII as-is; encodeURI is what the client sends.
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  return name.replace(/[\r\n\\/]/g, "_").slice(0, 200) || "lesson.mp4";
}

function allowedUpload(name: string, contentType: string): boolean {
  const declared = (contentType || "").toLowerCase().split(";")[0].trim();
  if (declared && ALLOWED_VIDEO_TYPES[declared]) return true;
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(extension)) return true;
  return false;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chapterId: string }> }
) {
  const gate = await requireCreatorApi();
  if (!gate.ok) {
    return jsonError(
      gate.status,
      gate.status === 401
        ? "この操作にはログインが必要です。"
        : "この操作はcreator権限でのみ実行できます。"
    );
  }

  const { chapterId } = await params;
  const chapter = await getWatchChapter(chapterId);
  if (!chapter) {
    return jsonError(404, "対象のチャプターが見つかりません。");
  }

  const fileName = fileNameFromRequest(request);
  const contentType =
    (request.headers.get("content-type") || "").toLowerCase().split(";")[0] ||
    "video/mp4";

  if (!allowedUpload(fileName, contentType)) {
    return jsonError(
      415,
      "動画ファイル（MP4 / MOV / WebM / MKV）を選択してください。"
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_BYTES) {
    return jsonError(413, "動画サイズは2GBまでです。");
  }
  if (!request.body) {
    return jsonError(400, "アップロードするファイルが空です。");
  }

  try {
    // 1 — create the video entry (title = chapter title + file name, so the
    // bunny dashboard stays readable when several lessons are uploaded).
    const title = `${chapter.courseTitle} / ${chapter.title} — ${fileName}`;
    const guid = await createBunnyVideo(title);

    // 2 — stream the bytes straight through to bunny; nothing is buffered.
    await uploadBunnyVideo(
      guid,
      request.body,
      contentType,
      Number.isFinite(contentLength) ? contentLength : undefined
    );

    // 3 — attach the guid to the chapter. Playback stays on the local fallback
    // clip until bunny reports encode status 4.
    await setChapterBunnyVideo(chapterId, guid);

    revalidatePath(`/admin/courses/${chapter.courseId}`);
    revalidatePath(`/courses/${chapter.courseId}`);

    let status = 3;
    try {
      const video = await getBunnyVideo(guid);
      if (video) status = video.status;
    } catch {
      // The upload itself succeeded; status polling will catch up.
    }

    return NextResponse.json({
      videoId: guid,
      status,
      statusLabel: bunnyStatusLabel(status),
      message: "動画をアップロードしました。エンコード完了後に自動で紐付きます。",
    });
  } catch (error) {
    if (error instanceof BunnyError) {
      return jsonError(error.status >= 400 && error.status < 600 ? error.status : 502, error.message);
    }
    console.error(`POST /api/admin/chapters/${chapterId}/video failed`, error);
    return jsonError(500, "動画のアップロードに失敗しました。");
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chapterId: string }> }
) {
  const gate = await requireCreatorApi();
  if (!gate.ok) {
    return jsonError(
      gate.status,
      gate.status === 401
        ? "この操作にはログインが必要です。"
        : "この操作はcreator権限でのみ実行できます。"
    );
  }

  const { chapterId } = await params;
  const chapter = await getWatchChapter(chapterId);
  if (!chapter) {
    return jsonError(404, "対象のチャプターが見つかりません。");
  }
  if (!chapter.bunnyVideoId.trim()) {
    return NextResponse.json({
      videoId: null,
      status: null,
      statusLabel: "未設定",
      durationSeconds: chapter.durationSeconds,
    });
  }

  try {
    const video = await getBunnyVideo(chapter.bunnyVideoId);
    if (!video) {
      return NextResponse.json({
        videoId: chapter.bunnyVideoId,
        status: null,
        statusLabel: "未確認",
        durationSeconds: chapter.durationSeconds,
      });
    }

    // Latch the real duration the moment bunny finishes encoding, so the
    // catalogue stops guessing from the placeholder clip.
    if (video.status === 4 && video.lengthSeconds > 0) {
      await setChapterDuration(chapterId, video.lengthSeconds);
    }

    return NextResponse.json({
      videoId: video.guid,
      status: video.status,
      statusLabel: bunnyStatusLabel(video.status),
      title: video.title,
      durationSeconds:
        video.status === 4 && video.lengthSeconds > 0
          ? video.lengthSeconds
          : chapter.durationSeconds,
    });
  } catch (error) {
    if (error instanceof BunnyError) {
      return jsonError(502, error.message);
    }
    console.error(`GET /api/admin/chapters/${chapterId}/video failed`, error);
    return jsonError(500, "動画ステータスの取得に失敗しました。");
  }
}
