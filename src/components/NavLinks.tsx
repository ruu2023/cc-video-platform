"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "ホーム", primary: false },
  { href: "/courses", label: "コース一覧", primary: true },
];

/** `showAdmin` / `signedIn` are decided on the server from the session. */
export function NavLinks({
  showAdmin = false,
  signedIn = false,
}: {
  showAdmin?: boolean;
  signedIn?: boolean;
}) {
  const pathname = usePathname();
  // Below 640px only the `primary` link stays visible, so for a signed-in
  // creator the admin entry takes that slot instead of the course list.
  const links = showAdmin
    ? [
        ...LINKS.map((link) => ({ ...link, primary: false })),
        { href: "/mypage", label: "マイページ", primary: false },
        { href: "/admin", label: "管理画面", primary: true },
      ]
    : signedIn
      ? [
          ...LINKS.map((link) => ({ ...link, primary: false })),
          { href: "/mypage", label: "マイページ", primary: true },
        ]
      : LINKS;

  return (
    <nav className="site-nav" aria-label="メインナビゲーション">
      {links.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            data-active={active}
            data-primary={link.primary}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
