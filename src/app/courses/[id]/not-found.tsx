import Link from "next/link";

export default function CourseNotFound() {
  return (
    <div className="container">
      <div className="not-found">
        <p className="not-found__code">404 — NOT FOUND</p>
        <h1 className="display-lg">コースが見つかりませんでした</h1>
        <p className="body-md">
          指定された ID
          のコースは存在しないか、まだ公開されていません。URL をご確認のうえ、
          コース一覧から目的のコースをお探しください。
        </p>
        <div className="not-found__actions">
          <Link href="/courses" className="btn btn--primary">
            コース一覧へ
          </Link>
          <Link href="/" className="btn btn--secondary">
            ホームへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
