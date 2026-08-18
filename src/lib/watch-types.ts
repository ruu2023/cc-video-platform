/**
 * Viewing-progress shapes plus the pure helpers that both the server pages and
 * the (client-side) player need.
 *
 * Kept free of any database import on purpose: `src/lib/progress.ts` opens a
 * libSQL connection at module scope, and a "use client" file must never drag
 * that into the browser bundle.
 */

/** A chapter counts as watched once this much of it has been played. */
export const COMPLETION_RATIO = 0.95;

/** Playback position is persisted at most this often while playing. */
export const PROGRESS_SAVE_INTERVAL_MS = 5000;

/**
 * Resuming this close to the end restarts the chapter instead — nobody wants to
 * reopen a lesson only to land on its final second.
 */
export const RESUME_TAIL_MARGIN_SECONDS = 3;

export type ChapterProgress = {
  chapterId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  completedAt: string | null;
};

export type CourseProgress = {
  courseId: string;
  totalChapters: number;
  completedChapters: number;
  /** 0–100, rounded. 100 only when every chapter is complete. */
  percent: number;
  byChapter: Record<string, ChapterProgress>;
};

export function emptyChapterProgress(chapterId: string): ChapterProgress {
  return {
    chapterId,
    positionSeconds: 0,
    durationSeconds: 0,
    completed: false,
    completedAt: null,
  };
}

/**
 * Percentage of a course that is complete.
 *
 * Rounding is clamped so a course is only ever shown as 100% when literally
 * every chapter is done (and never as 0% once at least one is).
 */
export function completionPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  if (completed >= total) return 100;
  if (completed <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round((completed / total) * 100)));
}

/** Where playback should start when the chapter is reopened. */
export function resumePosition(progress: ChapterProgress, durationSeconds: number): number {
  if (progress.completed) return 0;
  const duration = durationSeconds > 0 ? durationSeconds : progress.durationSeconds;
  const position = progress.positionSeconds;

  if (!Number.isFinite(position) || position <= 1) return 0;
  if (duration > 0 && position >= duration - RESUME_TAIL_MARGIN_SECONDS) return 0;
  return position;
}

/** True when `position` is far enough into `duration` to count as watched. */
export function reachedCompletion(position: number, duration: number): boolean {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
    return false;
  }
  return position >= duration * COMPLETION_RATIO;
}

/** "12:34" / "1:02:03" — used for positions and remaining token lifetime alike. */
export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return hours > 0
    ? `${hours}:${mm}:${String(seconds).padStart(2, "0")}`
    : `${mm}:${String(seconds).padStart(2, "0")}`;
}
