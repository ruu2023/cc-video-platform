import { redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/session";

/**
 * Gate for every admin page and every admin server action.
 *
 * - signed out  → the login screen, which returns here afterwards
 * - viewer      → an explicit "access denied" screen (never the admin UI)
 * - creator     → the user record, for auditing/labelling
 *
 * Server actions must call this too: a page-level check alone would leave the
 * mutations reachable by anyone who can POST an action id.
 */
export async function requireCreator(next = "/admin"): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (user.role !== "creator") {
    redirect("/access-denied");
  }

  return user;
}

/**
 * The same gate for JSON API routes (e.g. the chapter video upload endpoint).
 * A redirect is useless to a fetch() caller, so this returns a status code
 * instead: 401 for no session, 403 for a signed-in non-creator. A viewer
 * therefore cannot reach the Bunny Stream credentials by posting to the API
 * directly, any more than through the admin screens.
 */
export async function requireCreatorApi(): Promise<
  { ok: true; user: CurrentUser } | { ok: false; status: 401 | 403 }
> {
  const user = await getCurrentUser();

  if (!user) return { ok: false, status: 401 };
  if (user.role !== "creator") return { ok: false, status: 403 };
  return { ok: true, user };
}
