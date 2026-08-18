import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export type UserRole = "creator" | "viewer";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

/** Anything that is not exactly "creator" is treated as an ordinary viewer. */
function toRole(value: unknown): UserRole {
  return value === "creator" ? "creator" : "viewer";
}

/**
 * Resolves the signed-in user for the current request, or null when nobody is
 * signed in. Never throws: a broken session must not take a public page down.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? session.user.email,
      role: toRole((session.user as { role?: unknown }).role),
    };
  } catch (error) {
    // Next.js signals control flow (redirects, dynamic-rendering bailouts)
    // through thrown errors carrying a `digest`. Swallowing those would break
    // the framework, so only genuine failures are downgraded to "signed out".
    if (typeof (error as { digest?: unknown })?.digest === "string") {
      throw error;
    }
    console.error("getCurrentUser failed", error);
    return null;
  }
}

export function isCreator(user: CurrentUser | null): boolean {
  return user?.role === "creator";
}
