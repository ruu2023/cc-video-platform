import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring playback URLs — bunny.net's production Token
 * Authentication (Sprint 6 onward).
 *
 * bunny.net protects a Stream library CDN by requiring every playback request
 * to carry `?token=<signature>&expires=<unix seconds>`, where the signature is
 *
 *   token = "HS256-" + base64url(
 *             HMAC-SHA256(key = security key, message = path + expires)
 *           )
 *
 * `path` is the URL path of the media file (e.g. `/{guid}/play_720p.mp4`),
 * `expires` is the decimal unix timestamp, and the key is the library's token
 * key (`BUNNY_STREAM_TOKEN_KEY`, used as the raw string value). A URL
 * therefore cannot be edited (a different path or expiry invalidates the
 * signature) and stops working on its own once the clock passes `expires`.
 *
 * The same scheme also protects the app's own `/api/stream/[chapterId]` route
 * for locally stored placeholder clips — the only difference is the path that
 * goes into the message.
 *
 * Verification is intentionally total: an expired, tampered or malformed token
 * all fail, and the comparison is constant-time.
 */

/** Default lifetime of a playback URL. */
export const DEFAULT_TOKEN_TTL_SECONDS = 60 * 30;

/** Guard rails for a caller-supplied TTL (see `resolveTtlSeconds`). */
export const MIN_TOKEN_TTL_SECONDS = 5;
export const MAX_TOKEN_TTL_SECONDS = 60 * 60 * 12;

export type SignedPlayback = {
  /** Unix seconds at which the token stops working. */
  expires: number;
  /**
   * `HS256-` prefixed base64url HMAC signature, ready to be used as the
   * `token` query parameter.
   */
  token: string;
};

export type TokenFailure =
  | "missing" // no token/expires on the request
  | "malformed" // non-numeric expiry, empty token, …
  | "expired" // signature fine, clock has passed `expires`
  | "invalid"; // signature does not match (tampered path/expiry)

export type TokenVerification =
  | { ok: true; expires: number }
  | { ok: false; reason: TokenFailure };

/**
 * The signing key — the raw value of bunny.net's token security key.
 * Falls back to BETTER_AUTH_SECRET so a freshly cloned repo still produces
 * genuinely unforgeable tokens instead of silently signing with an empty key;
 * production sets BUNNY_STREAM_TOKEN_KEY explicitly.
 */
export function securityKey(): string {
  const key =
    process.env.BUNNY_STREAM_TOKEN_KEY?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();

  if (!key) {
    throw new Error(
      "BUNNY_STREAM_TOKEN_KEY is not set (and BETTER_AUTH_SECRET is missing) — " +
        "playback URLs cannot be signed. See .env.example."
    );
  }
  return key;
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The bunny.net signature for one path at one expiry moment. */
export function signature(path: string, expires: number): string {
  return `HS256-${base64url(
    createHmac("sha256", securityKey()).update(`${path}${expires}`).digest()
  )}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Clamps a requested lifetime into the allowed range.
 *
 * A short TTL is how the expiry rule is exercised end-to-end without waiting
 * half an hour: the watch page accepts `?ttl=<seconds>` and hands it here.
 */
export function resolveTtlSeconds(raw: unknown): number {
  const value = Number(
    typeof raw === "string" || typeof raw === "number" ? raw : Number.NaN
  );
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TOKEN_TTL_SECONDS;
  return Math.min(
    MAX_TOKEN_TTL_SECONDS,
    Math.max(MIN_TOKEN_TTL_SECONDS, Math.floor(value))
  );
}

/** Mints `{ expires, token }` for a media path. */
export function signPlayback(
  path: string,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS
): SignedPlayback {
  const expires = nowSeconds() + resolveTtlSeconds(ttlSeconds);
  return { expires, token: signature(path, expires) };
}

/** Builds the query string (path + `token`/`expires`) for a signed request. */
export function signedPlaybackQuery(
  path: string,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS
): { query: string; expires: number; token: string } {
  const { expires, token } = signPlayback(path, ttlSeconds);
  const query = new URLSearchParams({ token, expires: String(expires) });
  return { query: query.toString(), expires, token };
}

/** Builds the full relative URL (path + query) for a signed playback request. */
export function signedPlaybackUrl(
  path: string,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS
): { url: string; expires: number } {
  const { query, expires } = signedPlaybackQuery(path, ttlSeconds);
  return { url: `${path}?${query}`, expires };
}

/**
 * Checks a presented token against the path it must have been minted for.
 * Signature first, clock second, so a tampered expiry reports as "invalid"
 * rather than leaking that a valid signature existed.
 */
export function verifyPlayback(
  path: string,
  token: string | null | undefined,
  expiresRaw: string | null | undefined
): TokenVerification {
  if (!token || !expiresRaw) return { ok: false, reason: "missing" };

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || !Number.isInteger(expires) || expires <= 0) {
    return { ok: false, reason: "malformed" };
  }

  const expected = signature(path, expires);
  const presented = Buffer.from(token, "utf8");
  const reference = Buffer.from(expected, "utf8");

  if (
    presented.length !== reference.length ||
    !timingSafeEqual(presented, reference)
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (nowSeconds() >= expires) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, expires };
}

export const TOKEN_FAILURE_MESSAGE: Record<TokenFailure, string> = {
  missing: "再生トークンがありません。",
  malformed: "再生トークンの形式が不正です。",
  expired: "再生URLの有効期限が切れました。ページを再読み込みしてください。",
  invalid: "再生トークンが無効です。",
};
