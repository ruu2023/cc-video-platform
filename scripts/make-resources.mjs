#!/usr/bin/env node
/**
 * Generates the demo course attachments (Sprint 5).
 *
 * The download flow is only meaningful with real bytes behind it, so this
 * writes actual files into data/uploads/ — a hand-built but genuinely valid
 * PDF, plus Markdown / JSON / CSV / plain-text handouts. They stand in for the
 * material a creator would upload from the admin screens, and are byte-for-byte
 * what `/api/uploads/[id]` serves back.
 *
 *   node scripts/make-resources.mjs
 *
 * Ids are derived from the resource key with a fixed namespace, so re-running
 * this (or the seed) neither duplicates rows nor orphans files.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = resolve(here, "..", "data", "uploads");

/** Stable, UUID-shaped id for a seeded upload — the same key always maps here. */
export function seededUploadId(key) {
  const hex = createHash("sha1").update(`kouza:upload:${key}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Version 5 / RFC-4122 variant nibbles, so the value is a well-formed UUID.
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/* ------------------------------------------------------------ file builders */

/**
 * A minimal but standards-valid PDF 1.4: catalog, page tree, one A4 page and a
 * content stream of Helvetica text. Offsets in the xref table are computed from
 * the assembled body, which is why the objects are built as strings first.
 */
function buildPdf(title, lines) {
  const escape = (text) =>
    text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const content =
    `BT\n/F1 18 Tf\n72 770 Td\n(${escape(title)}) Tj\nET\n` +
    lines
      .map(
        (line, index) =>
          `BT\n/F1 11 Tf\n72 ${735 - index * 18} Td\n(${escape(line)}) Tj\nET`
      )
      .join("\n") +
    "\n";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

const text = (value) => Buffer.from(value, "utf8");

/* ------------------------------------------------------------- the material */

/**
 * One entry per seeded attachment.
 *
 * `chapter` is the deterministic chapter id written by scripts/db.mjs
 * (`<courseId>-<position>`). Chapters that are absent here deliberately end up
 * with no attachments at all — the "no download button" case has to be real.
 */
export const RESOURCES = [
  {
    key: "next-app-router-1-checklist",
    chapter: "next-app-router-1",
    label: "レンダリング境界チェックリスト",
    fileName: "rendering-boundary-checklist.md",
    mimeType: "text/markdown",
    body: text(
      `# レンダリング境界チェックリスト\n\n` +
        `App Router でコンポーネントを置く場所に迷ったときの判断表です。\n\n` +
        `## Server Component のままにする\n\n` +
        `- [ ] データ取得だけをしている\n` +
        `- [ ] シークレット（APIキー・DB接続情報）に触れる\n` +
        `- [ ] 依存パッケージが重く、クライアントに送りたくない\n` +
        `- [ ] 出力が同じ入力に対して常に同じ\n\n` +
        `## Client Component に落とす\n\n` +
        `- [ ] useState / useEffect / useRef が必要\n` +
        `- [ ] onClick などのイベントハンドラを持つ\n` +
        `- [ ] ブラウザ API（window / localStorage / IntersectionObserver）を使う\n` +
        `- [ ] サードパーティのUIライブラリがフックを内部で使っている\n\n` +
        `## 境界を引く位置\n\n` +
        `"use client" は葉に近いほどよい。ページ全体に付けると、そのページの\n` +
        `サブツリー全部がクライアントバンドルに乗ります。状態を持つ小さな\n` +
        `コンポーネントだけを切り出し、データ取得は親のサーバー側に残します。\n`
    ),
  },
  {
    key: "next-app-router-1-cache",
    chapter: "next-app-router-1",
    label: "キャッシュ設定 早見表（JSON）",
    fileName: "cache-matrix.json",
    mimeType: "application/json",
    body: text(
      `${JSON.stringify(
        {
          $comment:
            "チャプター1で使うキャッシュ判断表。fetch のオプションと再検証方針の対応。",
          strategies: [
            {
              name: "static",
              fetch: { cache: "force-cache" },
              revalidate: false,
              use: "変わらないマスタデータ・法務ページ",
            },
            {
              name: "isr",
              fetch: { next: { revalidate: 300 } },
              revalidate: 300,
              use: "コース一覧のような、数分の遅延が許されるもの",
            },
            {
              name: "dynamic",
              fetch: { cache: "no-store" },
              revalidate: 0,
              use: "セッション依存・購入状態依存の画面",
            },
            {
              name: "tagged",
              fetch: { next: { tags: ["course"] } },
              revalidate: "on-demand",
              use: "管理画面から revalidateTag で明示的に飛ばす",
            },
          ],
        },
        null,
        2
      )}\n`
    ),
  },
  {
    key: "next-app-router-2-handout",
    chapter: "next-app-router-2",
    label: "データ取得パターン集（PDF）",
    fileName: "data-fetching-patterns.pdf",
    mimeType: "application/pdf",
    body: buildPdf("Data Fetching Patterns - Chapter 02", [
      "1. Fetch inside the component that renders the data.",
      "   Colocation beats prop drilling; the request is deduped per render.",
      "",
      "2. Parallelise with Promise.all when two requests do not depend",
      "   on each other. Sequential awaits are the most common waterfall.",
      "",
      "3. Push slow, non-critical data behind <Suspense> so the shell",
      "   streams first.",
      "",
      "4. Mark session-dependent reads no-store. A cached response that",
      "   embeds an entitlement is a security bug, not a performance win.",
      "",
      "5. Revalidate by tag from the mutation, not by guessing a TTL.",
    ]),
  },
  {
    key: "next-app-router-4-actions",
    chapter: "next-app-router-4",
    label: "Server Actions 実装サンプル",
    fileName: "server-actions-sample.txt",
    mimeType: "text/plain",
    body: text(
      `Server Actions 実装サンプル（チャプター4）\n` +
        `=======================================\n\n` +
        `"use server";\n\n` +
        `import { revalidatePath } from "next/cache";\n` +
        `import { requireCreator } from "@/lib/admin-guard";\n\n` +
        `export async function renameCourseAction(prevState, formData) {\n` +
        `  // 1. 認可はアクションの中で行う。ページ側のチェックだけでは、\n` +
        `  //    アクションIDを直接POSTされたときに素通りする。\n` +
        `  await requireCreator();\n\n` +
        `  const title = String(formData.get("title") ?? "").trim();\n` +
        `  if (title.length === 0) {\n` +
        `    return { ok: false, fieldErrors: { title: "タイトルは必須です。" } };\n` +
        `  }\n` +
        `  if (title.length > 120) {\n` +
        `    return { ok: false, fieldErrors: { title: "120文字以内で入力してください。" } };\n` +
        `  }\n\n` +
        `  try {\n` +
        `    await updateCourseTitle(formData.get("id"), title);\n` +
        `  } catch (error) {\n` +
        `    console.error("renameCourseAction failed", error);\n` +
        `    return { ok: false, message: "保存に失敗しました。時間をおいて再試行してください。" };\n` +
        `  }\n\n` +
        `  // 2. 再検証はアクションの最後に。呼び出し側の useActionState が\n` +
        `  //    返り値を受け取った時点で、画面はもう新しいデータになっている。\n` +
        `  revalidatePath("/admin");\n` +
        `  return { ok: true, message: "保存しました。" };\n` +
        `}\n`
    ),
  },
  {
    key: "typescript-type-design-1-worksheet",
    chapter: "typescript-type-design-1",
    label: "型設計ワークシート（CSV）",
    fileName: "type-design-worksheet.csv",
    mimeType: "text/csv",
    body: text(
      `状態,表現方法,不正な組み合わせ,型で防げるか\n` +
        `読み込み中,"{ status: ""loading"" }",data と error が同時に入る,はい\n` +
        `成功,"{ status: ""ok""; data: T }",data が undefined,はい\n` +
        `失敗,"{ status: ""error""; error: E }",error が空文字,いいえ（値の検証が必要）\n` +
        `未着手,"{ status: ""idle"" }",loading と idle の二重管理,はい\n`
    ),
  },
];

/* --------------------------------------------------------------------- run */

/** Writes every attachment to disk and returns their catalogue rows. */
export async function makeResources({ quiet = false } = {}) {
  await mkdir(UPLOAD_DIR, { recursive: true });

  const written = [];
  for (const resource of RESOURCES) {
    const id = seededUploadId(resource.key);
    const extension = resource.fileName.slice(resource.fileName.lastIndexOf("."));
    const storedName = `${id}${extension}`;
    await writeFile(resolve(UPLOAD_DIR, storedName), resource.body);

    written.push({
      ...resource,
      id,
      storedName,
      sizeBytes: resource.body.byteLength,
    });
  }

  if (!quiet) {
    console.log(
      `resources: wrote ${written.length} attachment(s) to ${UPLOAD_DIR}\n` +
        written
          .map((r) => `  - ${r.fileName} (${r.sizeBytes} B) → ${r.chapter}`)
          .join("\n")
    );
  }

  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  makeResources().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
