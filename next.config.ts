import type { NextConfig } from "next";

// Course thumbnails live on the bunny.net assets Pull Zone (see Sprint 6),
// so the image optimizer needs to be allowed to fetch from it.
const assetsHostname = process.env.BUNNY_ASSETS_HOSTNAME?.trim();

const nextConfig: NextConfig = {
  // Next.js 16 writes its own CLAUDE.md / AGENTS.md on dev start, which would
  // clobber this project's agent pipeline instructions. Keep this disabled.
  agentRules: false,
  images: assetsHostname
    ? {
        remotePatterns: [
          { protocol: "https" as const, hostname: assetsHostname },
        ],
        // The seeded catalogue's SVG thumbnails are served from the same CDN.
        // They are this app's own uploads (the admin picker blocks SVG), so
        // letting the optimizer pass SVG through is safe here.
        dangerouslyAllowSVG: true,
        contentDispositionType: "inline",
      }
    : undefined,
  experimental: {
    serverActions: {
      // Chapter attachments (PDF / ZIP) are posted through server actions, so
      // the 1MB default body limit has to cover the 25MB upload ceiling
      // enforced in src/lib/uploads.ts.
      bodySizeLimit: "30mb",
    },
  },
  // The stream route reads data/videos/*.mp4 straight off disk (see
  // src/lib/video-source.ts) via a dynamic path Next's file tracing can't
  // follow statically, so without this the fallback clips are silently left
  // out of the deployment and every chapter still on bunny.net's demo GUIDs
  // 404s in production.
  outputFileTracingIncludes: {
    "/api/stream/[chapterId]": ["./data/videos/*.mp4"],
  },
};

export default nextConfig;
