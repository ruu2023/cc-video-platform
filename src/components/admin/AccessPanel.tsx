"use client";

import { useActionState } from "react";
import { grantPurchaseAction, revokePurchaseAction } from "@/app/admin/actions";
import { ActionMessage, FieldError } from "@/components/admin/ActionMessage";
import { IDLE_STATE } from "@/lib/admin-form";
import type { AccountSummary } from "@/lib/entitlements";

/**
 * ⚠️ 暫定機能 — Sprint 3（Stripe 決済）が入るまでのQA用パネル
 *
 * 本来 `purchase` テーブルの行は Stripe Checkout 完了時に Webhook が作成する。
 * まだ決済が未実装のため、クリエイターがここから手動で受講アクセスを付与・解除
 * できるようにしている。書き込み先のテーブル・カラムは Sprint 3 でもそのまま使う
 * ので、決済実装時に取り除くのはこのパネルと対応する2つのサーバーアクションだけ。
 * 視聴側（再生ページ・ストリーミングAPI・進捗API）は一切変更が不要。
 */

export type PurchaserRow = {
  userId: string;
  userEmail: string;
  userName: string;
  provider: "manual" | "stripe";
  purchasedAt: string;
  completedChapters: number;
  totalChapters: number;
};

export function AccessPanel({
  courseId,
  courseTitle,
  purchasers,
  accounts,
}: {
  courseId: string;
  courseTitle: string;
  purchasers: PurchaserRow[];
  accounts: AccountSummary[];
}) {
  const [grantState, grantAction, granting] = useActionState(
    grantPurchaseAction,
    IDLE_STATE
  );
  const [revokeState, revokeAction, revoking] = useActionState(
    revokePurchaseAction,
    IDLE_STATE
  );

  return (
    <section className="access-panel" data-testid="access-panel">
      <header className="access-panel__head">
        <div>
          <h2 className="display-sm admin-panel__title">受講アクセス</h2>
          <p className="section-head__sub">
            {courseTitle} を視聴できるアカウントの一覧です。
          </p>
        </div>
        <span className="badge badge--warn" data-testid="access-panel-provisional">
          暫定機能
        </span>
      </header>

      <p className="access-panel__note">
        <strong>Stripe 連携が入るまでの暫定機能です（Sprint 3 で正式な決済フローに置き換え予定）。</strong>
        ここで付与した受講アクセスは、決済完了時に作られるものと同じ
        <code> purchase </code>
        レコードとして保存されます（<code>provider = &quot;manual&quot;</code>）。
      </p>

      <form action={grantAction} className="access-grant">
        <input type="hidden" name="courseId" value={courseId} />

        <label className="field access-grant__field">
          <span className="field__label">メールアドレス</span>
          <input
            type="email"
            name="email"
            list={`accounts-${courseId}`}
            className="input"
            placeholder="viewer@kouza.test"
            required
            defaultValue={grantState.values.email ?? ""}
            data-testid="grant-email"
          />
          <FieldError state={grantState} name="email" />
        </label>

        <datalist id={`accounts-${courseId}`}>
          {accounts.map((account) => (
            <option key={account.id} value={account.email}>
              {account.name}（{account.role}）
            </option>
          ))}
        </datalist>

        <button
          type="submit"
          className="btn btn--primary"
          disabled={granting}
          data-testid="grant-purchase"
        >
          {granting ? "設定中…" : "購入済みにする"}
        </button>
      </form>

      <ActionMessage state={grantState} testId="grant-result" />
      <ActionMessage state={revokeState} testId="revoke-result" />

      {purchasers.length === 0 ? (
        <p className="empty-note" data-testid="no-purchasers">
          まだ受講アクセスを持つアカウントはありません。
        </p>
      ) : (
        <ul className="access-list" data-testid="purchaser-list">
          {purchasers.map((purchaser) => (
            <li
              key={purchaser.userId}
              className="access-row"
              data-testid={`purchaser-${purchaser.userEmail}`}
            >
              <span className="access-row__who">
                <span className="title-sm">{purchaser.userName}</span>
                <span className="caption">{purchaser.userEmail}</span>
              </span>

              <span className="access-row__meta">
                <span className="caption">
                  {purchaser.provider === "stripe" ? "Stripe 決済" : "手動付与"}
                  {purchaser.purchasedAt ? ` · ${purchaser.purchasedAt}` : ""}
                </span>
                <span className="caption">
                  視聴 {purchaser.completedChapters} / {purchaser.totalChapters}
                </span>
              </span>

              <form action={revokeAction}>
                <input type="hidden" name="courseId" value={courseId} />
                <input type="hidden" name="userId" value={purchaser.userId} />
                <button
                  type="submit"
                  className="btn btn--secondary btn--sm"
                  disabled={revoking}
                  data-testid={`revoke-${purchaser.userEmail}`}
                >
                  {revoking ? "解除中…" : "解除"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
