"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { createCourseAction, updateCourseAction } from "@/app/admin/actions";
import { ActionMessage, FieldError } from "@/components/admin/ActionMessage";
import { IDLE_STATE, LIMITS } from "@/lib/admin-form";
import { LEVEL_LABEL, type CourseLevel } from "@/lib/course-types";
import type { AdminCourse } from "@/lib/admin-courses";

const LEVEL_OPTIONS: CourseLevel[] = ["beginner", "intermediate", "advanced"];

type Props = {
  mode: "create" | "edit";
  course?: AdminCourse;
  /** Fallback author for a brand-new course. */
  defaultInstructorName?: string;
  /**
   * Signed URL for the currently stored thumbnail. CDN thumbnails sit behind
   * bunny.net token authentication, so the raw stored URL 403s in an <img>;
   * the server signs it (30-day lifetime) before handing it to this client
   * component.
   */
  thumbnailPreviewUrl?: string;
};

export function CourseForm({
  mode,
  course,
  defaultInstructorName = "",
  thumbnailPreviewUrl,
}: Props) {
  const isCreate = mode === "create";
  const [state, formAction, pending] = useActionState(
    isCreate ? createCourseAction : updateCourseAction,
    IDLE_STATE
  );

  const ids = {
    title: useId(),
    subtitle: useId(),
    description: useId(),
    price: useId(),
    level: useId(),
    courseId: useId(),
    thumbnailFile: useId(),
    thumbnailUrl: useId(),
    instructorName: useId(),
    instructorTitle: useId(),
    published: useId(),
  };

  const [thumbnailName, setThumbnailName] = useState<string | null>(null);
  // Object URL of the image the user just picked, so the preview updates
  // before anything is uploaded.
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  const [brokenPreview, setBrokenPreview] = useState<string | null>(null);

  // Revoking on unmount (and whenever a new file replaces the old one) keeps
  // the blob from leaking for the lifetime of the tab.
  useEffect(() => {
    if (!pickedPreview) return;
    return () => URL.revokeObjectURL(pickedPreview);
  }, [pickedPreview]);

  function pickThumbnail(file: File | null) {
    setThumbnailName(file?.name ?? null);
    setPickedPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  // A failed submit re-renders the form; without replaying the submitted
  // values every uncontrolled input would snap back to its defaultValue and
  // the user would lose everything they typed.
  const sent = state.values ?? {};
  const value = (name: string, fallback = "") => sent[name] ?? fallback;

  // React resets the form once the action settles. A <select> does not pick up
  // an updated defaultValue, and a controlled one silently desyncs because the
  // reset changes the DOM without telling React — so the value is re-asserted
  // through a ref after every commit.
  const [level, setLevel] = useState<CourseLevel>(course?.level ?? "beginner");
  const levelRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (levelRef.current && levelRef.current.value !== level) {
      levelRef.current.value = level;
    }
  });
  const [levelEcho, setLevelEcho] = useState<string | null>(null);
  if (sent.level && sent.level !== levelEcho) {
    setLevelEcho(sent.level);
    if ((LEVEL_OPTIONS as string[]).includes(sent.level)) {
      setLevel(sent.level as CourseLevel);
    }
  }

  const savedThumbnail = value("thumbnailUrl", course?.thumbnailUrl ?? "");
  const previewSrc =
    pickedPreview ??
    (thumbnailPreviewUrl && /^(https?:\/\/|\/)/.test(thumbnailPreviewUrl)
      ? thumbnailPreviewUrl
      : /^(https?:\/\/|\/)/.test(savedThumbnail)
        ? savedThumbnail
        : null);
  const showPreview = previewSrc !== null && previewSrc !== brokenPreview;

  return (
    <form action={formAction} className="admin-form" noValidate>
      {!isCreate && course && (
        <>
          <input type="hidden" name="id" value={course.id} />
          <input
            type="hidden"
            name="currentThumbnailUrl"
            value={course.thumbnailUrl}
          />
        </>
      )}

      <ActionMessage state={state} />

      <div className="admin-form__grid">
        <div className="field admin-form__full">
          <label className="field__label" htmlFor={ids.title}>
            タイトル <span className="field__required">必須</span>
          </label>
          <input
            id={ids.title}
            name="title"
            className="input"
            type="text"
            maxLength={LIMITS.title}
            required
            defaultValue={value("title", course?.title ?? "")}
            placeholder="Next.js App Router 実践設計"
            aria-invalid={state.fieldErrors.title ? "true" : undefined}
            data-testid="course-title-input"
          />
          <FieldError state={state} name="title" />
        </div>

        <div className="field admin-form__full">
          <label className="field__label" htmlFor={ids.subtitle}>
            サブタイトル
          </label>
          <input
            id={ids.subtitle}
            name="subtitle"
            className="input"
            type="text"
            maxLength={LIMITS.subtitle}
            defaultValue={value("subtitle", course?.subtitle ?? "")}
            placeholder="一覧カードに表示される 1 行の要約"
          />
          <FieldError state={state} name="subtitle" />
        </div>

        <div className="field admin-form__full">
          <label className="field__label" htmlFor={ids.description}>
            説明文 <span className="field__required">必須</span>
          </label>
          <textarea
            id={ids.description}
            name="description"
            className="input textarea"
            rows={9}
            required
            maxLength={LIMITS.description}
            defaultValue={value("description", course?.description ?? "")}
            placeholder="このコースで扱う内容、対象読者、到達点など。空行で段落が分かれます。"
            aria-invalid={state.fieldErrors.description ? "true" : undefined}
            data-testid="course-description-input"
          />
          <span className="field__hint">
            空行で区切ると、詳細ページで段落として表示されます。
          </span>
          <FieldError state={state} name="description" />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={ids.price}>
            価格（円・税込） <span className="field__required">必須</span>
          </label>
          <input
            id={ids.price}
            name="priceJpy"
            className="input"
            type="number"
            min={0}
            max={LIMITS.priceJpy}
            step={100}
            required
            defaultValue={value("priceJpy", String(course ? course.priceJpy : 9800))}
            aria-invalid={state.fieldErrors.priceJpy ? "true" : undefined}
            data-testid="course-price-input"
          />
          <FieldError state={state} name="priceJpy" />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={ids.level}>
            レベル
          </label>
          <select
            id={ids.level}
            ref={levelRef}
            name="level"
            className="input select"
            value={level}
            onChange={(event) => setLevel(event.target.value as CourseLevel)}
            data-testid="course-level-input"
          >
            {LEVEL_OPTIONS.map((level) => (
              <option key={level} value={level}>
                {LEVEL_LABEL[level]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="level" />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={ids.instructorName}>
            講師名 <span className="field__required">必須</span>
          </label>
          <input
            id={ids.instructorName}
            name="instructorName"
            className="input"
            type="text"
            required
            maxLength={LIMITS.instructorName}
            defaultValue={value("instructorName", course?.instructorName ?? defaultInstructorName)}
            aria-invalid={state.fieldErrors.instructorName ? "true" : undefined}
          />
          <FieldError state={state} name="instructorName" />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={ids.instructorTitle}>
            講師の肩書き
          </label>
          <input
            id={ids.instructorTitle}
            name="instructorTitle"
            className="input"
            type="text"
            maxLength={LIMITS.instructorTitle}
            defaultValue={value("instructorTitle", course?.instructorTitle ?? "")}
            placeholder="フルスタックエンジニア"
          />
          <FieldError state={state} name="instructorTitle" />
        </div>

        {isCreate && (
          <div className="field admin-form__full">
            <label className="field__label" htmlFor={ids.courseId}>
              コースID（URL に使われます）
            </label>
            <input
              id={ids.courseId}
              name="courseId"
              className="input mono-input"
              type="text"
              pattern="[a-z0-9][a-z0-9\-]{1,58}[a-z0-9]"
              defaultValue={value("courseId")}
              placeholder="next-app-router"
              aria-invalid={state.fieldErrors.courseId ? "true" : undefined}
              data-testid="course-id-input"
            />
            <span className="field__hint">
              半角英小文字・数字・ハイフン。未入力の場合は自動生成します。
            </span>
            <FieldError state={state} name="courseId" />
          </div>
        )}

        <div className="field admin-form__full">
          <span className="field__label">サムネイル</span>
          <div className="thumb-picker">
            {showPreview ? (
              <span className="thumb-picker__preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewSrc}
                  alt={pickedPreview ? "選択した画像のプレビュー" : "現在のサムネイル"}
                  onError={() => setBrokenPreview(previewSrc)}
                  data-testid="course-thumbnail-preview"
                />
              </span>
            ) : (
              <span
                className="thumb-picker__preview thumb-picker__preview--empty"
                data-testid="course-thumbnail-preview-empty"
              >
                <span className="caption">未設定</span>
              </span>
            )}

            <div className="thumb-picker__controls">
              <label className="file-input" htmlFor={ids.thumbnailFile}>
                <input
                  id={ids.thumbnailFile}
                  name="thumbnailFile"
                  className="file-input__native"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  onChange={(event) =>
                    pickThumbnail(event.target.files?.[0] ?? null)
                  }
                  data-testid="course-thumbnail-file"
                />
                <span className="btn btn--secondary">画像を選択</span>
                <span className="file-input__name">
                  {thumbnailName ?? "PNG / JPEG / WebP・4MB まで"}
                </span>
              </label>

              <input
                id={ids.thumbnailUrl}
                name="thumbnailUrl"
                className="input mono-input"
                type="text"
                defaultValue={savedThumbnail}
                placeholder="/thumbnails/example.svg または https://…"
                aria-label="サムネイルのパスまたは URL"
                aria-invalid={state.fieldErrors.thumbnailUrl ? "true" : undefined}
                data-testid="course-thumbnail-url"
              />
              <span className="field__hint">
                画像を選ぶとアップロードした画像が優先されます。
              </span>
              <FieldError state={state} name="thumbnailFile" />
              <FieldError state={state} name="thumbnailUrl" />
            </div>
          </div>
        </div>

        <div className="field admin-form__full">
          <label className="switch" htmlFor={ids.published}>
            <input
              id={ids.published}
              name="published"
              type="checkbox"
              defaultChecked={
              state.status === "error"
                ? sent.published === "on"
                : (course?.published ?? false)
            }
              data-testid="course-published-input"
            />
            <span>
              <span className="switch__title">このコースを公開する</span>
              <span className="switch__hint">
                非公開のコースは一般のコース一覧・詳細ページには表示されません。
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="admin-form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={pending}
          data-testid="course-submit"
        >
          {pending ? "保存中…" : isCreate ? "コースを作成" : "変更を保存"}
        </button>
        <Link href="/admin" className="btn btn--secondary">
          管理トップへ戻る
        </Link>
      </div>
    </form>
  );
}
