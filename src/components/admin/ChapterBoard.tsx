"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload as TusUpload } from "tus-js-client";
import {
  addChapterAction,
  addResourceAction,
  deleteChapterAction,
  deleteResourceAction,
  moveChapterAction,
  reorderChaptersAction,
  updateChapterAction,
} from "@/app/admin/actions";
import { ActionMessage, FieldError } from "@/components/admin/ActionMessage";
import { IDLE_STATE, LIMITS, type ActionState } from "@/lib/admin-form";
import type { AdminChapter } from "@/lib/admin-courses";

/** What the server knows about a chapter's bunny.net video at render time. */
export type BunnyStatusInfo = {
  /** bunny encode status, or null when the guid is unknown / not set. */
  status: number | null;
  statusLabel: string;
  title: string | null;
  /** Signed preview thumbnail URL on the Stream CDN (short-lived). */
  thumbnailUrl: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChapterBoard({
  courseId,
  chapters,
  bunnyStatuses = {},
}: {
  courseId: string;
  chapters: AdminChapter[];
  bunnyStatuses?: Record<string, BunnyStatusInfo>;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<AdminChapter[]>(chapters);
  const [syncedWith, setSyncedWith] = useState<AdminChapter[]>(chapters);
  const [dragId, setDragId] = useState<string | null>(null);
  const [reorderState, setReorderState] = useState<ActionState>(IDLE_STATE);
  const [reordering, startReorder] = useTransition();

  // Adopt whatever the server just rendered (add / delete / move / reorder).
  // Adjusting state during render is React's supported way to derive from
  // props without the extra paint an effect would cost.
  if (syncedWith !== chapters) {
    setSyncedWith(chapters);
    setOrder(chapters);
  }

  const serverOrder = chapters.map((chapter) => chapter.id).join(",");

  function submitOrder(next: AdminChapter[]) {
    const ids = next.map((chapter) => chapter.id);
    if (ids.join(",") === serverOrder) return;

    startReorder(async () => {
      const result = await reorderChaptersAction(courseId, ids);
      setReorderState(result);
      if (result.status === "error") {
        // Roll the preview back to the last known-good server order.
        setOrder(chapters);
      } else {
        router.refresh();
      }
    });
  }

  function handleDragOver(event: React.DragEvent, overId: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!dragId || dragId === overId) return;

    setOrder((current) => {
      const from = current.findIndex((c) => c.id === dragId);
      const to = current.findIndex((c) => c.id === overId);
      if (from === -1 || to === -1) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  return (
    <div className="chapter-board">
      <div className="chapter-board__head">
        <div>
          <h2 className="display-sm">チャプター</h2>
          <p className="body-sm">
            行をドラッグ、または ↑ / ↓ ボタンで並べ替えられます。順序はそのまま
            受講ページのカリキュラムに反映されます。
          </p>
        </div>
        <span className="badge" data-testid="chapter-count">
          {order.length} 本
        </span>
      </div>

      {reorderState.status !== "idle" && (
        <p
          className={reorderState.status === "error" ? "form-error" : "form-success"}
          role="status"
          data-testid="reorder-message"
        >
          {reorderState.message}
        </p>
      )}

      {order.length === 0 ? (
        <p className="empty-note" data-testid="chapter-empty">
          まだチャプターがありません。下のフォームから最初のチャプターを追加してください。
        </p>
      ) : (
        <ol
          className={`chapter-rows${reordering ? " chapter-rows--busy" : ""}`}
          data-testid="admin-chapter-list"
        >
          {order.map((chapter, index) => (
            <ChapterRow
              key={chapter.id}
              courseId={courseId}
              chapter={chapter}
              bunnyStatus={bunnyStatuses[chapter.id] ?? null}
              index={index}
              total={order.length}
              dragging={dragId === chapter.id}
              onDragStart={() => setDragId(chapter.id)}
              onDragOver={(event) => handleDragOver(event, chapter.id)}
              onDragEnd={() => {
                setDragId(null);
                submitOrder(order);
              }}
            />
          ))}
        </ol>
      )}

      <AddChapterForm courseId={courseId} />
    </div>
  );
}

/* -------------------------------------------------------------------- row */

function ChapterRow({
  courseId,
  chapter,
  bunnyStatus,
  index,
  total,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  courseId: string;
  chapter: AdminChapter;
  bunnyStatus: BunnyStatusInfo | null;
  index: number;
  total: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [editState, editAction, editPending] = useActionState(
    updateChapterAction,
    IDLE_STATE
  );
  const [moveState, moveAction, movePending] = useActionState(
    moveChapterAction,
    IDLE_STATE
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteChapterAction,
    IDLE_STATE
  );

  const titleId = useId();
  const videoIdId = useId();
  const videoUrlId = useId();

  // React resets an uncontrolled form once its action settles, so a rejected
  // submit has to replay what was typed or the panel would blank out.
  const edited = editState.values ?? {};
  const editValue = (name: string, fallback: string) => edited[name] ?? fallback;

  const hasVideoId = chapter.bunnyVideoId.trim() !== "";
  const hasVideoUrl = chapter.videoUrl.trim() !== "";

  return (
    <li
      className={`chapter-row${dragging ? " chapter-row--dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={(event) => event.preventDefault()}
      data-testid={`chapter-row-${chapter.id}`}
      data-position={index + 1}
    >
      <div className="chapter-row__main">
        <span className="chapter-row__grip" aria-hidden="true" title="ドラッグして並べ替え">
          <GripIcon />
        </span>
        <span className="chapter-row__number">{String(index + 1).padStart(2, "0")}</span>

        <div className="chapter-row__text">
          <span className="chapter-row__title" data-testid="chapter-title">
            {chapter.title}
          </span>
          <span className="chapter-row__meta">
            {hasVideoId ? (
              <span
                className="chapter-row__video"
                title="bunny.net 動画ID"
                data-testid="chapter-video-status"
              >
                <code>{chapter.bunnyVideoId}</code>
                {bunnyStatus && (
                  <span
                    className={`encode-pill encode-pill--${
                      bunnyStatus.status === 4
                        ? "done"
                        : bunnyStatus.status === null
                          ? "unknown"
                          : "encoding"
                    }`}
                    data-testid={`chapter-encode-status-${chapter.id}`}
                  >
                    {bunnyStatus.status === 4
                      ? "エンコード完了"
                      : bunnyStatus.status === null
                        ? "ID未確認"
                        : "エンコード中"}
                  </span>
                )}
              </span>
            ) : hasVideoUrl ? (
              <span
                className="chapter-row__video"
                title={chapter.videoUrl}
                data-testid="chapter-video-status"
              >
                動画URL 設定済み
              </span>
            ) : (
              <span
                className="chapter-row__video chapter-row__video--empty"
                data-testid="chapter-video-status"
              >
                動画 未設定
              </span>
            )}
            <span className="chapter-row__dot" aria-hidden="true">
              ·
            </span>
            <span>資料 {chapter.resources.length} 件</span>
          </span>
        </div>

        <div className="chapter-row__actions">
          <form action={moveAction} className="inline-form">
            <input type="hidden" name="courseId" value={courseId} />
            <input type="hidden" name="chapterId" value={chapter.id} />
            <input type="hidden" name="direction" value="up" />
            <button
              type="submit"
              className="icon-btn"
              disabled={index === 0 || movePending}
              aria-label={`${chapter.title} を上へ移動`}
              data-testid={`move-up-${chapter.id}`}
            >
              ↑
            </button>
          </form>
          <form action={moveAction} className="inline-form">
            <input type="hidden" name="courseId" value={courseId} />
            <input type="hidden" name="chapterId" value={chapter.id} />
            <input type="hidden" name="direction" value="down" />
            <button
              type="submit"
              className="icon-btn"
              disabled={index === total - 1 || movePending}
              aria-label={`${chapter.title} を下へ移動`}
              data-testid={`move-down-${chapter.id}`}
            >
              ↓
            </button>
          </form>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setEditing((value) => !value)}
            aria-expanded={editing}
            data-testid={`edit-chapter-${chapter.id}`}
          >
            {editing ? "閉じる" : "編集"}
          </button>
        </div>
      </div>

      {(moveState.status === "error" || deleteState.status === "error") && (
        <p className="form-error" role="alert">
          {moveState.status === "error" ? moveState.message : deleteState.message}
        </p>
      )}

      {editing && (
        <div className="chapter-row__panel">
          <form action={editAction} className="chapter-edit" noValidate>
            <input type="hidden" name="courseId" value={courseId} />
            <input type="hidden" name="chapterId" value={chapter.id} />

            <ActionMessage state={editState} />

            <div className="field">
              <label className="field__label" htmlFor={titleId}>
                チャプター名 <span className="field__required">必須</span>
              </label>
              <input
                id={titleId}
                name="chapterTitle"
                className="input"
                type="text"
                required
                maxLength={LIMITS.chapterTitle}
                defaultValue={editValue("chapterTitle", chapter.title)}
                data-testid={`chapter-title-input-${chapter.id}`}
              />
              <FieldError state={editState} name="chapterTitle" />
            </div>

            <div className="chapter-edit__row">
              <div className="field">
                <label className="field__label" htmlFor={videoIdId}>
                  bunny.net 動画ID
                </label>
                <input
                  id={videoIdId}
                  name="bunnyVideoId"
                  className="input mono-input"
                  type="text"
                  defaultValue={editValue("bunnyVideoId", chapter.bunnyVideoId)}
                  placeholder="0e1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d"
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor={videoUrlId}>
                  動画URL
                </label>
                <input
                  id={videoUrlId}
                  name="videoUrl"
                  className="input mono-input"
                  type="url"
                  defaultValue={editValue("videoUrl", chapter.videoUrl)}
                  placeholder="https://iframe.mediadelivery.net/embed/…"
                />
                <FieldError state={editState} name="videoUrl" />
              </div>
            </div>

            <div className="chapter-edit__actions">
              <button
                type="submit"
                className="btn btn--primary btn--sm"
                disabled={editPending}
                data-testid={`save-chapter-${chapter.id}`}
              >
                {editPending ? "保存中…" : "チャプターを保存"}
              </button>
            </div>
          </form>

          <VideoUploadPanel chapter={chapter} bunnyStatus={bunnyStatus} />

          <ResourcePanel courseId={courseId} chapter={chapter} />

          <div className="chapter-row__danger">
            {confirming ? (
              <form action={deleteAction} className="inline-form">
                <input type="hidden" name="courseId" value={courseId} />
                <input type="hidden" name="chapterId" value={chapter.id} />
                <span className="body-sm">
                  「{chapter.title}」と付属資料を削除します。元に戻せません。
                </span>
                <button
                  type="submit"
                  className="btn btn--danger btn--sm"
                  disabled={deletePending}
                  data-testid={`confirm-delete-chapter-${chapter.id}`}
                >
                  {deletePending ? "削除中…" : "削除する"}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setConfirming(false)}
                >
                  やめる
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="btn btn--danger-quiet btn--sm"
                onClick={() => setConfirming(true)}
                data-testid={`delete-chapter-${chapter.id}`}
              >
                このチャプターを削除
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------- video upload */

/**
 * Chapter-editor video upload (Sprint 6).
 *
 * The file goes browser → this app → bunny.net Stream; the Bunny access key
 * never leaves the server, so no request the browser makes ever carries it.
 * After the upload finishes, the panel polls the encode status until bunny
 * reports 4 (finished) and then refreshes so the chapter row shows 完了.
 */
function VideoUploadPanel({
  chapter,
  bunnyStatus,
}: {
  chapter: AdminChapter;
  bunnyStatus: BunnyStatusInfo | null;
}) {
  const router = useRouter();
  const fileId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<
    "idle" | "uploading" | "encoding" | "done" | "error"
  >(() => {
    const status = bunnyStatus?.status ?? null;
    if (status === 4) return "done";
    if (status !== null && status !== 5) return "encoding";
    return "idle";
  });
  const [percent, setPercent] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(
    chapter.bunnyVideoId.trim() || null
  );

  const statusEndpoint = `/api/admin/chapters/${chapter.id}/video`;

  const poll = async () => {
    try {
      const response = await fetch(statusEndpoint, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.videoId) setVideoId(payload.videoId);
      if (payload.status === 4) {
        setPhase("done");
        setMessage("エンコードが完了しました。チャプターで再生できます。");
        router.refresh();
        return;
      }
      if (payload.status === 5) {
        setPhase("error");
        setMessage("Bunny Stream でエンコードに失敗しました。ファイルを確認してください。");
        return;
      }
      setPhase("encoding");
      setMessage("エンコード中…完了後に自動で切り替わります。");
    } catch {
      // Transient poll failure — the next tick retries.
    }
  };

  // A chapter that is still encoding when the page loads keeps polling.
  useEffect(() => {
    if (phase !== "encoding") return;
    const timer = window.setInterval(() => void poll(), 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, chapter.id]);

  // Uploads go straight from the browser to bunny.net's TUS endpoint —
  // never through this app's server — because a Vercel Serverless Function
  // cannot accept a request body anywhere close to a real lesson video's
  // size. This route only authorizes the upload and, once it finishes,
  // attaches the resulting video id to the chapter.
  async function upload(file: File) {
    setFileName(file.name);
    setPhase("uploading");
    setPercent(0);
    setMessage(null);

    try {
      const authResponse = await fetch(statusEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "video/mp4",
          fileSize: file.size,
        }),
      });

      if (!authResponse.ok) {
        const detail = await authResponse
          .json()
          .then((payload) => payload.error as string | undefined)
          .catch(() => undefined);
        setPhase("error");
        setMessage(detail ?? "アップロードの準備に失敗しました。");
        return;
      }

      const auth = (await authResponse.json()) as {
        endpoint: string;
        videoId: string;
        libraryId: string;
        signature: string;
        expire: number;
      };

      const tusUpload = new TusUpload(file, {
        endpoint: auth.endpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          AuthorizationSignature: auth.signature,
          AuthorizationExpire: String(auth.expire),
          VideoId: auth.videoId,
          LibraryId: auth.libraryId,
        },
        metadata: {
          filetype: file.type || "video/mp4",
          title: file.name,
        },
        onError: () => {
          setPhase("error");
          setMessage("アップロードに失敗しました。通信環境を確認してください。");
        },
        onProgress: (bytesSent, bytesTotal) => {
          setPercent(Math.round((bytesSent / bytesTotal) * 100));
        },
        onSuccess: async () => {
          setVideoId(auth.videoId);
          try {
            const completeResponse = await fetch(`${statusEndpoint}/complete`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ videoId: auth.videoId }),
            });
            if (!completeResponse.ok) {
              const detail = await completeResponse
                .json()
                .then((payload) => payload.error as string | undefined)
                .catch(() => undefined);
              setPhase("error");
              setMessage(detail ?? "動画の紐付けに失敗しました。");
              return;
            }
          } catch {
            setPhase("error");
            setMessage("動画の紐付けに失敗しました。通信環境を確認してください。");
            return;
          }
          setPercent(100);
          setPhase("encoding");
          setMessage("アップロード完了。エンコード中…");
          window.setTimeout(() => void poll(), 1500);
          router.refresh();
        },
      });

      tusUpload.start();
    } catch {
      setPhase("error");
      setMessage("アップロードの準備に失敗しました。通信環境を確認してください。");
    }
  }

  const label =
    phase === "uploading"
      ? `アップロード中${percent !== null ? ` ${percent}%` : ""}`
      : phase === "encoding"
        ? "エンコード中"
        : phase === "done"
          ? "完了"
          : phase === "error"
            ? "エラー"
            : "待機中";

  return (
    <div className="video-upload" data-testid={`video-upload-${chapter.id}`}>
      <h4 className="title-sm">動画ファイル</h4>
      <p className="caption video-upload__note">
        MP4 / MOV / WebM・2GBまで。アップロードすると Bunny Stream でエンコードされ、
        完了後にこのチャプターで再生できるようになります
        {videoId ? "（現在の動画は新しいファイルで上書きされます）" : ""}。
      </p>

      <div className="video-upload__current">
        {bunnyStatus?.thumbnailUrl && phase !== "uploading" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="video-upload__thumb"
            src={bunnyStatus.thumbnailUrl}
            alt={`${chapter.title} の Bunny Stream サムネイル`}
            data-testid={`video-upload-thumb-${chapter.id}`}
          />
        ) : (
          <span className="video-upload__thumb video-upload__thumb--empty">
            <span className="caption">画像なし</span>
          </span>
        )}
        <div className="video-upload__state">
          <span className="caption">Bunny Stream 動画ID</span>
          {videoId ? (
            <code className="video-upload__guid" data-testid={`video-guid-${chapter.id}`}>
              {videoId}
            </code>
          ) : (
            <span className="caption">未設定</span>
          )}
          {bunnyStatus?.title && phase === "done" && (
            <span className="caption" data-testid={`video-title-${chapter.id}`}>
              「{bunnyStatus.title}」
            </span>
          )}
          <span
            className={`encode-pill encode-pill--${
              phase === "done"
                ? "done"
                : phase === "encoding"
                  ? "encoding"
                  : phase === "error"
                    ? "error"
                    : "unknown"
            }`}
            data-testid={`encode-status-${chapter.id}`}
            data-phase={phase}
          >
            {label}
          </span>
        </div>
      </div>

      {message && (
        <p
          className={phase === "error" ? "form-error" : "form-success"}
          role="status"
          data-testid={`upload-message-${chapter.id}`}
        >
          {message}
        </p>
      )}

      <div className="video-upload__row">
        <label className="file-input" htmlFor={fileId}>
          <input
            ref={inputRef}
            id={fileId}
            className="file-input__native"
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v,.mkv"
            disabled={phase === "uploading" || phase === "encoding"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
            }}
            data-testid={`video-file-${chapter.id}`}
          />
          <span className="btn btn--secondary btn--sm">
            {phase === "uploading" || phase === "encoding"
              ? "処理中…"
              : "動画ファイルを選択"}
          </span>
          <span className="file-input__name">
            {fileName ?? "MP4 / MOV / WebM・2GBまで"}
          </span>
        </label>
      </div>

      {phase === "uploading" && (
        <div className="video-upload__progress" role="progressbar">
          <span
            className="video-upload__progress-fill"
            style={{ width: `${percent ?? 0}%` }}
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- resources */

function ResourcePanel({
  courseId,
  chapter,
}: {
  courseId: string;
  chapter: AdminChapter;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const labelId = useId();
  const fileId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  // Clearing happens inside the action (an event context), not in an effect:
  // a successful upload empties the picker so the next file starts clean.
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await addResourceAction(previous, formData);
      if (result.status === "success") {
        formRef.current?.reset();
        setFileName(null);
      }
      return result;
    },
    IDLE_STATE
  );

  const [deleteState, deleteAction] = useActionState(
    deleteResourceAction,
    IDLE_STATE
  );

  return (
    <div className="resource-panel">
      <h4 className="title-sm">付属資料</h4>

      {chapter.resources.length > 0 && (
        <ul className="resource-list" data-testid={`resource-list-${chapter.id}`}>
          {chapter.resources.map((resource) => (
            <li key={resource.id} className="resource-list__item">
              <a
                className="resource-list__link"
                href={`/api/uploads/${resource.uploadId}`}
                download={resource.fileName}
              >
                <FileIcon />
                <span className="resource-list__label">{resource.label}</span>
              </a>
              <span className="resource-list__meta">
                {resource.fileName} · {formatBytes(resource.sizeBytes)}
              </span>
              <form action={deleteAction} className="inline-form">
                <input type="hidden" name="courseId" value={courseId} />
                <input type="hidden" name="resourceId" value={resource.id} />
                <button
                  type="submit"
                  className="icon-btn icon-btn--danger"
                  aria-label={`${resource.label} を削除`}
                  data-testid={`delete-resource-${resource.id}`}
                >
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {deleteState.status === "error" && (
        <p className="form-error" role="alert">
          {deleteState.message}
        </p>
      )}

      <form action={formAction} ref={formRef} className="resource-form" noValidate>
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="chapterId" value={chapter.id} />

        <ActionMessage state={state} testId={`resource-message-${chapter.id}`} />

        <div className="resource-form__row">
          <label className="file-input" htmlFor={fileId}>
            <input
              id={fileId}
              name="resourceFile"
              className="file-input__native"
              type="file"
              accept=".pdf,.zip,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.svg,.docx,.xlsx,.pptx"
              onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
              data-testid={`resource-file-${chapter.id}`}
            />
            <span className="btn btn--secondary btn--sm">ファイルを選択</span>
            <span className="file-input__name">
              {fileName ?? "PDF・ZIP・テキストなど 25MB まで"}
            </span>
          </label>

          <input
            id={labelId}
            name="resourceLabel"
            className="input"
            type="text"
            maxLength={LIMITS.resourceLabel}
            defaultValue={state.values?.resourceLabel ?? ""}
            placeholder="表示名（未入力ならファイル名）"
            aria-label="資料の表示名"
            data-testid={`resource-label-${chapter.id}`}
          />

          <button
            type="submit"
            className="btn btn--ink btn--sm"
            disabled={pending}
            data-testid={`upload-resource-${chapter.id}`}
          >
            {pending ? "アップロード中…" : "資料を追加"}
          </button>
        </div>
        <FieldError state={state} name="resourceFile" />
      </form>
    </div>
  );
}

/* ------------------------------------------------------------ add chapter */

function AddChapterForm({ courseId }: { courseId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const videoIdId = useId();
  const videoUrlId = useId();

  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await addChapterAction(previous, formData);
      // Emptying the fields on success keeps the form ready for the next
      // chapter instead of re-submitting the one just added.
      if (result.status === "success") formRef.current?.reset();
      return result;
    },
    IDLE_STATE
  );

  // Same replay as the edit panel: a rejected add keeps every field intact.
  const sent = state.values ?? {};

  return (
    <form
      action={formAction}
      ref={formRef}
      className="add-chapter"
      noValidate
      data-testid="add-chapter-form"
    >
      <input type="hidden" name="courseId" value={courseId} />
      <h3 className="title-md">チャプターを追加</h3>

      <ActionMessage state={state} testId="add-chapter-message" />

      <div className="field">
        <label className="field__label" htmlFor={titleId}>
          チャプター名 <span className="field__required">必須</span>
        </label>
        <input
          id={titleId}
          name="chapterTitle"
          className="input"
          type="text"
          required
          maxLength={LIMITS.chapterTitle}
          defaultValue={sent.chapterTitle ?? ""}
          placeholder="App Router のメンタルモデル"
          aria-invalid={state.fieldErrors.chapterTitle ? "true" : undefined}
          data-testid="new-chapter-title"
        />
        <FieldError state={state} name="chapterTitle" />
      </div>

      <div className="chapter-edit__row">
        <div className="field">
          <label className="field__label" htmlFor={videoIdId}>
            bunny.net 動画ID
          </label>
          <input
            id={videoIdId}
            name="bunnyVideoId"
            className="input mono-input"
            type="text"
            defaultValue={sent.bunnyVideoId ?? ""}
            placeholder="0e1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d"
            data-testid="new-chapter-video-id"
          />
          <span className="field__hint">
            bunny.net Stream にアップロード済みの動画GUID。
          </span>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={videoUrlId}>
            動画URL
          </label>
          <input
            id={videoUrlId}
            name="videoUrl"
            className="input mono-input"
            type="url"
            defaultValue={sent.videoUrl ?? ""}
            placeholder="https://iframe.mediadelivery.net/embed/…"
            data-testid="new-chapter-video-url"
          />
          <FieldError state={state} name="videoUrl" />
        </div>
      </div>

      <button
        type="submit"
        className="btn btn--primary"
        disabled={pending}
        data-testid="add-chapter-submit"
      >
        {pending ? "追加中…" : "チャプターを追加"}
      </button>
    </form>
  );
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="3" r="1.3" />
      <circle cx="8" cy="3" r="1.3" />
      <circle cx="2" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="2" cy="13" r="1.3" />
      <circle cx="8" cy="13" r="1.3" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z" />
      <path d="M9 1.5V5.5H13" />
    </svg>
  );
}
