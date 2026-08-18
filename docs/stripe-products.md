# Stripe 商品マッピング（テストモード）

2026-08-16 作成。アカウント: `acct_1PzAHB2M1J7YK37I`（test mode）。
公開中コースのみ商品化。下書き `stripe-billing-handson` は公開時に追加すること。

| courseId (app) | Product ID | Price ID (単発・JPY) | 金額 |
|---|---|---|---|
| next-app-router | prod_V57eBqO3pStVz0 | price_1U4xOu2M1J7YK37IpyHSMo7q | ¥14,800 |
| typescript-type-design | prod_V57eWitJMX7cao | price_1U4xOv2M1J7YK37Ih2ckXrBS | ¥9,800 |
| sqlite-turso-edge | prod_V57eLyYEBaBEMq | price_1U4xOw2M1J7YK37IMCId2ACi | ¥7,800 |
| auth-from-scratch | prod_V57eB6px43DhWU | price_1U4xOx2M1J7YK37I1aCoxOow | ¥12,000 |
| design-tokens-for-devs | prod_V57eJZxprVSSPb | price_1U4xOy2M1J7YK37ITriEnKWa | ¥6,800 |

- 各Productの `metadata.courseId` にアプリ側コースIDを設定済み（Checkout セッション→購入記録の紐付けに利用可）
- 価格は `course.price_jpy` と一致。app 側で価格変更した場合は Price を作り直す必要あり
