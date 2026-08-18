#!/usr/bin/env node
/**
 * Generates the local placeholder lesson videos used while bunny.net is not
 * connected yet.
 *
 * The files are written to `data/videos/` — deliberately OUTSIDE `public/`, so
 * they can never be fetched without going through the token-authenticated
 * streaming route (`/api/stream/[chapterId]`). That mirrors how bunny.net
 * Stream works in production: the bytes are only reachable through a signed,
 * expiring URL.
 *
 * Each clip is a silent, counter-style H.264/MP4 so a human (or Playwright)
 * can see that playback actually advances and that resuming lands at the right
 * second. `+faststart` moves the moov atom to the front so the browser can
 * start playing before the whole file is buffered.
 *
 *   node scripts/make-videos.mjs
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "data", "videos");

/**
 * The placeholder library. `name` is what `chapter.video_asset` stores, so the
 * catalogue below is the single source of truth for which clips exist.
 */
export const VIDEO_ASSETS = [
  { name: "lesson-01.mp4", seconds: 24, label: "LESSON 01", color: "0x26251e" },
  { name: "lesson-02.mp4", seconds: 30, label: "LESSON 02", color: "0x2f2b3a" },
  { name: "lesson-03.mp4", seconds: 20, label: "LESSON 03", color: "0x1f3330" },
  { name: "lesson-04.mp4", seconds: 26, label: "LESSON 04", color: "0x3a2a20" },
  { name: "lesson-05.mp4", seconds: 18, label: "LESSON 05", color: "0x232a3a" },
  { name: "lesson-06.mp4", seconds: 22, label: "LESSON 06", color: "0x33202c" },
];

function drawText(text, { size, y, alpha = 1 }) {
  // No fontfile is passed: ffmpeg's bundled default font is used. Colons inside
  // the timecode expression must stay escaped for the filtergraph parser.
  return [
    "drawtext=",
    `text='${text}'`,
    `:fontcolor=white@${alpha}`,
    `:fontsize=${size}`,
    ":x=(w-text_w)/2",
    `:y=${y}`,
  ].join("");
}

async function build({ name, seconds, label, color }) {
  const target = join(outDir, name);

  const filters = [
    drawText(label, { size: 64, y: "(h/2)-140", alpha: 0.9 }),
    // A live seconds counter — the visual proof that resume/seek works.
    "drawtext=text='%{eif\\:trunc(t)\\:d} s':fontcolor=white:fontsize=180" +
      ":x=(w-text_w)/2:y=(h/2)-60",
    drawText(`${seconds}s placeholder / bunny.net stream stand-in`, {
      size: 28,
      y: "(h/2)+150",
      alpha: 0.55,
    }),
  ].join(",");

  await run(ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=1280x720:r=24:d=${seconds}`,
    "-vf",
    filters,
    "-c:v",
    "libx264",
    "-profile:v",
    "baseline",
    "-level",
    "3.1",
    "-pix_fmt",
    "yuv420p",
    // Frequent keyframes keep seeking (and therefore resume) accurate.
    "-g",
    "24",
    "-movflags",
    "+faststart",
    "-an",
    target,
  ]);

  const info = await stat(target);
  return { name, seconds, bytes: info.size };
}

async function main() {
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg-static did not resolve a binary. Run `npm install` and retry."
    );
  }

  await mkdir(outDir, { recursive: true });

  const force = process.argv.includes("--force");
  const existing = new Set(await readdir(outDir).catch(() => []));

  const results = [];
  for (const asset of VIDEO_ASSETS) {
    if (!force && existing.has(asset.name)) {
      results.push({ name: asset.name, skipped: true });
      continue;
    }
    results.push(await build(asset));
  }

  const built = results.filter((r) => !r.skipped);
  console.log(
    `videos: ${built.length} written, ${results.length - built.length} kept — ${outDir}` +
      (built.length
        ? `\n        ${built
            .map((r) => `${r.name} (${r.seconds}s, ${(r.bytes / 1024).toFixed(0)}KB)`)
            .join("\n        ")}`
        : "")
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
