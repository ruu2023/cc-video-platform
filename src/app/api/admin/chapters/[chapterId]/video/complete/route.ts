import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireCreatorApi } from "@/lib/admin-guard";
import { getWatchChapter } from "@/lib/watch";
import { BunnyError, getBunnyVideo, bunnyStatusLabel } from "@/lib/bunny";
import { setChapterBunnyVideo } from "@/lib/admin-courses";

/**
 * Called by the browser once its direct-to-bunny.net TUS upload finishes.
 * Attaches the video guid to the chapter — only now, not at authorization
 * time, so an abandoned or failed upload never leaves a chapter pointing at
 * an empty bunny video entry.
 */

export const dynamic = "force-dynamic";

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
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
  const videoId = String(body?.videoId ?? "").trim();
  if (!videoId) {
    return jsonError(400, "動画IDがありません。");
  }

  try {
    const video = await getBunnyVideo(videoId);
    if (!video) {
      return jsonError(404, "アップロードされた動画が見つかりませんでした。");
    }

    await setChapterBunnyVideo(chapterId, videoId);
    revalidatePath(`/admin/courses/${chapter.courseId}`);
    revalidatePath(`/courses/${chapter.courseId}`);

    return NextResponse.json({
      videoId: video.guid,
      status: video.status,
      statusLabel: bunnyStatusLabel(video.status),
      message: "動画をアップロードしました。エンコード完了後に自動で紐付きます。",
    });
  } catch (error) {
    if (error instanceof BunnyError) {
      return jsonError(error.status >= 400 && error.status < 600 ? error.status : 502, error.message);
    }
    console.error(`POST /api/admin/chapters/${chapterId}/video/complete failed`, error);
    return jsonError(500, "動画の紐付けに失敗しました。");
  }
}
