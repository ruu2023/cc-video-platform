import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "アクセス権がありません",
  robots: { index: false, follow: false },
};

/**
 * Where viewers land when they try to open the admin area. It is a normal page
 * rather than a 404 so the person understands *why* they were stopped.
 */
export default async function AccessDeniedPage() {
  const user = await getCurrentUser();

  return (
    <div className="container">
      <div className="not-found" data-testid="access-denied">
        <p className="not-found__code">403 — FORBIDDEN</p>
        <h1 className="display-lg">管理画面へのアクセス権がありません</h1>
        <p className="body-md">
          管理画面はコースを配信するクリエイター専用です。
          {user
            ? `現在 ${user.email} でログインしています。このアカウントは受講者アカウントのため、コースの閲覧・購入のみご利用いただけます。`
            : "ログイン状態を確認できませんでした。"}
        </p>
        <div className="not-found__actions">
          <Link href="/courses" className="btn btn--primary">
            コース一覧へ
          </Link>
          <Link href="/" className="btn btn--secondary">
            ホームへ
          </Link>
        </div>
      </div>
    </div>
  );
}
