import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "アカウント作成",
  description: "メールアドレスとパスワードで Kouza のアカウントを作成します。",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const next =
    query.next && query.next.startsWith("/") && !query.next.startsWith("//")
      ? query.next
      : undefined;

  if (user) {
    redirect(next ?? (user.role === "creator" ? "/admin" : "/courses"));
  }

  return <AuthForm mode="signup" next={next} />;
}
