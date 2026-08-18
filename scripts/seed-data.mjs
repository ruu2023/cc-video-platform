/**
 * Real course catalogue used by both the seed script and any future admin
 * tooling. Prices are in JPY (tax included), matching the buy-once model in
 * docs/spec.md.
 */

const INSTRUCTOR = {
  name: "佐倉 玲",
  title: "フルスタックエンジニア / 元 SaaS プロダクト責任者",
};

export const courses = [
  {
    id: "next-app-router",
    title: "Next.js App Router 実践設計",
    subtitle: "Server Components を前提にアプリを組み直す",
    description:
      "Pages Router の常識をいったん捨て、App Router を「サーバーで動くのが既定」という前提から設計し直す講座です。Server Components と Client Components の境界線の引き方、データ取得をコンポーネントに寄せたときのキャッシュ制御、Server Actions によるフォーム更新、そして Suspense を使った段階的なレンダリングまでを、実在の受講管理アプリを題材に一本通しで作りながら解説します。\n\n「なんとなく動いているが、どこにどの処理を置くべきか自信がない」という状態を抜け出し、境界の判断を言語化できるようになることがゴールです。各チャプターの終わりには、その時点のリポジトリ差分を配布します。",
    thumbnailUrl: "/thumbnails/next-app-router.svg",
    priceJpy: 14800,
    level: "intermediate",
    published: 1,
    sortOrder: 1,
    chapters: [
      "App Router のメンタルモデルとレンダリング境界",
      "Server Components でのデータ取得とキャッシュ設計",
      "Client Components に落とす判断基準",
      "Server Actions によるフォームと楽観的更新",
      "Suspense とストリーミングで体感速度を作る",
      "本番運用：再検証・エラー境界・計測",
    ],
  },
  {
    id: "typescript-type-design",
    title: "TypeScript 型設計の教科書",
    subtitle: "「通る型」ではなく「間違いを防ぐ型」を書く",
    description:
      "型エラーを消すための TypeScript から、設計として型を使う TypeScript へ進むための講座です。判別可能なユニオンで状態を表現し、不正な状態をそもそも表現できなくする方法、ブランド型による ID の取り違え防止、ジェネリクスと条件型を「読める範囲で」使う線引きを扱います。\n\n題材は実際の決済ドメインのモデリングです。any と型アサーションに頼っていたコードが、コンパイラに守られたコードへ変わっていく過程をそのまま追体験できます。",
    thumbnailUrl: "/thumbnails/typescript-type-design.svg",
    priceJpy: 9800,
    level: "intermediate",
    published: 1,
    sortOrder: 2,
    chapters: [
      "型を仕様書として使うという発想",
      "判別可能なユニオンで不正な状態を消す",
      "ブランド型と値オブジェクト",
      "ジェネリクスと条件型の実用的な境界",
      "型テストで設計を壊さずに育てる",
    ],
  },
  {
    id: "sqlite-turso-edge",
    title: "エッジで動かす SQLite / Turso 入門",
    subtitle: "レプリカ前提のデータ設計とマイグレーション運用",
    description:
      "SQLite をエッジに複製して動かす Turso を題材に、分散レプリカを前提にしたデータ設計を学びます。読み取りをレプリカへ逃がしつつ書き込みの一貫性をどう担保するか、スキーマ変更を無停止で流すマイグレーションの手順、埋め込みレプリカを使ったローカル開発環境の整え方までを扱います。\n\nPostgres で当たり前に使っていた設計が、なぜエッジではそのまま通用しないのか。その差分を実測しながら理解していく構成です。",
    thumbnailUrl: "/thumbnails/sqlite-turso-edge.svg",
    priceJpy: 7800,
    level: "beginner",
    published: 1,
    sortOrder: 3,
    chapters: [
      "SQLite がエッジで選ばれる理由",
      "Turso のレプリカ構成と読み書きの分離",
      "スキーマ設計とマイグレーション運用",
      "埋め込みレプリカでのローカル開発",
      "計測とチューニング",
    ],
  },
  {
    id: "auth-from-scratch",
    title: "認証実装の落とし穴",
    subtitle: "セッション・Cookie・トークンを腹落ちさせる",
    description:
      "認証ライブラリを入れれば動く、その先で事故が起きます。この講座ではセッション Cookie の属性ひとつひとつが何を守っているのかから始め、パスワードハッシュの選び方、セッション固定化とローテーション、CSRF と SameSite の関係、そしてトークン方式との使い分けを整理します。\n\n実際に脆弱な実装を用意し、攻撃を成立させてから塞ぐという順序で進めるため、「なぜその設定が必要か」を手を動かしながら理解できます。",
    thumbnailUrl: "/thumbnails/auth-from-scratch.svg",
    priceJpy: 12000,
    level: "advanced",
    published: 1,
    sortOrder: 4,
    chapters: [
      "セッションと Cookie 属性を正しく読む",
      "パスワード保管とハッシュ関数の選定",
      "セッション固定化・ローテーション・失効",
      "CSRF と SameSite の実際の挙動",
      "トークン方式との使い分けと移行",
    ],
  },
  {
    id: "design-tokens-for-devs",
    title: "エンジニアのためのデザイントークン",
    subtitle: "デザインの意思決定をコードに落とす",
    description:
      "色や余白を毎回その場で決めるのをやめ、意思決定を層として持つための講座です。素の値（primitive）と意味づけ（semantic）とコンポーネント単位の値を分ける三層構造、ダークモードを後付けで壊さないトークンの切り方、そして Figma と実装のあいだで名前を揃え続ける運用を扱います。\n\nデザイナーがいないチームでも、見た目の一貫性を仕組みで担保できるようになります。",
    thumbnailUrl: "/thumbnails/design-tokens-for-devs.svg",
    priceJpy: 6800,
    level: "beginner",
    published: 1,
    sortOrder: 5,
    chapters: [
      "トークンの三層構造と命名",
      "色：コントラストとテーマ切り替え",
      "タイポグラフィと余白のスケール設計",
      "実装への配布と破壊的変更の扱い",
    ],
  },
  {
    // Draft course: must never appear in the public list, and its detail page
    // must return the 404 view.
    id: "stripe-billing-handson",
    title: "Stripe 課金実装ハンズオン",
    subtitle: "（準備中）",
    description:
      "買い切り課金と Webhook の冪等な取り扱いを扱う講座です。現在収録中のため未公開です。",
    thumbnailUrl: "/thumbnails/stripe-billing-handson.svg",
    priceJpy: 13800,
    level: "intermediate",
    published: 0,
    sortOrder: 6,
    chapters: ["Stripe Checkout の全体像", "Webhook の冪等性"],
  },
];

export const instructor = INSTRUCTOR;

/**
 * Demo accounts created by the seed step so the admin area is reachable on a
 * fresh database. Passwords are hashed with better-auth's own scrypt helper, so
 * these accounts sign in through the normal login form.
 *
 * `creator` reaches /admin. `viewer` is a regular buyer and is denied there.
 */
export const accounts = [
  {
    id: "seed-user-creator",
    email: "creator@kouza.test",
    name: INSTRUCTOR.name,
    password: "creator-pass-2026",
    role: "creator",
  },
  {
    id: "seed-user-viewer",
    email: "viewer@kouza.test",
    name: "視聴 花子",
    password: "viewer-pass-2026",
    role: "viewer",
  },
];
