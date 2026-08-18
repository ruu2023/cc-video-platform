/**
 * Course shapes and presentation helpers that are safe on both sides of the
 * network boundary.
 *
 * `src/lib/courses.ts` opens a libSQL connection at module scope, so anything a
 * client component needs (level labels, price formatting, the types) lives here
 * instead — importing it from a "use client" file must never drag the database
 * driver into the browser bundle.
 */

export type CourseLevel = "beginner" | "intermediate" | "advanced";

export type Course = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnailUrl: string;
  priceJpy: number;
  instructorName: string;
  instructorTitle: string;
  level: CourseLevel;
  chapterCount: number;
};

export type Chapter = {
  id: string;
  position: number;
  title: string;
  /** Attachments registered in the admin area; the files stay purchase-gated. */
  resourceCount: number;
  /** Runtime of the chapter video in seconds; 0 when not known yet. */
  durationSeconds: number;
};

export type CourseDetail = Course & { chapters: Chapter[] };

export const LEVEL_LABEL: Record<CourseLevel, string> = {
  beginner: "入門",
  intermediate: "中級",
  advanced: "上級",
};

const jpy = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

export function formatPrice(priceJpy: number): string {
  return jpy.format(priceJpy);
}
