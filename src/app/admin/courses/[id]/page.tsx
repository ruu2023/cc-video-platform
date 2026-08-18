import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCreator } from "@/lib/admin-guard";
import { getAdminCourse } from "@/lib/admin-courses";
import { CourseForm } from "@/components/admin/CourseForm";
import { ChapterBoard, type BunnyStatusInfo } from "@/components/admin/ChapterBoard";
import { AccessPanel } from "@/components/admin/AccessPanel";
import { listAccounts, listPurchasers } from "@/lib/entitlements";
import { getCourseProgress } from "@/lib/progress";
import {
  bunnyStatusLabel,
  getBunnyVideo,
  signedAssetsUrl,
  signedStreamPlaybackUrl,
} from "@/lib/bunny";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const course = await getAdminCourse(id);
  return { title: course ? `${course.title} を編集` : "コースが見つかりません" };
}

export default async function EditCoursePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  await requireCreator(`/admin/courses/${id}`);

  const [course, query] = await Promise.all([getAdminCourse(id), searchParams]);
  if (!course) notFound();

  /*
   * bunny.net know-how per chapter: encode status, title and a short-lived
   * signed preview thumbnail from the Stream CDN (the thumbnails sit behind the
   * same token authentication as the media). GUIDs bunny does not know — e.g.
   * the pre-account demo ids in the seeded catalogue — surface as 未確認 and
   * playback falls back to the local clip.
   */
  const bunnyStatuses: Record<string, BunnyStatusInfo> = {};

  // Bunny lookups and the entitlement roster depend only on `course`, not on
  // each other, so both run together instead of one after the other.
  const [, [purchasers, accounts]] = await Promise.all([
    Promise.all(
      course.chapters
        .filter((chapter) => chapter.bunnyVideoId.trim() !== "")
        .map(async (chapter) => {
          try {
            const video = await getBunnyVideo(chapter.bunnyVideoId);
            bunnyStatuses[chapter.id] = {
              status: video ? video.status : null,
              statusLabel: video ? bunnyStatusLabel(video.status) : "ID未確認",
              title: video ? video.title : null,
              thumbnailUrl: video
                ? signedStreamPlaybackUrl(
                    chapter.bunnyVideoId,
                    30 * 60,
                    "thumbnail.jpg"
                  ).url
                : null,
            };
          } catch (error) {
            console.error(
              `admin course page: bunny lookup failed for ${chapter.id}`,
              error
            );
            bunnyStatuses[chapter.id] = {
              status: null,
              statusLabel: "ID未確認",
              title: null,
              thumbnailUrl: null,
            };
          }
        })
    ),
    // Entitlement roster for the (provisional) access panel, enriched with
    // each learner's completion count so the creator can see who is actually
    // watching.
    Promise.all([listPurchasers(course.id), listAccounts()]),
  ]);

  const purchaserRows = await Promise.all(
    purchasers.map(async (purchaser) => {
      const progress = await getCourseProgress(purchaser.userId, course.id);
      return {
        userId: purchaser.userId,
        userEmail: purchaser.userEmail,
        userName: purchaser.userName,
        provider: purchaser.provider,
        purchasedAt: purchaser.purchasedAt,
        completedChapters: progress.completedChapters,
        totalChapters: progress.totalChapters,
      };
    })
  );

  return (
    <section className="container admin-page">
      <nav className="breadcrumb" aria-label="パンくずリスト">
        <Link href="/admin">コース</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{course.title}</span>
      </nav>

      <header className="admin-head">
        <div>
          <div className="admin-head__badges">
            <span
              className={`status-pill status-pill--${course.published ? "live" : "draft"}`}
              data-testid="course-status"
            >
              {course.published ? "公開中" : "非公開"}
            </span>
            <code className="admin-head__id">{course.id}</code>
          </div>
          <h1 className="display-lg">{course.title}</h1>
          <p className="section-head__sub">
            最終更新 {course.updatedAt || "—"}
          </p>
        </div>
        <div className="admin-head__actions">
          {course.published ? (
            <Link
              href={`/courses/${course.id}`}
              className="btn btn--secondary"
              data-testid="view-public-page"
            >
              公開ページを見る
            </Link>
          ) : (
            <span className="caption">
              公開すると受講者向けページに表示されます
            </span>
          )}
        </div>
      </header>

      {query?.created === "1" && (
        <p className="form-success" role="status" data-testid="course-created">
          コースを作成しました。続けてチャプターを追加してください。
        </p>
      )}

      <div className="admin-panel">
        <h2 className="display-sm admin-panel__title">コース情報</h2>
        <CourseForm
          mode="edit"
          course={course}
          thumbnailPreviewUrl={signedAssetsUrl(course.thumbnailUrl)}
        />
      </div>

      <div className="admin-panel">
        <ChapterBoard
          courseId={course.id}
          chapters={course.chapters}
          bunnyStatuses={bunnyStatuses}
        />
      </div>

      <div className="admin-panel">
        <AccessPanel
          courseId={course.id}
          courseTitle={course.title}
          purchasers={purchaserRows}
          accounts={accounts}
        />
      </div>
    </section>
  );
}
