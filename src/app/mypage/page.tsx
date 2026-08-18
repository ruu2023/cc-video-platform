import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listMyCourses, formatPurchaseDate } from "@/lib/my-courses";
import { getCourseProgress } from "@/lib/progress";
import { LEVEL_LABEL } from "@/lib/course-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "マイページ",
  description: "購入済みコースの一覧と視聴進捗。",
};

/**
 * The learner's library: every course this account owns, with progress and a
 * straight path back into playback. Draft/withdrawn courses the account still
 * holds an entitlement for are shown too — a purchase must never silently
 * disappear from the buyer's history.
 */
export default async function MyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/mypage");

  const courses = await listMyCourses(user.id);

  const withProgress = await Promise.all(
    courses.map(async (course) => ({
      course,
      progress: await getCourseProgress(user.id, course.courseId),
    }))
  );

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="パンくずリスト">
        <Link href="/">ホーム</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">マイページ</span>
      </nav>

      <header className="mypage-header">
        <h1 className="display-lg">マイページ</h1>
        <p className="mypage-header__sub">
          {user.name} さん — 購入したコースは無期限で視聴できます。
        </p>
      </header>

      {courses.length === 0 ? (
        <section className="result-panel" data-testid="mypage-empty">
          <span className="result-panel__mark" aria-hidden="true">
            📚
          </span>
          <h2 className="display-sm result-panel__title">
            まだ購入したコースはありません
          </h2>
          <p className="result-panel__message">
            コース一覧から気になる講座を見つけてください。購入するとここに表示されます。
          </p>
          <div className="result-panel__actions">
            <Link href="/courses" className="btn btn--primary">
              コース一覧へ
            </Link>
          </div>
        </section>
      ) : (
        <section aria-label="購入済みコース一覧">
          <h2 className="mypage-section-title">
            購入済みコース
            <span className="mypage-section-title__count" data-testid="mypage-count">
              {courses.length} コース
            </span>
          </h2>

          <ul className="mypage-list" data-testid="mypage-list">
            {withProgress.map(({ course, progress }) => (
              <li
                key={course.courseId}
                className="mypage-card"
                data-testid={`mypage-course-${course.courseId}`}
              >
                <Link
                  href={`/courses/${course.courseId}`}
                  className="mypage-card__media"
                  aria-label={`${course.title} を開く`}
                >
                  <Image
                    src={course.thumbnailUrl}
                    unoptimized
                    alt={`${course.title} のサムネイル`}
                    width={480}
                    height={270}
                  />
                </Link>

                <div className="mypage-card__body">
                  <div className="mypage-card__meta">
                    <span className="badge badge--owned">購入済み</span>
                    <span className={`badge badge--${course.level}`}>
                      {LEVEL_LABEL[course.level as keyof typeof LEVEL_LABEL] ?? course.level}
                    </span>
                  </div>

                  <h3 className="mypage-card__title">
                    <Link href={`/courses/${course.courseId}`}>{course.title}</Link>
                  </h3>
                  <p className="mypage-card__subtitle">{course.subtitle}</p>

                  <div
                    className="progress-track mypage-card__progress"
                    role="progressbar"
                    aria-valuenow={progress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${course.title} の視聴進捗`}
                    data-testid={`mypage-progress-${course.courseId}`}
                  >
                    <span
                      className="progress-track__fill"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                  <p className="mypage-card__progress-label">
                    視聴進捗 {progress.percent}%（{progress.completedChapters} / {progress.totalChapters} チャプター）
                  </p>
                </div>

                <div className="mypage-card__side">
                  <Link
                    href={`/courses/${course.courseId}`}
                    className="btn btn--primary btn--block"
                    data-testid={`mypage-watch-${course.courseId}`}
                  >
                    {progress.percent > 0 && progress.percent < 100
                      ? "続きから視聴"
                      : progress.percent === 100
                        ? "もう一度視聴"
                        : "視聴する"}
                  </Link>
                  <p className="mypage-card__date" data-testid={`mypage-date-${course.courseId}`}>
                    購入日 {formatPurchaseDate(course.purchasedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
