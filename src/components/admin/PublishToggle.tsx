"use client";

import { useActionState } from "react";
import { togglePublishAction } from "@/app/admin/actions";
import { IDLE_STATE } from "@/lib/admin-form";

/**
 * One-click publish / unpublish. The button always states the action it will
 * perform, and `data-published` exposes the current state for tests.
 */
export function PublishToggle({
  courseId,
  published,
  title,
}: {
  courseId: string;
  published: boolean;
  title: string;
}) {
  const [state, formAction, pending] = useActionState(
    togglePublishAction,
    IDLE_STATE
  );

  return (
    <form action={formAction} className="publish-toggle">
      <input type="hidden" name="id" value={courseId} />
      <input type="hidden" name="published" value={published ? "0" : "1"} />
      <button
        type="submit"
        className={`btn btn--secondary btn--sm ${published ? "" : "btn--go-live"}`}
        disabled={pending}
        data-published={published ? "true" : "false"}
        data-testid={`publish-toggle-${courseId}`}
        aria-label={`${title} を${published ? "非公開にする" : "公開する"}`}
      >
        {pending ? "更新中…" : published ? "非公開にする" : "公開する"}
      </button>
      {state.status === "error" && (
        <span className="publish-toggle__error" role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}
