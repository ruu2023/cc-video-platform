"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatClock,
  PROGRESS_SAVE_INTERVAL_MS,
  reachedCompletion,
} from "@/lib/watch-types";

/**
 * The lesson player.
 *
 * Responsibilities, all of which are contract items for this sprint:
 *
 * - play a token-signed stream and offer **no** way to download it. There is no
 *   download control, `controlsList` strips the browser's own one, the context
 *   menu is suppressed, and the source is a `no-store` route rather than a file
 *   under `public/`.
 * - resume where the learner left off (`resumeSeconds`, applied once metadata
 *   is known).
 * - persist the position while playing, on pause, on `ended`, and when the tab
 *   goes away (`sendBeacon`, which survives the page being torn down).
 * - flip to "視聴完了" as soon as the end is reached, without waiting for a
 *   round-trip to finish.
 * - explain, precisely, why playback stopped when the signed URL expires —
 *   and offer a one-click way to mint a fresh one.
 */

type Props = {
  chapterId: string;
  chapterTitle: string;
  /** Signed, expiring stream URL minted on the server for this user. */
  src: string;
  /** Unix seconds at which `src` stops working. */
  expiresAt: number;
  /** Second to start from; 0 starts at the top. */
  resumeSeconds: number;
  /** Chapter length as recorded in the catalogue (fallback before metadata). */
  durationHint: number;
  initialCompleted: boolean;
  /**
   * Whether this chapter has attachments below the player. Only changes the
   * wording of the note: the player itself never links to a file.
   */
  hasResources: boolean;
};

type Denial = { reason: string; message: string };

const DENIAL_MESSAGES: Record<string, string> = {
  expired: "再生URLの有効期限が切れました。新しい再生URLを取得してください。",
  invalid: "再生トークンが無効です。ページを開き直してください。",
  malformed: "再生トークンの形式が不正です。ページを開き直してください。",
  missing: "再生トークンがありません。ページを開き直してください。",
  unauthenticated: "セッションが切れました。もう一度ログインしてください。",
  "not-purchased": "このコースを購入したアカウントでのみ再生できます。",
  "not-found": "チャプターが見つかりません。",
  "source-missing": "動画ファイルが見つかりません。",
  "server-error": "動画の配信に失敗しました。",
};

export function VideoPlayer({
  chapterId,
  chapterTitle,
  src: srcProp,
  expiresAt: expiresAtProp,
  resumeSeconds: resumeSecondsProp,
  durationHint,
  initialCompleted,
  hasResources,
}: Props) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  /*
   * The signed URL is pinned for the lifetime of this player.
   *
   * `router.refresh()` (fired when a chapter completes) re-runs the server
   * component, which mints a *new* token — feeding that straight into
   * `<video src>` would swap the source mid-playback and bounce the learner
   * back to 0:00. The page passes `key={chapter.id}`, so switching chapters
   * still mounts a fresh player with a fresh token.
   */
  const [pinned] = useState(() => ({
    src: srcProp,
    expiresAt: expiresAtProp,
    resumeSeconds: resumeSecondsProp,
  }));
  const { src, expiresAt, resumeSeconds } = pinned;

  const [completed, setCompleted] = useState(initialCompleted);
  const [denial, setDenial] = useState<Denial | null>(null);
  const [resumed, setResumed] = useState(false);
  /*
   * Null until the first client tick. The countdown is a live clock, so
   * seeding it during render would make the server's value and the browser's
   * disagree by whatever the round-trip took — a hydration mismatch.
   */
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Mutable playback bookkeeping — deliberately refs, so the throttling logic
  // never re-renders the player mid-playback.
  const lastSavedAt = useRef(0);
  const completedRef = useRef(initialCompleted);
  const appliedResume = useRef(false);

  /** Fire-and-forget POST of the current position. */
  const save = useCallback(
    (positionSeconds: number, durationSeconds: number, isComplete: boolean) => {
      lastSavedAt.current = Date.now();
      const body = JSON.stringify({
        chapterId,
        positionSeconds,
        durationSeconds,
        completed: isComplete,
      });

      void fetch("/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch((error) => {
        console.error("progress save failed", error);
      });
    },
    [chapterId]
  );

  /** Snapshot of the element, guarded against NaN metadata. */
  const snapshot = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const position = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : durationHint;
    return { position, duration };
  }, [durationHint]);

  const markCompleted = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setCompleted(true);
    // Refresh so the chapter rail and the course percentage catch up without a
    // manual reload.
    router.refresh();
  }, [router]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || appliedResume.current) return;
    appliedResume.current = true;

    if (resumeSeconds > 0 && resumeSeconds < video.duration - 0.5) {
      try {
        video.currentTime = resumeSeconds;
        setResumed(true);
      } catch (error) {
        console.error("resume failed", error);
      }
    }
  }, [resumeSeconds]);

  const handleTimeUpdate = useCallback(() => {
    const state = snapshot();
    if (!state) return;

    const nowComplete = reachedCompletion(state.position, state.duration);

    // Completion is written through immediately; ordinary positions are
    // throttled so a 20-minute lesson is a handful of writes, not thousands.
    if (nowComplete && !completedRef.current) {
      save(state.position, state.duration, true);
      markCompleted();
      return;
    }

    if (Date.now() - lastSavedAt.current >= PROGRESS_SAVE_INTERVAL_MS) {
      save(state.position, state.duration, completedRef.current);
    }
  }, [markCompleted, save, snapshot]);

  const handlePause = useCallback(() => {
    const state = snapshot();
    if (state) save(state.position, state.duration, completedRef.current);
  }, [save, snapshot]);

  const handleEnded = useCallback(() => {
    const state = snapshot();
    save(state?.position ?? durationHint, state?.duration ?? durationHint, true);
    markCompleted();
  }, [durationHint, markCompleted, save, snapshot]);

  /**
   * `<video>` only ever reports a generic MEDIA_ERR_NETWORK, so the real reason
   * is fetched from the stream route itself: the deny responses carry it in
   * `x-playback-denied`.
   */
  const handleError = useCallback(async () => {
    try {
      const response = await fetch(src, { method: "HEAD", cache: "no-store" });
      if (response.ok) return;
      const reason = response.headers.get("x-playback-denied") ?? "server-error";
      setDenial({
        reason,
        message: DENIAL_MESSAGES[reason] ?? "動画を再生できませんでした。",
      });
    } catch {
      setDenial({
        reason: "network",
        message: "動画の読み込みに失敗しました。通信環境を確認してください。",
      });
    }
  }, [src]);

  /** Persist on the way out — beacons survive navigation, fetch may not. */
  useEffect(() => {
    const flush = () => {
      const video = videoRef.current;
      if (!video) return;
      const position = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const duration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : durationHint;
      const body = JSON.stringify({
        chapterId,
        positionSeconds: position,
        durationSeconds: duration,
        completed: completedRef.current,
      });

      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/progress",
          new Blob([body], { type: "application/json" })
        );
      }
    };

    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      // Unmounting covers client-side navigation between chapters.
      flush();
    };
  }, [chapterId, durationHint]);

  /** Live countdown for the signed URL. */
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        setDenial((current) =>
          current ?? { reason: "expired", message: DENIAL_MESSAGES.expired }
        );
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  /** Save, then reload so the server mints a fresh signed URL. */
  const renew = useCallback(() => {
    const state = snapshot();
    if (state) save(state.position, state.duration, completedRef.current);
    window.setTimeout(() => window.location.reload(), 120);
  }, [save, snapshot]);

  const expired = secondsLeft === 0;
  const expiryLabel =
    secondsLeft === null
      ? "再生URL 保護中"
      : expired
        ? "再生URLの有効期限切れ"
        : `再生URL 残り ${formatClock(secondsLeft)}`;

  return (
    <div className="player" data-testid="video-player" data-completed={completed}>
      <div className="player__stage">
        <video
          ref={videoRef}
          className="player__video"
          data-testid="lesson-video"
          src={src}
          preload="metadata"
          playsInline
          controls
          // No download button, no remote playback, no PiP window that could be
          // captured to a file. The video is watched here or not at all.
          controlsList="nodownload noplaybackrate noremoteplayback"
          disablePictureInPicture
          onContextMenu={(event) => event.preventDefault()}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPause={handlePause}
          onEnded={handleEnded}
          onError={handleError}
        >
          お使いのブラウザは動画再生に対応していません。
        </video>
      </div>

      <div className="player__bar">
        <div className="player__bar-left">
          <span
            className={`watch-check ${completed ? "watch-check--done" : ""}`}
            data-testid="chapter-completion"
            data-completed={completed ? "true" : "false"}
          >
            {completed ? <CheckIcon /> : <DotIcon />}
            {completed ? "視聴完了" : "未完了"}
          </span>
          {resumed && !completed && (
            <span className="player__resumed" data-testid="resume-notice">
              前回の続き（{formatClock(resumeSeconds)}）から再開しました
            </span>
          )}
        </div>

        <span
          className={`player__expiry ${expired ? "player__expiry--out" : ""}`}
          data-testid="token-expiry"
          data-expired={expired ? "true" : "false"}
          // Locale-formatted dates differ between server and browser, so the
          // tooltip is only attached once the client owns the countdown.
          title={
            secondsLeft === null
              ? undefined
              : `この再生URLは ${new Date(expiresAt * 1000).toLocaleString("ja-JP")} まで有効です`
          }
        >
          <ShieldIcon />
          {expiryLabel}
        </span>
      </div>

      {denial && (
        <p className="player__denial" role="alert" data-testid="playback-error" data-reason={denial.reason}>
          <span>{denial.message}</span>
          {(denial.reason === "expired" || denial.reason === "network") && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={renew}>
              新しい再生URLを取得
            </button>
          )}
        </p>
      )}

      <p className="player__note">
        {"動画はストリーミング配信のみです。再生URLは有効期限付きで、あなたのアカウントに紐付いています。動画のダウンロード・再配布はできません"}
        {hasResources ? "（付属資料はこの下からダウンロードできます）。" : "。"}
      </p>

      <span className="visually-hidden">{chapterTitle}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.75 13 3.5v4.25c0 3-2.1 5.4-5 6.5-2.9-1.1-5-3.5-5-6.5V3.5L8 1.75Z" />
    </svg>
  );
}
