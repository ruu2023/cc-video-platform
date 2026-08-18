"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } catch {
      // Even if the network call fails the safest thing for the user is to end
      // up on a freshly-rendered page reflecting the real session state.
    } finally {
      startTransition(() => {
        router.replace("/");
        router.refresh();
      });
      setSigningOut(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn--secondary"
      onClick={handleSignOut}
      disabled={signingOut || pending}
    >
      {signingOut || pending ? "ログアウト中…" : "ログアウト"}
    </button>
  );
}
