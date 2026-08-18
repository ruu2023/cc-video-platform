# cc-video-platform

このプロジェクトは `planner` → `generator` → `evaluator` の3つのサブエージェントによる開発パイプラインで進める。各エージェントの定義は `.claude/agents/` にある。

## パイプライン概要

```
ユーザーの短いプロンプト
      ↓
  [planner]   仕様書・スプリント計画・スプリント契約を作成
      ↓
  [generator] スプリント契約に基づいて実装
      ↓
  [evaluator] Playwright MCP で実操作テスト・デザイン評価
      ↓
  合格 → 次のスプリントへ／不合格 → generator に差し戻し
```

## ファイル構成

```
/docs/
├── spec.md                 # 製品仕様書（planner が作成）
├── design-tokens.md         # デザイントークン（色・タイポグラフィ・余白など。ユーザー提供）
├── references/               # 参考画像（ユーザー提供）
│   └── *.png / *.jpg
└── sprints/
    ├── sprint-1.md          # スプリント計画と契約（planner が作成）
    ├── sprint-2.md
    └── ...
```

- `design-tokens.md` と `references/` はユーザーが用意する入力であり、`planner` は生成しない。存在する場合のみ利用する。
- 各エージェントはこれらのファイルが存在するかを作業開始時に確認し、存在すれば必ず参照する。存在しなくてもエラーにはせず、通常のフローで進める。

## 各エージェントの実行ルール

### planner
- ユーザーの短いプロンプトから `/docs/spec.md` と `/docs/sprints/sprint-N.md` を生成する。
- 技術的な実装詳細（DB設計・API設計・状態管理方式）には踏み込まない。
- スプリント契約は必ずテスト可能な具体的条件で書く。曖昧な条件（「UIが直感的」等）は禁止。
- `design-tokens.md` や `references/` がある場合、spec.md の「技術スタック推奨」やスプリント契約には含めず、あくまで generator / evaluator が参照する素材として扱う（planner 自身はデザイン判断をしない）。

### generator
- 実行前に、対象スプリントの `/docs/sprints/sprint-N.md` に加えて、存在すれば `/docs/design-tokens.md` と `/docs/references/` の画像を読み込み、実装の見た目・色・余白の指針として使う。
- スプリント契約の全条件を満たすことを最優先する。スタブ・モック・TODO・機能の先送りは禁止。
- コンテキストが逼迫しても機能を省略せず、未完了があれば完了報告に正直に記載する。
- 完了後は既定のフォーマットで完了報告を出力し、evaluator に引き継ぐ。

### evaluator
- Playwright MCP を使い、実際にアプリを操作してスプリント契約の各条件を検証する。
- スクリーンショットを撮影し、デザイン評価（デザインの質・オリジナリティ・クラフト・機能性）を行う。`design-tokens.md` がある場合はトークンとの整合性を、`references/` の画像がある場合はそれとの視覚的な近さを評価基準に加える。
- 判定は懐疑的に行う。「概ね良い」で合格にしない。契約条件を1つでも満たさない、またはデザイン基準が閾値未満なら不合格。
- 不合格時は、具体的な問題箇所・原因推定・修正指示（ファイル名まで）を明記し、generator に差し戻す。

## 全体ルール

- 1スプリントの機能数は2〜4個、契約条件は5〜15個を目安にする。
- スプリントは順番に進める。前のスプリントが evaluator に合格するまで、次のスプリントの generator 実行には進まない。
- Designer ロールは存在しない。UI/デザインの磨き込みは generator が design-tokens・参考画像を基に直接行い、evaluator が品質を検証する。

## 開発環境（Sprint 1 以降）

```bash
npm install
npm run setup        # サムネイル生成 + スキーマ作成 + シード投入
npm run auth:migrate # better-auth のテーブル作成（初回のみ）
npm run dev          # http://localhost:3000
```

- DB は libSQL（Turso ドライバ）。`.env` の `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` で接続先を切り替える。
- `next.config.ts` の `agentRules: false` は、Next.js がこの CLAUDE.md を上書きするのを防ぐための設定。外さないこと。
