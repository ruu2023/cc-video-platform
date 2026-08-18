# Kouza — 買い切り動画講座プラットフォーム

Next.js + libSQL/Turso + better-auth。Sprint 2（クリエイター管理画面）と Sprint 4（購入者限定の動画視聴・視聴進捗）まで実装済み。
Sprint 3（Stripe 決済）は保留中で、購入記録は管理画面から手動で付与する（後述）。

## セットアップ

```bash
npm install
cp .env.example .env       # 値を埋める（BETTER_AUTH_SECRET は openssl rand -base64 32 など）
npm run setup              # サムネイル生成 → ダミー動画生成 → スキーマ作成 → シード投入
npm run auth:migrate       # better-auth の user/session/account/verification テーブル作成
npm run dev                # http://localhost:3100
```

> ポート 3000 ではなく **3100** を使う。ローカル環境では 3000 を OrbStack が占有していたため。
> 変更する場合は `package.json` の `dev`/`start` と `.env` の `BETTER_AUTH_URL` を揃えること。

## テスト

開発サーバーを起動した状態で:

```bash
npm test                   # Sprint 1 / 2 / 4 のコントラクトテスト（52 件）
```

`BASE_URL` 環境変数で対象を切り替えられる。

## データベース

libSQL ドライバ（Turso 公式クライアント）を使用。接続先は `.env` で切り替える。

| 変数 | 用途 |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://<db>-<org>.turso.io` で Turso Cloud、`file:./data/app.db` で埋め込み libSQL |
| `TURSO_AUTH_TOKEN` | Turso Cloud を使う場合のデータベーストークン |

- アプリのスキーマ: `scripts/schema.sql`（`course` / `chapter` / `upload` / `chapter_resource` / `purchase` / `chapter_progress`）
- シードデータ: `scripts/seed-data.mjs`（公開コース 5 件・下書き 1 件・チャプター 27 件・デモアカウント 2 件）
- 認証テーブルは better-auth CLI が管理する（`npm run auth:migrate`）。
  `user.role` 列だけはアプリ側の `npm run db:migrate` が追加する（既存 DB にも冪等に適用される）。

シードは冪等。`npm run db:seed` は何度実行しても重複しない。

### 権限とデモアカウント

| メールアドレス | パスワード | 権限 | できること |
|---|---|---|---|
| `creator@kouza.test` | `creator-pass-2026` | `creator` | 管理画面（`/admin`）でコース・チャプター・資料を管理 |
| `viewer@kouza.test` | `viewer-pass-2026` | `viewer` | コースの閲覧のみ。`/admin` は拒否される |

`/signup` から作られたアカウントは必ず `viewer` になる（サインアップのペイロードで
`role` を送っても無視される）。既存ユーザーの権限を変えるには:

```bash
node --env-file=.env scripts/db.mjs role someone@example.com creator
```

### アップロードされたファイル

コースのサムネイル画像とチャプターの付属資料は `data/uploads/` に保存し、
カタログ行を `upload` テーブルに持つ。配信は `/api/uploads/[id]` 経由のみで、
`public/` には置かない（購入者限定の配信を後から差し込めるようにするため）。

## ルート

| パス | 内容 |
|---|---|
| `/` | ホーム（ヒーロー + おすすめコース 3 件） |
| `/courses` | 公開中のコース一覧（下書きは非表示） |
| `/courses/[id]` | コース詳細。未購入は説明文＋チャプタータイトルのみ、購入済みは視聴進捗つきのカリキュラム |
| `/courses/[id]/watch/[chapterId]` | 購入者限定の再生ページ（未ログインは `/login`、未購入は視聴不可の案内） |
| `/signup` `/login` | メール／パスワード認証（`?next=` で認証後の遷移先を指定可） |
| `/admin` | クリエイター専用ダッシュボード（公開／非公開の切り替え） |
| `/admin/courses/new` | コース作成 |
| `/admin/courses/[id]` | コース編集・チャプターの追加／編集／並べ替え／削除・資料アップロード |
| `/access-denied` | 視聴者アカウントが管理画面に来たときの 403 相当ページ |
| `/api/uploads/[id]` | アップロード済みファイルの配信 |
| `/api/stream/[chapterId]` | 署名付き・期限付きの動画ストリーミング（Range 対応） |
| `/api/progress` | 視聴位置・視聴完了の保存 |
| `/api/auth/*` | better-auth ハンドラ |

存在しない ID・未公開コースの ID は HTTP 404 を返す。管理画面は未ログインなら
`/login?next=…`、視聴者アカウントなら `/access-denied` にリダイレクトされる。
アクセス制御はページ側だけでなく、すべての Server Action でも再チェックしている。

## デザイン

`docs/design-tokens.md`（Cursor-design-analysis）を `src/app/globals.css` の CSS 変数として実装。
CursorGothic はライセンスフォントのため、ドキュメント指定の代替である Inter を使用。コード面は JetBrains Mono。

難易度バッジはあえて無彩色（`surface-strong` / ハイライン / `ink` の反転）で組んでいる。
`docs/design-tokens.md` はタイムラインのパステル 5 色を「in-product のエージェント
タイムライン専用」と明記しているため、システム上の分類色には使わない。
コースのサムネイル SVG（`scripts/make-thumbnails.mjs`）も同じ理由で無彩色。

## 動画の視聴と保護（Sprint 4）

### 保護の仕組み

再生用URLは bunny.net の Token Authentication と同じ契約で発行する
（`src/lib/video-token.ts`）。`HMAC-SHA256(パス + 有効期限 + ユーザーID)` を
base64url にしたものを `?token=…&expires=…` として付与し、以下を**すべて**満たさない限り
1バイトも返さない（`src/app/api/stream/[chapterId]/route.ts`）。

1. ログイン済みであること（そうでなければ 401）
2. トークンがそのパスとそのユーザーに対して正しく、期限内であること（403）
3. そのコースの `purchase` 行を持っていること（403）
4. コースが公開中であること（404）

トークンはユーザーIDに紐付くため、他人にURLをコピーしても再生できない。
拒否理由は `x-playback-denied` ヘッダで返し、プレイヤーが具体的な文言を出す。

| 変数 | 用途 |
|---|---|
| `BUNNY_STREAM_TOKEN_KEY` | 署名キー。bunny.net のセキュリティキーをそのまま入れる想定。未設定なら `BETTER_AUTH_SECRET` にフォールバック |
| `BUNNY_STREAM_HOSTNAME` | bunny.net Stream の Pull Zone ホスト名。設定すると配信元が bunny.net の署名付きCDN URL に切り替わる |

### 動画ファイル（bunny.net 未接続のあいだ）

bunny.net の実アカウントがまだないため、`npm run videos` が
`data/videos/lesson-0N.mp4`（無音・18〜30秒・秒数カウンタ付き）を ffmpeg で生成し、
これを署名付きURL経由で配信している。`public/` ではなく `data/` に置いてあるので、
トークンを通さずに取得する経路は存在しない。

配信元の判定は **`src/lib/video-source.ts` の 1 箇所だけ**にまとまっている。
`BUNNY_STREAM_HOSTNAME` を設定すればローカル配信から bunny.net の署名付きURLに切り替わり、
再生ページ・進捗保存・アクセス制御には一切変更が要らない。

### 有効期限の確認方法

再生URLの既定の寿命は 30 分。QA では再生ページに `?ttl=<秒>` を付けると
短い寿命のトークンを発行できる（5秒〜12時間にクランプ）。

```
/courses/next-app-router/watch/next-app-router-1?ttl=10
```

10 秒後にはプレイヤーが「再生URLの有効期限が切れました」を表示し、
同じURLへのリクエストは 403（`x-playback-denied: expired`）になる。
「新しい再生URLを取得」ボタンで再発行され、視聴位置は保持される。

### 視聴進捗

再生中は数秒おき、および一時停止・再生終了・タブ離脱時（`sendBeacon`）に
`/api/progress` へ位置を保存する。再度開くと前回位置から再開し、
95% 以上まで視聴すると「視聴完了」になる（巻き戻しても解除されない）。
コース詳細ページにはチャプターごとの完了状況と、コース全体の進捗率が出る。

再生ページにはダウンロード導線を一切置かない。`<video>` は
`controlsList="nodownload …"` と `disablePictureInPicture` を付け、配信レスポンスは
`Content-Disposition: inline` かつ `Cache-Control: no-store` を返す。
チャプターの付属資料も、この理由から再生ページには出していない。

## 購入済みにする（Sprint 3 までの暫定運用）

Stripe Checkout は未実装のため、`/admin/courses/[id]` の「受講アクセス」パネルから
クリエイターが手動でアクセスを付与・解除する。書き込み先は決済実装後と同じ
`purchase` テーブル（`provider = 'manual'`）で、Stripe Webhook は同じ行を
`provider = 'stripe'` として作る想定。差し替え時に消えるのはこのパネルと
対応する 2 つの Server Action だけで、視聴側のロジックは変更不要。

例: `viewer@kouza.test` を `next-app-router` の購入者にする

1. `creator@kouza.test` でログイン
2. `/admin/courses/next-app-router` を開く
3. 「受講アクセス」パネルにメールアドレスを入れて「購入済みにする」
