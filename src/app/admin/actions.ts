"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCreator } from "@/lib/admin-guard";
import {
  AdminError,
  addChapter,
  addChapterResource,
  createCourse,
  deleteChapter,
  deleteChapterResource,
  moveChapter,
  reorderChapters,
  setCoursePublished,
  updateChapter,
  updateCourse,
  chapterCourseId,
  getAdminCourse,
  type ChapterInput,
  type CourseInput,
} from "@/lib/admin-courses";
import {
  findUserByEmail,
  grantPurchase,
  revokePurchase,
} from "@/lib/entitlements";
import {
  COURSE_ID_PATTERN,
  errorState,
  formValues,
  LEVELS,
  LIMITS,
  successState,
  type ActionState,
} from "@/lib/admin-form";
import { saveUpload, UploadError, uploadHref } from "@/lib/uploads";
import {
  BunnyError,
  getBunnyVideo,
  saveThumbnailToStorage,
  storageConfigured,
} from "@/lib/bunny";
import { setChapterDuration } from "@/lib/admin-courses";
import type { CourseLevel } from "@/lib/course-types";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function file(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  if (value && typeof value === "object" && "arrayBuffer" in value) {
    const candidate = value as File;
    return candidate.size > 0 ? candidate : null;
  }
  return null;
}

/** Re-renders every surface a course change can be visible on. */
function revalidateCourse(courseId: string) {
  revalidatePath("/");
  revalidatePath("/courses");
  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/courses/${courseId}`);
}

function describe(
  error: unknown,
  fallback: string,
  formData?: FormData
): ActionState {
  if (
    error instanceof AdminError ||
    error instanceof UploadError ||
    error instanceof BunnyError
  ) {
    return errorState(error.message, {}, formData);
  }
  // A redirect() inside an action throws a framework control-flow error; it
  // must never be caught and turned into a message.
  if (typeof (error as { digest?: unknown })?.digest === "string") {
    throw error;
  }
  console.error(fallback, error);
  return errorState(
    `${fallback} 時間をおいて再度お試しください。`,
    {},
    formData
  );
}

/* ------------------------------------------------------------------ course */

async function readCourseForm(
  formData: FormData,
  { isNew, currentThumbnail }: { isNew: boolean; currentThumbnail: string }
): Promise<
  { ok: true; input: CourseInput } | { ok: false; state: ActionState }
> {
  const fieldErrors: Record<string, string> = {};

  const title = text(formData, "title");
  const subtitle = text(formData, "subtitle");
  const description = text(formData, "description");
  const instructorName = text(formData, "instructorName");
  const instructorTitle = text(formData, "instructorTitle");
  const priceRaw = text(formData, "priceJpy");
  const levelRaw = text(formData, "level");
  const courseId = text(formData, "courseId").toLowerCase();
  const thumbnailUrl = text(formData, "thumbnailUrl");
  const published = formData.get("published") === "on";

  if (!title) fieldErrors.title = "タイトルを入力してください。";
  else if (title.length > LIMITS.title) {
    fieldErrors.title = `タイトルは ${LIMITS.title} 文字以内で入力してください。`;
  }

  if (subtitle.length > LIMITS.subtitle) {
    fieldErrors.subtitle = `サブタイトルは ${LIMITS.subtitle} 文字以内で入力してください。`;
  }

  if (!description) fieldErrors.description = "説明文を入力してください。";
  else if (description.length > LIMITS.description) {
    fieldErrors.description = `説明文は ${LIMITS.description} 文字以内で入力してください。`;
  }

  if (!instructorName) fieldErrors.instructorName = "講師名を入力してください。";
  else if (instructorName.length > LIMITS.instructorName) {
    fieldErrors.instructorName = `講師名は ${LIMITS.instructorName} 文字以内で入力してください。`;
  }

  if (instructorTitle.length > LIMITS.instructorTitle) {
    fieldErrors.instructorTitle = `肩書きは ${LIMITS.instructorTitle} 文字以内で入力してください。`;
  }

  const priceJpy = Number(priceRaw.replace(/[,\s]/g, ""));
  if (priceRaw === "") fieldErrors.priceJpy = "価格を入力してください。";
  else if (!Number.isInteger(priceJpy) || priceJpy < 0) {
    fieldErrors.priceJpy = "価格は 0 以上の整数（円）で入力してください。";
  } else if (priceJpy > LIMITS.priceJpy) {
    fieldErrors.priceJpy = `価格は ${LIMITS.priceJpy.toLocaleString("ja-JP")} 円以下で入力してください。`;
  }

  const level = (LEVELS as string[]).includes(levelRaw)
    ? (levelRaw as CourseLevel)
    : null;
  if (!level) fieldErrors.level = "レベルを選択してください。";

  if (isNew && courseId && !COURSE_ID_PATTERN.test(courseId)) {
    fieldErrors.courseId =
      "コースIDは半角英小文字・数字・ハイフンで 3〜60 文字にしてください。";
  }

  // Thumbnail: an uploaded image wins, otherwise the URL/path field, otherwise
  // (on edit) whatever the course already had. Uploads go to the bunny.net
  // Storage Zone (region-specific API host) and are served through the assets
  // Pull Zone; the local disk store is only a fallback for setups without
  // bunny credentials.
  let thumbnail = thumbnailUrl || currentThumbnail;
  const upload = file(formData, "thumbnailFile");
  if (upload) {
    try {
      if (storageConfigured()) {
        const stored = await saveThumbnailToStorage(upload);
        thumbnail = stored.url;
      } else {
        const saved = await saveUpload(upload, "thumbnail");
        thumbnail = uploadHref(saved.id);
      }
    } catch (error) {
      if (
        error instanceof UploadError ||
        error instanceof BunnyError
      ) {
        fieldErrors.thumbnailFile = error.message;
      } else {
        throw error;
      }
    }
  }

  if (!thumbnail) {
    fieldErrors.thumbnailFile =
      "サムネイル画像をアップロードするか、画像のパス/URL を入力してください。";
  } else if (!upload && !/^(https?:\/\/|\/)/.test(thumbnail)) {
    fieldErrors.thumbnailUrl =
      "サムネイルは / から始まるパス、または http(s) の URL で指定してください。";
  }

  if (Object.keys(fieldErrors).length > 0) {
    const values = formValues(formData);
    // The file itself cannot be replayed into the file input, so if the upload
    // already succeeded we hand its saved path back through the URL field.
    // Otherwise the user would have to pick the image a second time.
    if (upload && !fieldErrors.thumbnailFile) values.thumbnailUrl = thumbnail;
    return {
      ok: false,
      state: errorState("入力内容を確認してください。", fieldErrors, values),
    };
  }

  return {
    ok: true,
    input: {
      id: isNew ? courseId : undefined,
      title,
      subtitle,
      description,
      thumbnailUrl: thumbnail,
      priceJpy,
      instructorName,
      instructorTitle,
      level: level as CourseLevel,
      published,
    },
  };
}

export async function createCourseAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireCreator("/admin/courses/new");

  try {
    const parsed = await readCourseForm(formData, {
      isNew: true,
      currentThumbnail: "",
    });
    if (!parsed.ok) return parsed.state;

    const id = await createCourse(parsed.input);
    revalidateCourse(id);
    redirect(`/admin/courses/${id}?created=1`);
  } catch (error) {
    return describe(error, "コースを作成できませんでした。", formData);
  }
}

export async function updateCourseAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = text(formData, "id");
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    if (!courseId) return errorState("コースIDが指定されていません。", {}, formData);

    const parsed = await readCourseForm(formData, {
      isNew: false,
      currentThumbnail: text(formData, "currentThumbnailUrl"),
    });
    if (!parsed.ok) return parsed.state;

    await updateCourse(courseId, parsed.input);
    revalidateCourse(courseId);
    return successState("コースを保存しました。");
  } catch (error) {
    return describe(error, "コースを保存できませんでした。", formData);
  }
}

export async function togglePublishAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireCreator();

  try {
    const courseId = text(formData, "id");
    const published = text(formData, "published") === "1";
    if (!courseId) return errorState("コースIDが指定されていません。", {}, formData);

    await setCoursePublished(courseId, published);
    revalidateCourse(courseId);
    return successState(
      published
        ? "コースを公開しました。コース一覧に表示されます。"
        : "コースを非公開にしました。コース一覧から外れます。"
    );
  } catch (error) {
    return describe(error, "公開状態を変更できませんでした。", formData);
  }
}

/* ----------------------------------------------------------------- chapter */

/**
 * After a bunny.net video id is attached to a chapter, pulls what bunny knows
 * about the video (duration) into the chapter row and returns the video title
 * so the action can tell the creator it was recognised. A guid bunny does not
 * know (e.g. one of the pre-account demo ids) returns null — playback falls
 * back to the local clip, which is worth saying rather than failing the save.
 */
async function syncBunnyVideoInfo(
  chapterId: string,
  bunnyVideoId: string
): Promise<
  | { outcome: "none" }
  | { outcome: "found"; title: string; lengthSeconds: number }
  | { outcome: "missing" }
> {
  const guid = bunnyVideoId.trim();
  if (!guid) return { outcome: "none" };

  try {
    const video = await getBunnyVideo(guid);
    if (!video) return { outcome: "missing" };
    if (video.lengthSeconds > 0) {
      await setChapterDuration(chapterId, video.lengthSeconds);
    }
    return {
      outcome: "found",
      title: video.title,
      lengthSeconds: video.lengthSeconds,
    };
  } catch (error) {
    console.error("syncBunnyVideoInfo failed", error);
    return { outcome: "missing" };
  }
}

function chapterSavedMessage(
  verb: string,
  title: string,
  sync: Awaited<ReturnType<typeof syncBunnyVideoInfo>>
): string {
  if (sync.outcome === "found") {
    const seconds = sync.lengthSeconds > 0 ? `・${sync.lengthSeconds}秒` : "";
    return `チャプター「${title}」を${verb}しました。Bunny Stream 動画「${sync.title}」（エンコード済み${seconds}）を反映しました。`;
  }
  if (sync.outcome === "missing") {
    return `チャプター「${title}」を${verb}しました。ただし Bunny Stream にこの動画IDが見つからないため、ローカルの代替動画で再生されます。`;
  }
  return `チャプター「${title}」を${verb}しました。`;
}

function readChapterForm(
  formData: FormData
): { ok: true; input: ChapterInput } | { ok: false; state: ActionState } {
  const fieldErrors: Record<string, string> = {};
  const title = text(formData, "chapterTitle");
  const bunnyVideoId = text(formData, "bunnyVideoId");
  const videoUrl = text(formData, "videoUrl");

  if (!title) fieldErrors.chapterTitle = "チャプター名を入力してください。";
  else if (title.length > LIMITS.chapterTitle) {
    fieldErrors.chapterTitle = `チャプター名は ${LIMITS.chapterTitle} 文字以内で入力してください。`;
  }

  if (videoUrl && !/^https?:\/\//.test(videoUrl)) {
    fieldErrors.videoUrl = "動画URLは http(s) で始まる形式で入力してください。";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      state: errorState("入力内容を確認してください。", fieldErrors, formData),
    };
  }

  return { ok: true, input: { title, bunnyVideoId, videoUrl } };
}

export async function addChapterAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = text(formData, "courseId");
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    if (!courseId) return errorState("コースIDが指定されていません。", {}, formData);
    const parsed = readChapterForm(formData);
    if (!parsed.ok) return parsed.state;

    const chapterId = await addChapter(courseId, parsed.input);
    const sync = await syncBunnyVideoInfo(chapterId, parsed.input.bunnyVideoId);
    revalidateCourse(courseId);
    return successState(chapterSavedMessage("追加", parsed.input.title, sync));
  } catch (error) {
    return describe(error, "チャプターを追加できませんでした。", formData);
  }
}

export async function updateChapterAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = text(formData, "courseId");
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    const chapterId = text(formData, "chapterId");
    if (!chapterId) return errorState("チャプターIDが指定されていません。", {}, formData);
    const parsed = readChapterForm(formData);
    if (!parsed.ok) return parsed.state;

    await updateChapter(chapterId, parsed.input);
    const sync = await syncBunnyVideoInfo(chapterId, parsed.input.bunnyVideoId);
    revalidateCourse(courseId || (await chapterCourseId(chapterId)));
    return successState(chapterSavedMessage("保存", parsed.input.title, sync));
  } catch (error) {
    return describe(error, "チャプターを保存できませんでした。", formData);
  }
}

export async function deleteChapterAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = text(formData, "courseId");
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    const chapterId = text(formData, "chapterId");
    if (!chapterId) return errorState("チャプターIDが指定されていません。", {}, formData);

    await deleteChapter(chapterId);
    revalidateCourse(courseId);
    return successState("チャプターを削除しました。");
  } catch (error) {
    return describe(error, "チャプターを削除できませんでした。", formData);
  }
}

export async function moveChapterAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = text(formData, "courseId");
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    const chapterId = text(formData, "chapterId");
    const direction = text(formData, "direction");
    if (!chapterId) return errorState("チャプターIDが指定されていません。", {}, formData);
    if (direction !== "up" && direction !== "down") {
      return errorState("移動方向が不正です。", {}, formData);
    }

    await moveChapter(chapterId, direction);
    revalidateCourse(courseId);
    return successState("チャプターの順序を変更しました。");
  } catch (error) {
    return describe(error, "並べ替えに失敗しました。", formData);
  }
}

/** Drag & drop hands the whole order over at once. */
export async function reorderChaptersAction(
  courseId: string,
  orderedIds: string[]
): Promise<ActionState> {
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    if (!courseId) return errorState("コースIDが指定されていません。");
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return errorState("並び順が指定されていません。");
    }

    await reorderChapters(courseId, orderedIds.map(String));
    revalidateCourse(courseId);
    return successState("チャプターの順序を変更しました。");
  } catch (error) {
    return describe(error, "並べ替えに失敗しました。");
  }
}

/* ---------------------------------------------------------------- resource */

export async function addResourceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = text(formData, "courseId");
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    const chapterId = text(formData, "chapterId");
    if (!chapterId) return errorState("チャプターIDが指定されていません。", {}, formData);

    const upload = file(formData, "resourceFile");
    if (!upload) {
      return errorState(
        "アップロードするファイルを選択してください。",
        { resourceFile: "ファイルが選択されていません。" },
        formData
      );
    }

    const label = text(formData, "resourceLabel").slice(0, LIMITS.resourceLabel);
    const saved = await saveUpload(upload, "resource");
    await addChapterResource(chapterId, saved.id, label || saved.originalName);

    revalidateCourse(courseId);
    return successState(`資料「${label || saved.originalName}」を追加しました。`);
  } catch (error) {
    return describe(error, "資料をアップロードできませんでした。", formData);
  }
}

export async function deleteResourceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = text(formData, "courseId");
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    const resourceId = text(formData, "resourceId");
    if (!resourceId) return errorState("資料IDが指定されていません。", {}, formData);

    await deleteChapterResource(resourceId);
    revalidateCourse(courseId);
    return successState("資料を削除しました。");
  } catch (error) {
    return describe(error, "資料を削除できませんでした。", formData);
  }
}

/* ------------------------------------------------------------ entitlements */

/*
 * ⚠️ 暫定機能（Sprint 3 で正式な決済フローに置き換え予定）
 *
 * Stripe Checkout はまだ実装されていないため、クリエイターが管理画面から手動で
 * 「購入済み」状態を作れるようにしている。書き込み先の `purchase` テーブルは
 * Sprint 3 でも同じものを使う想定で、Stripe Webhook が provider='stripe' として
 * 同じ行を作る。したがって置き換え時に消えるのはこの2つのアクションと
 * AccessPanel の UI だけで、視聴側のロジックには一切手を入れなくてよい。
 */

export async function grantPurchaseAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = text(formData, "courseId");
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    if (!courseId) return errorState("コースIDが指定されていません。", {}, formData);

    const email = text(formData, "email");
    if (!email) {
      return errorState(
        "メールアドレスを入力してください。",
        { email: "メールアドレスを入力してください。" },
        formData
      );
    }

    const account = await findUserByEmail(email);
    if (!account) {
      return errorState(
        `${email} のアカウントが見つかりません。`,
        { email: "このメールアドレスのアカウントは存在しません。" },
        formData
      );
    }

    const course = await getAdminCourse(courseId);
    if (!course) return errorState("コースが見つかりません。", {}, formData);

    await grantPurchase({
      userId: account.id,
      courseId,
      amountJpy: course.priceJpy,
      provider: "manual",
      providerRef: "",
    });

    revalidateCourse(courseId);
    return successState(`${account.email} を購入済みにしました。`);
  } catch (error) {
    return describe(error, "購入済みに設定できませんでした。", formData);
  }
}

export async function revokePurchaseAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const courseId = text(formData, "courseId");
  await requireCreator(`/admin/courses/${courseId}`);

  try {
    const userId = text(formData, "userId");
    if (!courseId || !userId) {
      return errorState("解除する対象が指定されていません。", {}, formData);
    }

    const removed = await revokePurchase(userId, courseId);
    if (!removed) return errorState("購入記録が見つかりませんでした。", {}, formData);

    revalidateCourse(courseId);
    return successState("購入済み設定を解除しました。");
  } catch (error) {
    return describe(error, "購入済み設定を解除できませんでした。", formData);
  }
}
