import type { ActionState } from "@/lib/admin-form";

/** Success / failure banner shared by every admin form. */
export function ActionMessage({
  state,
  testId,
}: {
  state: ActionState;
  testId?: string;
}) {
  if (state.status === "idle" || !state.message) return null;

  const isError = state.status === "error";

  return (
    <p
      className={isError ? "form-error" : "form-success"}
      role={isError ? "alert" : "status"}
      data-testid={testId ?? (isError ? "admin-error" : "admin-success")}
    >
      {state.message}
    </p>
  );
}

export function FieldError({
  state,
  name,
}: {
  state: ActionState;
  name: string;
}) {
  const message = state.fieldErrors[name];
  if (!message) return null;
  return (
    <span className="field__error" data-testid={`error-${name}`}>
      {message}
    </span>
  );
}
