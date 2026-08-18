import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import { SignOutButton } from "@/components/SignOutButton";
import { getCurrentUser } from "@/lib/session";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="wordmark" aria-label="Kouza ホーム">
          Kouza<span className="wordmark__dot">.</span>
        </Link>

        <NavLinks
          showAdmin={user?.role === "creator"}
          signedIn={Boolean(user)}
        />

        <div className="site-header__spacer" />

        {user ? (
          <div className="site-header__account">
            <span className="account-email" data-testid="account-email">
              <span className="avatar" aria-hidden="true">
                {user.email.charAt(0)}
              </span>
              <span className="account-email__label">{user.email}</span>
            </span>
            <SignOutButton />
          </div>
        ) : (
          <div className="site-header__account">
            <Link href="/login" className="btn btn--text">
              ログイン
            </Link>
            <Link href="/signup" className="btn btn--primary">
              アカウント作成
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
