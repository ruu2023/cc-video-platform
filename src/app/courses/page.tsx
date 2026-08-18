import type { Metadata } from "next";
import { CourseCard } from "@/components/CourseCard";
import { listPublishedCourses } from "@/lib/courses";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "コース一覧",
  description: "公開中の動画講座の一覧です。すべて買い切り・無期限視聴。",
};

export default async function CoursesPage() {
  const courses = await listPublishedCourses();

  return (
    <section className="section--tight" style={{ paddingBlock: "var(--space-xxl)" }}>
      <div className="container">
        <div className="section-head">
          <div className="section-head__text">
            <p className="eyebrow">コース一覧</p>
            <h1 className="display-lg" style={{ marginTop: "var(--space-xs)" }}>
              公開中のコース
            </h1>
            <p className="section-head__sub">
              すべて買い切り。購入後は無期限で視聴できます。購入前は説明文とサムネイルのみ公開しています。
            </p>
          </div>
          <p className="section-head__count" data-testid="course-count">
            {courses.length} 件
          </p>
        </div>

        {courses.length === 0 ? (
          <p className="body-md">現在公開中のコースはありません。</p>
        ) : (
          <div className="course-grid" data-testid="course-grid">
            {courses.map((course, index) => (
              <CourseCard key={course.id} course={course} priority={index < 3} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
