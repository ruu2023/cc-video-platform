import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getPublishedCourse, formatPrice } from "@/lib/courses";
import { getCurrentUser } from "@/lib/session";
import { grantPurchase } from "@/lib/entitlements";
import {
  PurchaseVerificationError,
  verifyCheckoutSession,
} from "@/lib/stripe";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "購入完了",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session_id?: string }>;
};

/**
 * Where Stripe drops the customer off after a completed payment.
 *
 * No webhook exists in this deployment, so this page is the moment the
 * purchase is recorded: the session id from the URL is verified against the
 * Stripe API (paid, right user, right course) and only then granted. The
 * grant itself is idempotent on (user, course), so refreshing this page or
 * replaying a session id cannot double-write.
 */
export default async function PurchaseSuccessPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const [course, user] = await Promise.all([
    getPublishedCourse(id),
    getCurrentUser(),
  ]);
  if (!course) notFound();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/courses/${id}`)}`);

  const sessionId = (query.session_id ?? "").trim();

  let failure: PurchaseVerificationError | null = null;
  if (!sessionId) {
    failure = new PurchaseVerificationError(
      "決済セッションが指定されていません。",
      "not-found"
    );
  } else {
    try {
      const verified = await verifyCheckoutSession(sessionId, {
        userId: user.id,
        courseId: course.id,
      });

      // Idempotent upsert — the same session arriving twice (refresh, shared
      // link) updates the same row instead of creating a second entitlement.
      await grantPurchase({
        userId: verified.userId,
        courseId: verified.courseId,
        amountJpy: verified.amountJpy || course.priceJpy,
        provider: "stripe",
        providerRef: verified.sessionId,
      });
    } catch (error) {
      if (error instanceof PurchaseVerificationError) {
        failure = error;
      } else {
        console.error("purchase success: recording failed", error);
        failure = new PurchaseVerificationError(
          "購入の記録に失敗しました。サポートまでお問い合わせください。",
          "not-found"
        );
      }
    }
  }

  const firstChapter = course.chapters[0] ?? null;

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="パンくずリスト">
        <Link href="/">ホーム</Link>
        <span aria-hidden="true">/</span>
        <Link href="/courses">コース一覧</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/courses/${course.id}`}>{course.title}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">購入完了</span>
      </nav>

      {failure ? (
        <section className="result-panel" data-testid="purchase-failed">
          <span className="result-panel__mark result-panel__mark--error" aria-hidden="true">
            !
          </span>
          <h1 className="display-sm result-panel__title">購入を確認できませんでした</h1>
          <p className="result-panel__message">{failure.message}</p>
          <p className="result-panel__message result-panel__message--muted">
            決済が完了している場合は、まったく同じURLに再アクセスしてもう一度お試しください。
            決済が完了していない場合は、コースページから再度購入手続きを行ってください。
          </p>
          <div className="result-panel__actions">
            <Link
              href={`/courses/${course.id}`}
              className="btn btn--secondary"
              data-testid="back-to-course"
            >
              コースページに戻る
            </Link>
            <Link href="/courses" className="btn btn--text">
              コース一覧へ
            </Link>
          </div>
        </section>
      ) : (
        <section className="result-panel" data-testid="purchase-success">
          <span className="result-panel__mark result-panel__mark--success" aria-hidden="true">
            ✓
          </span>
          <h1 className="display-sm result-panel__title">購入が完了しました！</h1>
          <p className="result-panel__message">
            ありがとうございました。以下のコースは無期限で視聴できます。
          </p>

          <div className="result-panel__course">
            <Image
              src={course.thumbnailUrl}
              unoptimized
              alt={`${course.title} のサムネイル`}
              width={320}
              height={180}
              className="result-panel__course-image"
            />
            <div className="result-panel__course-body">
              <div className="title-sm">{course.title}</div>
              <div className="caption">
                {course.chapters.length} チャプター ／ 支払い金額 {formatPrice(course.priceJpy)}
              </div>
            </div>
          </div>

          <div className="result-panel__actions">
            {firstChapter && (
              <Link
                href={`/courses/${course.id}/watch/${firstChapter.id}`}
                className="btn btn--primary"
                data-testid="start-watching"
              >
                視聴をはじめる
              </Link>
            )}
            <Link href={`/courses/${course.id}`} className="btn btn--secondary">
              コースページを開く
            </Link>
            <Link href="/mypage" className="btn btn--text" data-testid="goto-mypage">
              マイページで購入履歴を見る
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
