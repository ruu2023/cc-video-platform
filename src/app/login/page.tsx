import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ログイン",
  description: "Kouza にログインします。",
};

export default async function LoginPage({
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

  return <AuthForm mode="login" next={next} />;
}
