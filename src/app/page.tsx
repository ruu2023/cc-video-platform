import Link from "next/link";
import { CourseCard } from "@/components/CourseCard";
import { listPublishedCourses } from "@/lib/courses";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [courses, user] = await Promise.all([
    listPublishedCourses(),
    getCurrentUser(),
  ]);

  const featured = courses.slice(0, 3);
  const totalChapters = courses.reduce((sum, c) => sum + c.chapterCount, 0);

  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="eyebrow hero__eyebrow">買い切り · 無期限視聴</p>
          <h1 className="display-mega">
            現場で使える技術を、
            <br />
            腰を据えて学ぶ。
          </h1>
          <p className="hero__lede">
            {user ? `${user.name} さん、おかえりなさい。` : ""}
            Kouza
            は作り手本人が制作した動画講座を買い切りで販売するプラットフォームです。一度購入すれば期限はなく、何度でも見返せます。
          </p>
          <div className="hero__actions">
            <Link href="/courses" className="btn btn--ink">
              コースを見る
            </Link>
            {!user && (
              <Link href="/signup" className="btn btn--text">
                アカウントを作成 →
              </Link>
            )}
          </div>

          <dl className="hero__stats">
            <div className="stat">
              <dd className="stat__value">{courses.length}</dd>
              <dt className="stat__label">公開中のコース</dt>
            </div>
            <div className="stat">
              <dd className="stat__value">{totalChapters}</dd>
              <dt className="stat__label">収録チャプター</dt>
            </div>
            <div className="stat">
              <dd className="stat__value">無期限</dd>
              <dt className="stat__label">購入後の視聴期間</dt>
            </div>
          </dl>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="section-head__text">
              <p className="eyebrow">おすすめコース</p>
              <h2 className="display-lg" style={{ marginTop: "var(--space-xs)" }}>
                いま学ばれているもの
              </h2>
            </div>
            <Link href="/courses" className="btn btn--secondary">
              すべて見る
            </Link>
          </div>

          <div className="course-grid">
            {featured.map((course, index) => (
              <CourseCard key={course.id} course={course} priority={index < 3} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
