import Link from "next/link";
import { getCurrentUser } from "@/lib/session";

export async function SiteFooter() {
  const user = await getCurrentUser();

  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div>
          <div className="wordmark" aria-hidden="true">
            Kouza<span className="wordmark__dot">.</span>
          </div>
          <p className="caption" style={{ marginTop: "var(--space-xs)" }}>
            買い切りの動画講座プラットフォーム
          </p>
        </div>
        <div className="site-footer__links">
          <Link href="/">ホーム</Link>
          <Link href="/courses">コース一覧</Link>
          {!user && (
            <>
              <Link href="/login">ログイン</Link>
              <Link href="/signup">アカウント作成</Link>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
