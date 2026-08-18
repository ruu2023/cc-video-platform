import Link from "next/link";
import Image from "next/image";
import { requireCreator } from "@/lib/admin-guard";
import { listAllCourses } from "@/lib/admin-courses";
import { formatPrice, LEVEL_LABEL } from "@/lib/courses";
import { assetsHostname, signedAssetsUrl } from "@/lib/bunny";
import { PublishToggle } from "@/components/admin/PublishToggle";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await requireCreator();
  const courses = await listAllCourses();

  const assetsHost = assetsHostname();
  const isCdnThumbnail = (url: string): boolean =>
    Boolean(assetsHost) && url.startsWith(`https://${assetsHost}/`);

  const published = courses.filter((course) => course.published);
  const drafts = courses.filter((course) => !course.published);
  const chapters = courses.reduce((sum, course) => sum + course.chapterCount, 0);
  const resources = courses.reduce((sum, course) => sum + course.resourceCount, 0);

  return (
    <section className="container admin-page">
      <header className="admin-head">
        <div>
          <h1 className="display-lg">コース</h1>
          <p className="section-head__sub">
            公開中のコースは受講者向けの一覧に即時反映されます。非公開のコースは
            あなただけが見られます。
          </p>
        </div>
        <Link href="/admin/courses/new" className="btn btn--primary" data-testid="new-course-link">
          新しいコースを作成
        </Link>
      </header>

      <dl className="admin-stats" data-testid="admin-stats">
        <div className="admin-stat">
          <dt>公開中</dt>
          <dd data-testid="stat-published">{published.length}</dd>
        </div>
        <div className="admin-stat">
          <dt>非公開</dt>
          <dd data-testid="stat-drafts">{drafts.length}</dd>
        </div>
        <div className="admin-stat">
          <dt>チャプター</dt>
          <dd>{chapters}</dd>
        </div>
        <div className="admin-stat">
          <dt>付属資料</dt>
          <dd>{resources}</dd>
        </div>
      </dl>

      {courses.length === 0 ? (
        <p className="empty-note">
          まだコースがありません。「新しいコースを作成」から始めてください。
        </p>
      ) : (
        <ul className="admin-course-list" data-testid="admin-course-list">
          {courses.map((course) => (
            <li
              key={course.id}
              className="admin-course"
              data-testid={`admin-course-${course.id}`}
              data-published={course.published ? "true" : "false"}
            >
              <span className="admin-course__thumb">
                <Image
                  src={
                    isCdnThumbnail(course.thumbnailUrl)
                      ? signedAssetsUrl(course.thumbnailUrl)
                      : course.thumbnailUrl
                  }
                  alt=""
                  width={160}
                  height={90}
                  unoptimized={
                    course.thumbnailUrl.endsWith(".svg") ||
                    isCdnThumbnail(course.thumbnailUrl)
                  }
                />
              </span>

              <div className="admin-course__text">
                <div className="admin-course__title-row">
                  <Link
                    href={`/admin/courses/${course.id}`}
                    className="admin-course__title"
                  >
                    {course.title}
                  </Link>
                  <span
                    className={`status-pill status-pill--${course.published ? "live" : "draft"}`}
                    data-testid={`status-${course.id}`}
                  >
                    {course.published ? "公開中" : "非公開"}
                  </span>
                </div>
                <p className="admin-course__subtitle">
                  {course.subtitle || "サブタイトル未設定"}
                </p>
                <p className="admin-course__meta">
                  <code>{course.id}</code>
                  <span aria-hidden="true">·</span>
                  <span>{LEVEL_LABEL[course.level]}</span>
                  <span aria-hidden="true">·</span>
                  <span>{course.chapterCount} チャプター</span>
                  <span aria-hidden="true">·</span>
                  <span>資料 {course.resourceCount} 件</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatPrice(course.priceJpy)}</span>
                </p>
              </div>

              <div className="admin-course__actions">
                <PublishToggle
                  courseId={course.id}
                  published={course.published}
                  title={course.title}
                />
                <Link
                  href={`/admin/courses/${course.id}`}
                  className="btn btn--secondary btn--sm"
                  data-testid={`edit-course-${course.id}`}
                >
                  編集
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
