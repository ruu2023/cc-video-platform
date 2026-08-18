import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container">
      <div className="not-found">
        <p className="not-found__code">404 — NOT FOUND</p>
        <h1 className="display-lg">ページが見つかりませんでした</h1>
        <p className="body-md">
          お探しのページは移動または削除された可能性があります。
        </p>
        <div className="not-found__actions">
          <Link href="/" className="btn btn--primary">
            ホームへ戻る
          </Link>
          <Link href="/courses" className="btn btn--secondary">
            コース一覧へ
          </Link>
        </div>
      </div>
    </div>
  );
}
