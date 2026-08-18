import { NextResponse } from "next/server";
import { requireCreatorApi } from "@/lib/admin-guard";
import { getWatchChapter } from "@/lib/watch";
import { BunnyError, beginTusUpload, getBunnyVideo, bunnyStatusLabel } from "@/lib/bunny";
import { setChapterDuration } from "@/lib/admin-courses";

/**
 * Video upload authorization for the chapter editor (Sprint 6, feature D).
 *
 * The actual bytes never pass through this server or Vercel: Node.js
 * Serverless Functions cap request bodies at ~4.5 MB, far below any real
 * lesson video, so an earlier version that streamed the upload through a
 * route handler worked locally but failed in production. Instead:
 *
 *   POST /api/admin/chapters/{chapterId}/video          → creates the bunny
 *     video entry and mints a short-lived TUS upload authorization; the
 *     browser then uploads directly to bunny.net with it (see
 *     `.../video/complete/route.ts` for the step after that finishes)
 *   GET  /api/admin/chapters/{chapterId}/video           → encode status from bunny
 *
 * Both require a creator session; a viewer gets 403 even posting directly.
 */

export const dynamic = "force-dynamic";

const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-m4v": ".m4v",
  "video/x-matroska": ".mkv",
};

const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv"]);

/** bunny.net's simple (non-TUS) upload endpoint tops out at 2 GB; TUS goes well
 *  beyond that, but the app keeps the same ceiling for a sane upload UI. */
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function allowedUpload(name: string, contentType: string): boolean {
  const declared = (contentType || "").toLowerCase().split(";")[0].trim();
  if (declared && ALLOWED_VIDEO_TYPES[declared]) return true;
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  return ALLOWED_EXTENSIONS.has(extension);
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

  const body = await request.json().catch(() => null);
  const fileName = String(body?.fileName ?? "").slice(0, 200) || "lesson.mp4";
  const contentType = String(body?.contentType ?? "video/mp4");
  const fileSize = Number(body?.fileSize);

  if (!allowedUpload(fileName, contentType)) {
    return jsonError(415, "動画ファイル（MP4 / MOV / WebM / MKV）を選択してください。");
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return jsonError(400, "アップロードするファイルが空です。");
  }
  if (fileSize > MAX_VIDEO_BYTES) {
    return jsonError(413, "動画サイズは2GBまでです。");
  }

  try {
    const title = `${chapter.courseTitle} / ${chapter.title} — ${fileName}`;
    const authorization = await beginTusUpload(title);
    return NextResponse.json(authorization);
  } catch (error) {
    if (error instanceof BunnyError) {
      return jsonError(error.status >= 400 && error.status < 600 ? error.status : 502, error.message);
    }
    console.error(`POST /api/admin/chapters/${chapterId}/video failed`, error);
    return jsonError(500, "動画アップロードの準備に失敗しました。");
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
