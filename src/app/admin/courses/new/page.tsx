import type { Metadata } from "next";
import Link from "next/link";
import { requireCreator } from "@/lib/admin-guard";
import { CourseForm } from "@/components/admin/CourseForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "新しいコース" };

export default async function NewCoursePage() {
  const user = await requireCreator("/admin/courses/new");

  return (
    <section className="container admin-page">
      <nav className="breadcrumb" aria-label="パンくずリスト">
        <Link href="/admin">コース</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">新しいコース</span>
      </nav>

      <header className="admin-head">
        <div>
          <h1 className="display-lg">新しいコース</h1>
          <p className="section-head__sub">
            まずコースの器を作ります。チャプターと付属資料は作成後の編集画面から
            追加できます。
          </p>
        </div>
      </header>

      <div className="admin-panel">
        <CourseForm mode="create" defaultInstructorName={user.name} />
      </div>
    </section>
  );
}
