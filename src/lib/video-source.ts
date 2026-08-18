import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getBunnyVideo, signedStreamPlaybackUrl, streamConfigured } from "@/lib/bunny";

/**
 * THE one place that decides where a chapter's video bytes come from.
 *
 * Sprint 6: a chapter whose `bunny_video_id` points at a real, finished
 * (status=4) video in the bunny.net Stream library plays straight off the
 * signed CDN URL (`https://vz-…/{guid}/play_720p.mp4?token=…&expires=…`).
 *
 * The seeded catalogue still carries placeholder GUIDs that do not exist in the
 * real library, and a freshly uploaded video is not playable until bunny
 * finishes encoding it — for those, playback falls back to the local
 * placeholder clips under `data/videos/` served through the token-checked
 * `/api/stream/[chapterId]` route, so the lesson never dead-ends.
 */

export type VideoSource =
  | {
      kind: "local";
      /** Absolute path of the clip on disk. */
      filePath: string;
      contentType: string;
    }
  | {
      kind: "bunny";
      /** Fully qualified bunny.net CDN URL, already token-signed. */
      url: string;
      /** Unix seconds at which the signed URL stops working. */
      expires: number;
    };

const VIDEO_DIR = resolve(process.cwd(), "data", "videos");

export class VideoSourceError extends Error {}

/** True once bunny.net is actually configured. */
export function bunnyConfigured(): boolean {
  return streamConfigured();
}

/**
 * Rejects anything that is not a bare filename, so a crafted `video_asset`
 * value can never escape `data/videos/`.
 */
function assetPath(asset: string): string {
  const name = asset.trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new VideoSourceError(`不正な動画アセット名です: ${asset}`);
  }
  const path = resolve(VIDEO_DIR, name);
  if (!path.startsWith(`${VIDEO_DIR}${sep}`)) {
    throw new VideoSourceError(`動画アセットのパスが不正です: ${asset}`);
  }
  return path;
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  m4v: "video/x-m4v",
};

function contentTypeFor(asset: string): string {
  const ext = asset.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export type ChapterVideoRef = {
  id: string;
  bunnyVideoId: string;
  videoAsset: string;
};

/**
 * Resolves a chapter to its playable source.
 *
 * The bunny.net branch first asks the Stream management API whether the guid
 * really exists and has finished encoding — the seeded catalogue carries
 * demo GUIDs that were minted before the real account existed, and handing the
 * player a signed URL for one of those would die with a CDN 403.
 *
 * A nonexistent or still-encoding guid falls back to the local clip (if any);
 * a chapter with neither a usable bunny video nor a local asset raises.
 */
export async function resolveVideoSource(
  chapter: ChapterVideoRef,
  ttlSeconds: number = 30 * 60
): Promise<VideoSource> {
  if (bunnyConfigured() && chapter.bunnyVideoId.trim()) {
    let video = null;
    try {
      video = await getBunnyVideo(chapter.bunnyVideoId);
    } catch (error) {
      // The management API being down must not take the local fallback with it.
      console.error(
        `resolveVideoSource: bunny lookup failed for ${chapter.bunnyVideoId}`,
        error
      );
    }

    if (video && video.status === 4) {
      const { url, expires } = signedStreamPlaybackUrl(
        chapter.bunnyVideoId,
        ttlSeconds
      );
      return { kind: "bunny", url, expires };
    }
    if (video && video.status !== 4 && !chapter.videoAsset) {
      throw new VideoSourceError(
        video.status === 3 || video.status === 2 || video.status === 0 || video.status === 1
          ? "この動画は現在エンコード中です。しばらくしてからもう一度お試しください。"
          : "この動画のエンコードに失敗しました。管理者に連絡してください。"
      );
    }
  }

  if (!chapter.videoAsset) {
    throw new VideoSourceError(
      `チャプター ${chapter.id} に動画が紐付いていません。`
    );
  }

  return {
    kind: "local",
    filePath: assetPath(chapter.videoAsset),
    contentType: contentTypeFor(chapter.videoAsset),
  };
}

export type LocalVideoFile = {
  filePath: string;
  contentType: string;
  size: number;
};

/** Stats a local clip, or throws when the file has not been generated yet. */
export async function statLocalVideo(
  source: Extract<VideoSource, { kind: "local" }>
): Promise<LocalVideoFile> {
  try {
    const info = await stat(source.filePath);
    if (!info.isFile()) throw new Error("not a file");
    return {
      filePath: source.filePath,
      contentType: source.contentType,
      size: info.size,
    };
  } catch {
    throw new VideoSourceError(
      "動画ファイルが見つかりません。`npm run videos` を実行してください。"
    );
  }
}

export type ByteRange = { start: number; end: number };

/**
 * Parses a single-range `Range: bytes=a-b` header. Multi-range requests and
 * unsatisfiable ranges return null / "unsatisfiable" so the route can answer
 * with the right status code — seeking in <video> depends on this being right.
 */
export function parseRange(
  header: string | null,
  size: number
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "unsatisfiable";

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "unsatisfiable";

  let start: number;
  let end: number;

  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unsatisfiable";
  if (start > end || start >= size) return "unsatisfiable";

  return { start, end: Math.min(end, size - 1) };
}

/**
 * Node read stream for a byte range, adapted to a web ReadableStream.
 *
 * The source is paused whenever the consumer stops keeping up and resumed from
 * `pull`, so a slow client cannot make the server buffer a whole video in
 * memory. `cancel` destroys the descriptor — browsers abandon media requests
 * constantly while seeking.
 */
export function readVideoRange(
  file: LocalVideoFile,
  range: ByteRange | null
): ReadableStream<Uint8Array> {
  const node = createReadStream(
    file.filePath,
    range ? { start: range.start, end: range.end } : undefined
  );

  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk) => {
        controller.enqueue(
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk)
        );
        if ((controller.desiredSize ?? 1) <= 0) node.pause();
      });
      node.on("end", () => controller.close());
      node.on("error", (error) => controller.error(error));
    },
    pull() {
      node.resume();
    },
    cancel() {
      node.destroy();
    },
  });
}
