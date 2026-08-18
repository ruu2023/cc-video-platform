#!/usr/bin/env node
/**
 * Generates the course thumbnail artwork into public/thumbnails/.
 *
 * Each thumbnail is a 16:9 editor mockup built strictly from the neutral half
 * of docs/design-tokens.md: warm cream canvas, white card, hairline-only depth,
 * JetBrains Mono code surface, ink text, and Cursor Orange used once per image
 * at most. The timeline pastels are NOT used here — design-tokens.md scopes
 * them to in-product agent timelines only.
 *
 * The composition fills the full 640x360 frame (window chrome, gutter, code,
 * status bar) so the artwork does not collapse into empty space when it is
 * rendered large on the course detail page.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "public", "thumbnails");

const T = {
  canvas: "#f7f7f4",
  canvasSoft: "#fafaf7",
  card: "#ffffff",
  ink: "#26251e",
  body: "#5a5852",
  muted: "#807d72",
  mutedSoft: "#a09c92",
  hairline: "#e6e5e0",
  hairlineSoft: "#efeee8",
  hairlineStrong: "#cfcdc4",
  surfaceStrong: "#e6e5e0",
  primary: "#f54e00",
};

const designs = [
  {
    file: "next-app-router.svg",
    label: "APP ROUTER",
    file_name: "app/layout.tsx",
    status: "server component · streaming",
    lines: [
      [["export default async", T.body]],
      [["function ", T.body], ["Layout", T.primary], ["({ children }) {", T.body]],
      [["  const nav = await ", T.body], ["getNav", T.ink], ["()", T.body]],
      [["  return (", T.body]],
      [["    <Shell nav={nav}>", T.body]],
      [["      {children}", T.body]],
      [["    </Shell>)", T.body]],
      [["}", T.body]],
    ],
  },
  {
    file: "typescript-type-design.svg",
    label: "TYPE DESIGN",
    file_name: "domain/order.ts",
    status: "不正な状態は表現できない",
    lines: [
      [["type ", T.body], ["Order", T.primary], [" =", T.body]],
      [["  | { status: ", T.body], ['"draft"', T.ink], [" }", T.body]],
      [["  | { status: ", T.body], ['"paid"', T.ink], [";", T.body]],
      [["      paidAt: Date }", T.body]],
      [["  | { status: ", T.body], ['"refunded"', T.ink], [";", T.body]],
      [["      paidAt: Date;", T.body]],
      [["      reason: string }", T.body]],
      [["// 状態は必ず対で持つ", T.muted]],
    ],
  },
  {
    file: "sqlite-turso-edge.svg",
    label: "EDGE SQLITE",
    file_name: "turso db shell app",
    status: "replica lag < 2ms",
    lines: [
      [["$ ", T.muted], ["turso db shell app", T.ink]],
      [["→ replica nrt   1.2ms", T.body]],
      [["→ replica fra   1.8ms", T.body]],
      [["→ replica iad   1.5ms", T.body]],
      [["", T.body]],
      [["SELECT ", T.primary], ["* FROM course", T.body]],
      [["  WHERE published = 1", T.body]],
      [["  ORDER BY sort_order;", T.body]],
    ],
  },
  {
    file: "auth-from-scratch.svg",
    label: "SESSION",
    file_name: "response.headers",
    status: "cookie 属性が守るもの",
    lines: [
      [["Set-Cookie: ", T.muted], ["session=…", T.ink]],
      [["  HttpOnly;", T.body]],
      [["  Secure;", T.body]],
      [["  SameSite=", T.body], ["Lax", T.primary], [";", T.body]],
      [["  Path=/;", T.body]],
      [["  Max-Age=2592000", T.body]],
      [["", T.body]],
      [["// 固定化はローテーションで塞ぐ", T.muted]],
    ],
  },
  {
    file: "design-tokens-for-devs.svg",
    label: "TOKENS",
    file_name: "tokens/base.css",
    status: "primitive → semantic → component",
    lines: [
      [["--color-canvas:  ", T.body], ["#f7f7f4", T.ink]],
      [["--color-ink:     ", T.body], ["#26251e", T.ink]],
      [["--color-primary: ", T.body], ["#f54e00", T.primary]],
      [["--color-hairline:", T.body], [" #e6e5e0", T.ink]],
      [["--space-section: ", T.body], ["80px", T.ink]],
      [["--radius-card:   ", T.body], ["12px", T.ink]],
      [["", T.body]],
      [["/* 意思決定を層で持つ */", T.muted]],
    ],
  },
  {
    file: "stripe-billing-handson.svg",
    label: "準備中",
    file_name: "webhook/stripe.ts",
    status: "収録中",
    lines: [
      [["POST /webhook/stripe", T.ink]],
      [["  event: ", T.body], ["checkout.completed", T.primary]],
      [["  idempotency: on", T.body]],
      [["", T.body]],
      [["if (await seen(event.id))", T.body]],
      [["  return ok()", T.body]],
      [["", T.body]],
      [["// 収録中", T.muted]],
    ],
  },
];

const escape = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function render({ label, file_name, status, lines }) {
  const W = 640;
  const H = 360;
  const mono =
    "JetBrains Mono, Fira Code, ui-monospace, SFMono-Regular, Menlo, monospace";
  const sans = "Inter, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif";
  const charW = 8.4;

  const cardX = 24;
  const cardY = 24;
  const cardW = W - 48;
  const cardH = H - 48;
  const chromeH = 46;
  const statusH = 34;
  const gutterX = cardX + 44;

  const codeTop = cardY + chromeH;
  const codeBottom = cardY + cardH - statusH;
  const lineHeight = 26;
  const blockH = lines.length * lineHeight;
  const firstBaseline =
    codeTop + (codeBottom - codeTop - blockH) / 2 + lineHeight * 0.72;

  // Explicit x/y on every tspan keeps rendering identical across SVG engines.
  const code = lines
    .map((segments, i) => {
      const y = Math.round(firstBaseline + i * lineHeight);
      let x = gutterX + 16;
      const spans = segments
        .map(([text, fill]) => {
          const span = `<tspan x="${x.toFixed(1)}" y="${y}" fill="${fill}">${escape(
            text
          )}</tspan>`;
          x += text.length * charW;
          return span;
        })
        .join("");
      return `<text font-family="${mono}" font-size="14" xml:space="preserve">${spans}</text>`;
    })
    .join("\n  ");

  const gutter = lines
    .map((_, i) => {
      const y = Math.round(firstBaseline + i * lineHeight);
      return `<text x="${gutterX - 12}" y="${y}" text-anchor="end" font-family="${mono}" font-size="12" fill="${T.mutedSoft}">${i + 1}</text>`;
    })
    .join("\n  ");

  const labelW = label.length * 8 + 22;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <rect width="${W}" height="${H}" fill="${T.canvas}"/>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="12" fill="${T.card}" stroke="${T.hairline}"/>

  <path d="M${cardX} ${cardY + 12}a12 12 0 0 1 12-12h${cardW - 24}a12 12 0 0 1 12 12v${chromeH - 12}H${cardX}Z" fill="${T.canvasSoft}"/>
  <line x1="${cardX}" y1="${cardY + chromeH}" x2="${cardX + cardW}" y2="${cardY + chromeH}" stroke="${T.hairline}"/>
  <circle cx="${cardX + 20}" cy="${cardY + chromeH / 2}" r="4" fill="${T.hairlineStrong}"/>
  <circle cx="${cardX + 34}" cy="${cardY + chromeH / 2}" r="4" fill="${T.hairlineStrong}"/>
  <circle cx="${cardX + 48}" cy="${cardY + chromeH / 2}" r="4" fill="${T.hairlineStrong}"/>
  <text x="${cardX + 66}" y="${cardY + chromeH / 2 + 4}" font-family="${mono}" font-size="12" fill="${T.muted}">${escape(file_name)}</text>
  <rect x="${cardX + cardW - 16 - labelW}" y="${cardY + chromeH / 2 - 11}" width="${labelW}" height="22" rx="11" fill="${T.surfaceStrong}"/>
  <text x="${cardX + cardW - 16 - labelW / 2}" y="${cardY + chromeH / 2 + 4}" text-anchor="middle" font-family="${sans}" font-size="11" font-weight="600" letter-spacing="0.88" fill="${T.ink}">${escape(label)}</text>

  <line x1="${gutterX}" y1="${codeTop}" x2="${gutterX}" y2="${codeBottom}" stroke="${T.hairlineSoft}"/>
  ${gutter}
  ${code}

  <line x1="${cardX}" y1="${codeBottom}" x2="${cardX + cardW}" y2="${codeBottom}" stroke="${T.hairline}"/>
  <rect x="${cardX + 20}" y="${codeBottom + statusH / 2 - 4}" width="8" height="8" rx="2" fill="${T.hairlineStrong}"/>
  <text x="${cardX + 36}" y="${codeBottom + statusH / 2 + 4}" font-family="${sans}" font-size="12" fill="${T.muted}">${escape(status)}</text>
  <text x="${cardX + cardW - 20}" y="${codeBottom + statusH / 2 + 4}" text-anchor="end" font-family="${mono}" font-size="12" fill="${T.mutedSoft}">Kouza</text>
</svg>
`;
}

await mkdir(outDir, { recursive: true });
for (const design of designs) {
  await writeFile(resolve(outDir, design.file), render(design), "utf8");
}
console.log(`thumbnails: wrote ${designs.length} file(s) to ${outDir}`);
