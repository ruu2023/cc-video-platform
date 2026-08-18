import type { Metadata } from "next";
import Link from "next/link";
import { requireCreator } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "管理画面",
    template: "%s | 管理画面 | Kouza",
  },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // First gate: anyone who is not the creator never sees the admin shell.
  // Each page and every server action re-checks independently.
  const user = await requireCreator();

  return (
    <div className="admin">
      <div className="admin-bar">
        <div className="container admin-bar__inner">
          <Link href="/admin" className="admin-bar__brand">
            <span className="eyebrow">クリエイター管理</span>
            <span className="admin-bar__title">コンテンツ管理</span>
          </Link>
          <nav className="admin-bar__nav" aria-label="管理ナビゲーション">
            <Link href="/admin">コース一覧</Link>
            <Link href="/admin/courses/new">新規コース</Link>
            <Link href="/courses">公開サイトを見る</Link>
          </nav>
          <span className="admin-bar__user" data-testid="admin-user">
            {user.name} · クリエイター権限
          </span>
        </div>
      </div>

      {children}
    </div>
  );
}
