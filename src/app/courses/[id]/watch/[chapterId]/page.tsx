import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPublishedCourse } from "@/lib/courses";
import { getCurrentUser } from "@/lib/session";
import { hasPurchased } from "@/lib/entitlements";
import { getWatchChapter, listWatchChapters } from "@/lib/watch";
import { getCourseProgress } from "@/lib/progress";
import { signedPlaybackUrl, resolveTtlSeconds, DEFAULT_TOKEN_TTL_SECONDS } from "@/lib/video-token";
import { resolveVideoSource, VideoSourceError } from "@/lib/video-source";
import {
  emptyChapterProgress,
  formatClock,
  resumePosition,
} from "@/lib/watch-types";
import { listCourseResources } from "@/lib/resources";
import { VideoPlayer } from "@/components/watch/VideoPlayer";
import { LockedNotice } from "@/components/watch/LockedNotice";
import { ChapterResourcePanel } from "@/components/resources/ResourceDownloads";

/**
 * The lesson screen.
 *
 * Access is decided here in the same order as in the streaming route — signed
 * in, then entitled — and the two are independent: this page rendering a player
 * is never what authorises the bytes, `/api/stream/[chapterId]` re-checks
 * everything for itself.
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string; chapterId: string }>;
  searchParams: Promise<{ ttl?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { chapterId } = await params;
  const chapter = await getWatchChapter(chapterId);
  return {
    title: chapter ? `${chapter.title} | ${chapter.courseTitle}` : "レッスン",
    robots: { index: false, follow: false },
  };
}

export default async function WatchPage({ params, searchParams }: PageProps) {
  const { id, chapterId } = await params;
  const query = await searchParams;

  const [course, chapter, user] = await Promise.all([
    getPublishedCourse(id),
    getWatchChapter(chapterId),
    getCurrentUser(),
  ]);

  // A draft course, an unknown id, or a chapter that belongs to a different
  // course — all indistinguishable 404s from the outside.
  if (!course || !chapter || chapter.courseId !== course.id) {
    notFound();
  }

  // Gate 1 — signed out visitors never reach a player.
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/courses/${id}/watch/${chapterId}`)}`);
  }

  // Gate 2 — signed in but without an entitlement: an explicit locked screen
  // that contains no <video> element and no stream URL at all.
  const purchased = await hasPurchased(user.id, course.id);
  if (!purchased) {
    return <LockedNotice course={course} chapterTitle={chapter.title} />;
  }

  // Only fetched past the entitlement gate above — an unowned course never even
  // loads the attachment rows, let alone renders a link to them.
  const [chapters, progress, courseResources] = await Promise.all([
    listWatchChapters(course.id),
    getCourseProgress(user.id, course.id),
    listCourseResources(course.id),
  ]);

  // The whole course's attachments are loaded in one query: the panel below the
  // player needs this chapter's, and the rail badges need the per-chapter tally.
  const resources = courseResources.filter((r) => r.chapterId === chapter.id);
  const resourceCounts = new Map<string, number>();
  for (const item of courseResources) {
    resourceCounts.set(item.chapterId, (resourceCounts.get(item.chapterId) ?? 0) + 1);
  }

  const chapterProgress =
    progress.byChapter[chapter.id] ?? emptyChapterProgress(chapter.id);
  const resumeSeconds = resumePosition(chapterProgress, chapter.durationSeconds);

  /*
   * Playback URLs are short-lived by default. `?ttl=<seconds>` narrows that
   * window (clamped to 5s–12h by resolveTtlSeconds) so the expiry rule can be
   * observed end-to-end without waiting out the default lifetime — open
   * `?ttl=10`, wait, and the very next byte range is rejected with 403.
   */
  const ttlSeconds = query?.ttl
    ? resolveTtlSeconds(query.ttl)
    : DEFAULT_TOKEN_TTL_SECONDS;

  /*
   * Playback source. A chapter linked to a finished bunny.net Stream video
   * plays straight off the signed CDN URL (https://vz-…/{guid}/play_720p.mp4?
   * token=HS256-…&expires=…) — this page only ever runs after the entitlement
   * gate, so the URL is minted per page view, for this buyer only, with a short
   * lifetime. Everything else (local placeholder clips) keeps going through the
   * doubly-gated /api/stream route.
   */
  let streamUrl: string;
  let streamExpires: number;
  let playbackError: string | null = null;
  try {
    const source = await resolveVideoSource(chapter, ttlSeconds);
    if (source.kind === "bunny") {
      streamUrl = source.url;
      streamExpires = source.expires;
    } else {
      const signed = signedPlaybackUrl(`/api/stream/${chapter.id}`, ttlSeconds);
      streamUrl = signed.url;
      streamExpires = signed.expires;
    }
  } catch (error) {
    streamUrl = "";
    streamExpires = 0;
    playbackError =
      error instanceof VideoSourceError
        ? error.message
        : "動画の読み込みに失敗しました。";
  }

  const index = chapters.findIndex((c) => c.id === chapter.id);
  const previous = index > 0 ? chapters[index - 1] : null;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null;

  return (
    <div className="container watch">
      <nav className="breadcrumb" aria-label="パンくずリスト">
        <Link href="/courses">コース一覧</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/courses/${course.id}`}>{course.title}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{chapter.title}</span>
      </nav>

      <div className="watch__grid">
        <main className="watch__main">
          <header className="watch__head">
            <span className="eyebrow">
              チャプター {String(chapter.position).padStart(2, "0")} / {chapters.length}
            </span>
            <h1 className="display-md" data-testid="chapter-title">
              {chapter.title}
            </h1>
          </header>

          {playbackError ? (
            <p className="player__denial" role="alert" data-testid="playback-error" data-reason="source-missing">
              <span>{playbackError}</span>
            </p>
          ) : (
            <VideoPlayer
              // Remount on chapter change: the player pins its signed URL and
              // resume point at mount time.
              key={chapter.id}
              chapterId={chapter.id}
              chapterTitle={chapter.title}
              src={streamUrl}
              expiresAt={streamExpires}
              resumeSeconds={resumeSeconds}
              durationHint={chapter.durationSeconds}
              initialCompleted={chapterProgress.completed}
              hasResources={resources.length > 0}
            />
          )}

          <ChapterResourcePanel resources={resources} />

          <nav className="watch__pager" aria-label="チャプター移動">
            {previous ? (
              <Link
                href={`/courses/${course.id}/watch/${previous.id}`}
                className="watch__pager-link"
                data-testid="previous-chapter"
              >
                <span className="caption">前のチャプター</span>
                <span className="title-sm">{previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={`/courses/${course.id}/watch/${next.id}`}
                className="watch__pager-link watch__pager-link--next"
                data-testid="next-chapter"
              >
                <span className="caption">次のチャプター</span>
                <span className="title-sm">{next.title}</span>
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </main>

        <aside className="watch__rail" aria-label="カリキュラム">
          <div className="watch__rail-head">
            <span className="eyebrow">コース進捗</span>
            <div className="progress-figure" data-testid="watch-progress-percent">
              {progress.percent}%
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${course.title} の視聴進捗`}
            >
              <span
                className="progress-track__fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="caption">
              {progress.completedChapters} / {progress.totalChapters} チャプター視聴完了
            </p>
          </div>

          <ol className="watch-rail-list" data-testid="watch-chapter-list">
            {chapters.map((item) => {
              const itemProgress =
                progress.byChapter[item.id] ?? emptyChapterProgress(item.id);
              const active = item.id === chapter.id;
              const itemResources = resourceCounts.get(item.id) ?? 0;

              return (
                <li key={item.id}>
                  <Link
                    href={`/courses/${course.id}/watch/${item.id}`}
                    className={`watch-rail-item ${active ? "watch-rail-item--active" : ""}`}
                    data-testid={`watch-rail-${item.id}`}
                    data-completed={itemProgress.completed ? "true" : "false"}
                    data-resources={itemResources}
                    aria-current={active ? "page" : undefined}
                  >
                    <span
                      className={`watch-rail-item__mark ${
                        itemProgress.completed ? "watch-rail-item__mark--done" : ""
                      }`}
                      aria-hidden="true"
                    >
                      {itemProgress.completed ? (
                        <CheckIcon />
                      ) : (
                        String(item.position).padStart(2, "0")
                      )}
                    </span>
                    <span className="watch-rail-item__text">
                      <span className="watch-rail-item__title">{item.title}</span>
                      <span className="watch-rail-item__meta">
                        {item.durationSeconds > 0 && formatClock(item.durationSeconds)}
                        {itemProgress.completed
                          ? " · 視聴完了"
                          : itemProgress.positionSeconds > 1
                            ? ` · 途中 ${formatClock(itemProgress.positionSeconds)}`
                            : ""}
                        {itemResources > 0 && ` · 資料 ${itemResources} 件`}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>

          <Link href={`/courses/${course.id}`} className="watch__rail-back">
            コース詳細に戻る
          </Link>
        </aside>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}
