import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  formatPrice,
  getPublishedCourse,
  LEVEL_LABEL,
} from "@/lib/courses";
import { getCurrentUser } from "@/lib/session";
import { hasPurchased } from "@/lib/entitlements";
import { getCourseProgress } from "@/lib/progress";
import {
  emptyChapterProgress,
  formatClock,
  resumePosition,
} from "@/lib/watch-types";
import { listCourseResources, type CourseResource } from "@/lib/resources";
import { CourseResourceSection } from "@/components/resources/ResourceDownloads";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ canceled?: string; checkout?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const course = await getPublishedCourse(id);

  if (!course) {
    return { title: "コースが見つかりません" };
  }

  return {
    title: course.title,
    description: course.subtitle || course.description.slice(0, 120),
  };
}

export default async function CourseDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [course, user] = await Promise.all([
    getPublishedCourse(id),
    getCurrentUser(),
  ]);

  // Unknown id, or a course that is still a draft — both are a 404 for the
  // public site.
  if (!course) {
    notFound();
  }

  const paragraphs = course.description.split("\n").filter((p) => p.trim() !== "");

  // Owning the course turns this page into the learner's dashboard: the
  // curriculum stops being a teaser list and becomes a progress checklist.
  const purchased = await hasPurchased(user?.id, course.id);

  // Independent of each other once ownership is known — fetched together
  // rather than one after the other.
  const [progress, resources]: [
    Awaited<ReturnType<typeof getCourseProgress>> | null,
    CourseResource[],
  ] = purchased
    ? await Promise.all([
        getCourseProgress(user!.id, course.id),
        listCourseResources(course.id),
      ])
    : [null, []];

  // "Continue" points at the first unfinished chapter, or the first chapter
  // once everything is done (re-watching is always allowed).
  const nextChapter =
    purchased && progress
      ? course.chapters.find((c) => !progress.byChapter[c.id]?.completed) ??
        course.chapters[0] ?? null
      : null;

  const nextChapterProgress =
    nextChapter && progress
      ? progress.byChapter[nextChapter.id] ?? emptyChapterProgress(nextChapter.id)
      : null;

  const resumeSeconds =
    nextChapter && nextChapterProgress
      ? resumePosition(nextChapterProgress, nextChapter.durationSeconds)
      : 0;

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="パンくずリスト">
        <Link href="/">ホーム</Link>
        <span aria-hidden="true">/</span>
        <Link href="/courses">コース一覧</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{course.title}</span>
      </nav>

      <div className="course-detail">
        <div>
          <header className="course-detail__header">
            <div className="course-detail__badges">
              <span className={`badge badge--${course.level}`}>
                {LEVEL_LABEL[course.level]}
              </span>
              <span className="badge">買い切り</span>
              <span className="badge">無期限視聴</span>
            </div>
            <h1 className="display-lg">{course.title}</h1>
            <p className="course-detail__subtitle">{course.subtitle}</p>
            <div className="course-detail__instructor">
              <span className="avatar" aria-hidden="true">
                {course.instructorName.charAt(0)}
              </span>
              <div>
                <div className="title-sm">{course.instructorName}</div>
                <div className="caption">{course.instructorTitle}</div>
              </div>
            </div>
          </header>

          <figure className="course-thumb">
            <Image
              src={course.thumbnailUrl}
              alt={`${course.title} のサムネイル`}
              width={1280}
              height={720}
              priority
              // Thumbnails come from the token-protected bunny.net assets CDN;
              // the browser must fetch the signed URL directly, not through
              // the local image optimizer.
              unoptimized
              data-testid="course-thumbnail"
            />
          </figure>

          <section className="course-block">
            <h2 className="display-sm course-block__title">このコースについて</h2>
            <div className="course-description" data-testid="course-description">
              {paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </section>

          <section className="course-block">
            <h2 className="display-sm course-block__title">
              カリキュラム（{course.chapters.length} チャプター）
            </h2>

            {purchased && progress ? (
              <>
                <ol className="chapter-list chapter-list--owned" data-testid="chapter-list">
                  {course.chapters.map((chapter) => {
                    const chapterProgress =
                      progress.byChapter[chapter.id] ??
                      emptyChapterProgress(chapter.id);
                    const started =
                      !chapterProgress.completed &&
                      chapterProgress.positionSeconds > 1;

                    return (
                      <li
                        key={chapter.id}
                        className="chapter-list__item chapter-list__item--owned"
                        data-testid={`chapter-row-${chapter.id}`}
                        data-completed={chapterProgress.completed ? "true" : "false"}
                      >
                        <Link
                          href={`/courses/${course.id}/watch/${chapter.id}`}
                          className="chapter-link"
                          data-testid={`watch-link-${chapter.id}`}
                        >
                          <span
                            className={`chapter-link__mark ${
                              chapterProgress.completed
                                ? "chapter-link__mark--done"
                                : ""
                            }`}
                            aria-hidden="true"
                          >
                            {chapterProgress.completed ? (
                              <CheckIcon />
                            ) : (
                              String(chapter.position).padStart(2, "0")
                            )}
                          </span>

                          <span className="chapter-link__text">
                            <span className="chapter-list__title">{chapter.title}</span>
                            <span className="chapter-link__meta">
                              {chapter.durationSeconds > 0 && (
                                <span>{formatClock(chapter.durationSeconds)}</span>
                              )}
                              {chapter.resourceCount > 0 && (
                                <span data-testid="chapter-resources">
                                  <FileIcon />
                                  資料 {chapter.resourceCount} 件
                                </span>
                              )}
                              {started && (
                                <span>
                                  途中 {formatClock(chapterProgress.positionSeconds)}
                                </span>
                              )}
                            </span>
                          </span>

                          <span
                            className={`status-check ${
                              chapterProgress.completed ? "status-check--done" : ""
                            }`}
                            data-testid={`chapter-status-${chapter.id}`}
                          >
                            {chapterProgress.completed ? "視聴完了" : "未完了"}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
                <p className="notice notice--soft">
                  <PlayIcon />
                  <span>
                    チャプターを選ぶとストリーミング再生が始まります。再生位置は自動で
                    保存され、次に開いたときは続きから再開します。
                  </span>
                </p>
              </>
            ) : (
              <>
                <ol className="chapter-list" data-testid="chapter-list">
                  {course.chapters.map((chapter) => (
                    <li key={chapter.id} className="chapter-list__item">
                      <span className="chapter-list__number" aria-hidden="true">
                        {String(chapter.position).padStart(2, "0")}
                      </span>
                      <span className="chapter-list__title">{chapter.title}</span>
                      {chapter.resourceCount > 0 && (
                        <span
                          className="chapter-list__resources"
                          data-testid="chapter-resources"
                        >
                          <FileIcon />
                          資料 {chapter.resourceCount} 件
                        </span>
                      )}
                      <span className="chapter-list__lock">
                        <LockIcon />
                        購入後に視聴
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="notice" data-testid="preview-notice">
                  <LockIcon />
                  <span>
                    このコースは無料プレビューを提供していません。購入前に公開しているのは、
                    説明文・サムネイル・チャプタータイトルのみです。動画は購入後に視聴できます。
                  </span>
                </p>
              </>
            )}
          </section>

          {purchased && (
            <CourseResourceSection resources={resources} courseId={course.id} />
          )}
        </div>

        <aside
          className={`buy-card ${purchased ? "buy-card--owned" : ""}`}
          aria-label={purchased ? "受講状況" : "購入"}
        >
          {purchased && progress ? (
            <div className="owned-panel" data-testid="course-progress">
              <span className="badge badge--owned" data-testid="owned-badge">
                購入済み
              </span>

              <div className="progress-figure" data-testid="progress-percent">
                {progress.percent}%
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuenow={progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="コース全体の視聴進捗"
                data-testid="progress-bar"
                data-percent={progress.percent}
              >
                <span
                  className="progress-track__fill"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <p className="owned-panel__count" data-testid="progress-count">
                {progress.completedChapters} / {progress.totalChapters} チャプター視聴完了
              </p>

              {progress.percent === 100 && (
                <p className="owned-panel__done" data-testid="course-completed">
                  <CheckIcon />
                  このコースをすべて視聴しました
                </p>
              )}

              {nextChapter && (
                <div className="buy-card__actions">
                  <Link
                    href={`/courses/${course.id}/watch/${nextChapter.id}`}
                    className="btn btn--primary btn--block"
                    data-testid="continue-watching"
                  >
                    {progress.percent === 100
                      ? "もう一度視聴する"
                      : resumeSeconds > 0
                        ? `続きから再生（${formatClock(resumeSeconds)}）`
                        : progress.completedChapters > 0
                          ? "次のチャプターを再生"
                          : "最初のチャプターを再生"}
                  </Link>
                  <p className="buy-card__hint">{nextChapter.title}</p>
                </div>
              )}

              {resources.length > 0 && (
                <a
                  href="#course-resources"
                  className="owned-panel__resources"
                  data-testid="jump-to-resources"
                >
                  <FileIcon />
                  コース資料 {resources.length} 件をまとめて見る
                </a>
              )}
            </div>
          ) : (
            <>
          {query.canceled === "1" && (
            <p className="notice notice--error" data-testid="checkout-canceled" role="status">
              <LockIcon />
              <span>
                決済がキャンセルされました。購入は完了していません。改めて購入する場合は、もう一度購入手続きへお進みください。
              </span>
            </p>
          )}
          {query.checkout === "unavailable" && (
            <p className="notice notice--error" data-testid="checkout-unavailable" role="status">
              <LockIcon />
              <span>このコースは現在カード決済に対応していません。</span>
            </p>
          )}
          {query.checkout === "error" && (
            <p className="notice notice--error" data-testid="checkout-error" role="status">
              <LockIcon />
              <span>
                決済の準備中にエラーが発生しました。時間をおいてもう一度お試しください。
              </span>
            </p>
          )}
          {query.checkout === "invalid" && (
            <p className="notice notice--error" data-testid="checkout-invalid" role="status">
              <LockIcon />
              <span>購入の対象が指定されていません。コースを選び直してください。</span>
            </p>
          )}
          <div className="buy-card__price" data-testid="course-price">
            {formatPrice(course.priceJpy)}
          </div>
          <p className="buy-card__price-note">税込・買い切り／追加課金なし</p>

          <div className="buy-card__actions">
            {user ? (
              <>
                {/* A plain form POST to the checkout route: no client JS, the
                    route creates the Stripe Checkout session and redirects to
                    the hosted payment page. */}
                <form action="/api/checkout" method="post">
                  <input type="hidden" name="courseId" value={course.id} />
                  <button
                    type="submit"
                    className="btn btn--primary btn--block"
                    data-testid="buy-button"
                  >
                    購入手続きへ
                  </button>
                </form>
                <p className="buy-card__hint">
                  クレジットカード決済（Stripe）・買い切りで無期限視聴
                </p>
              </>
            ) : (
              <>
                <Link
                  href={`/signup?next=${encodeURIComponent(`/courses/${course.id}`)}`}
                  className="btn btn--primary btn--block"
                  data-testid="buy-button"
                >
                  アカウントを作成して購入
                </Link>
                <p className="buy-card__hint">
                  すでにアカウントをお持ちの方は{" "}
                  <Link
                    href={`/login?next=${encodeURIComponent(`/courses/${course.id}`)}`}
                  >
                    ログイン
                  </Link>
                </p>
              </>
            )}
          </div>
            </>
          )}

          <dl className="buy-card__facts">
            <div className="buy-card__fact">
              <dt>チャプター</dt>
              <dd>{course.chapters.length} 本</dd>
            </div>
            <div className="buy-card__fact">
              <dt>レベル</dt>
              <dd>{LEVEL_LABEL[course.level]}</dd>
            </div>
            <div className="buy-card__fact">
              <dt>視聴期間</dt>
              <dd>無期限</dd>
            </div>
            <div className="buy-card__fact">
              <dt>講師</dt>
              <dd>{course.instructorName}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function FileIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z" />
      <path d="M9 1.5V5.5H13" />
    </svg>
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
      style={{ flex: "none" }}
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none", marginTop: "2px" }}
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M6.6 5.4 10.6 8l-4 2.6V5.4Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      style={{ flex: "none", marginTop: "2px" }}
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
