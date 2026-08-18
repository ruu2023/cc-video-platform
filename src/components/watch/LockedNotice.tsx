import Link from "next/link";
import { formatPrice, type CourseDetail } from "@/lib/course-types";

/**
 * What a signed-in visitor without an entitlement gets instead of the player.
 *
 * Deliberately contains no <video>, no stream URL and no token — the page never
 * mints one for an unentitled user, so there is nothing on the screen (or in
 * the HTML source) that could be pointed at the video bytes.
 */
export function LockedNotice({
  course,
  chapterTitle,
}: {
  course: CourseDetail;
  chapterTitle: string;
}) {
  return (
    <div className="container watch-locked">
      <nav className="breadcrumb" aria-label="パンくずリスト">
        <Link href="/courses">コース一覧</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/courses/${course.id}`}>{course.title}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">視聴できません</span>
      </nav>

      <div className="locked-card" data-testid="watch-locked">
        <span className="locked-card__icon" aria-hidden="true">
          <LockIcon />
        </span>
        <h1 className="display-md">このチャプターはまだ視聴できません</h1>
        <p className="locked-card__lead">
          「{chapterTitle}」は <strong>{course.title}</strong> の購入者限定コンテンツです。
          動画はトークン認証で保護されており、購入済みのアカウントからのみ再生できます。
        </p>

        <dl className="locked-card__facts">
          <div>
            <dt>コース</dt>
            <dd>{course.title}</dd>
          </div>
          <div>
            <dt>価格</dt>
            <dd>{formatPrice(course.priceJpy)}</dd>
          </div>
          <div>
            <dt>チャプター数</dt>
            <dd>{course.chapters.length} 本</dd>
          </div>
        </dl>

        <div className="locked-card__actions">
          <Link href={`/courses/${course.id}`} className="btn btn--primary">
            コース詳細を見る
          </Link>
          <Link href="/courses" className="btn btn--secondary">
            コース一覧へ
          </Link>
        </div>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
