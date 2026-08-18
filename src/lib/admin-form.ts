import type { CourseLevel } from "@/lib/course-types";

/** Result shape shared by every admin server action. */
export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors: Record<string, string>;
  /**
   * The text values that were submitted. Returned on failure so the client
   * form can re-render what the user typed instead of falling back to its
   * `defaultValue` (which would wipe the whole form).
   */
  values: Record<string, string>;
};

export const IDLE_STATE: ActionState = {
  status: "idle",
  message: "",
  fieldErrors: {},
  values: {},
};

export function successState(message: string): ActionState {
  return { status: "success", message, fieldErrors: {}, values: {} };
}

/**
 * Collects every text entry of a submitted form. File entries are skipped —
 * they cannot be replayed into a file input anyway, and serialising them
 * across the action boundary would be wasteful.
 */
export function formValues(formData?: FormData | null): Record<string, string> {
  const values: Record<string, string> = {};
  if (!formData) return values;
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

export function errorState(
  message: string,
  fieldErrors: Record<string, string> = {},
  values: Record<string, string> | FormData | null = null
): ActionState {
  return {
    status: "error",
    message,
    fieldErrors,
    values:
      values instanceof FormData
        ? formValues(values)
        : (values ?? {}),
  };
}

export const LEVELS: CourseLevel[] = ["beginner", "intermediate", "advanced"];

export const COURSE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export const LIMITS = {
  title: 120,
  subtitle: 140,
  description: 8000,
  instructorName: 60,
  instructorTitle: 80,
  chapterTitle: 120,
  resourceLabel: 80,
  priceJpy: 1_000_000,
} as const;
