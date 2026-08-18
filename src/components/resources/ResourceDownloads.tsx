import { formatBytes } from "@/lib/uploads";
import {
  groupByChapter,
  totalResourceBytes,
  type CourseResource,
} from "@/lib/resources";

/**
 * Download surfaces for chapter attachments — the lesson-screen panel and the
 * whole-course list on the course page.
 *
 * Both are plain server components: every link points straight at
 * `/api/uploads/[id]`, which re-checks the entitlement for itself. Rendering a
 * row here is a convenience, never an authorisation.
 */

type RowProps = { resource: CourseResource; showChapter?: boolean };

function ResourceRow({ resource, showChapter = false }: RowProps) {
  return (
    <li
      className="dl-row"
      data-testid={`resource-row-${resource.id}`}
      data-upload-id={resource.uploadId}
    >
      <span className="dl-row__kind" aria-hidden="true">
        {resource.kindLabel}
      </span>

      <span className="dl-row__text">
        <span className="dl-row__label">{resource.label}</span>
        <span className="dl-row__meta">
          {showChapter && (
            <>
              <span className="dl-row__chapter">
                チャプター {String(resource.chapterPosition).padStart(2, "0")}
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="dl-row__file">{resource.fileName}</span>
          <span aria-hidden="true">·</span>
          <span>{formatBytes(resource.sizeBytes)}</span>
        </span>
      </span>

      <a
        className="btn btn--ink btn--sm dl-row__btn"
        href={resource.href}
        download={resource.fileName}
        data-testid={`resource-download-${resource.id}`}
        aria-label={`${resource.label}（${resource.fileName}）をダウンロード`}
      >
        <DownloadIcon />
        ダウンロード
      </a>
    </li>
  );
}

/* ------------------------------------------------------ watch screen panel */

/**
 * The lesson screen's attachment panel. Renders nothing at all when the chapter
 * has no attachments — the contract is that a chapter without resources shows
 * no download affordance whatsoever.
 */
export function ChapterResourcePanel({
  resources,
}: {
  resources: CourseResource[];
}) {
  if (resources.length === 0) return null;

  return (
    <section
      className="dl-panel"
      aria-labelledby="chapter-resources-heading"
      data-testid="chapter-resources-panel"
      data-resource-count={resources.length}
    >
      <header className="dl-panel__head">
        <div>
          <span className="eyebrow">このチャプターの資料</span>
          <h2 id="chapter-resources-heading" className="dl-panel__title">
            ダウンロード資料 {resources.length} 件
          </h2>
        </div>
        <span className="dl-panel__total">
          合計 {formatBytes(totalResourceBytes(resources))}
        </span>
      </header>

      <ul className="dl-list" data-testid="chapter-resource-list">
        {resources.map((resource) => (
          <ResourceRow key={resource.id} resource={resource} />
        ))}
      </ul>

      <p className="dl-panel__note">
        {"資料は購入したアカウントでのみダウンロードできます。リンクを共有しても、他のアカウントからは取得できません。"}
      </p>
    </section>
  );
}

/* --------------------------------------------- course detail: whole course */

/**
 * Every attachment in the course, grouped by chapter. Shown on the course page
 * once the course is owned, so the learner can collect the material without
 * opening each lesson.
 */
export function CourseResourceSection({
  resources,
  courseId,
}: {
  resources: CourseResource[];
  courseId: string;
}) {
  const groups = groupByChapter(resources);

  return (
    <section
      id="course-resources"
      className="course-block"
      data-testid="course-resources"
      data-resource-count={resources.length}
    >
      <h2 className="display-sm course-block__title">
        コース資料（{resources.length} 件）
      </h2>

      {resources.length === 0 ? (
        <p className="notice notice--soft" data-testid="course-resources-empty">
          <FileIcon />
          <span>
            {"このコースにはまだ配布資料が登録されていません。追加されると、ここと各チャプターの視聴画面に表示されます。"}
          </span>
        </p>
      ) : (
        <>
          <div className="dl-groups">
            {groups.map((group) => (
              <div
                key={group.chapterId}
                className="dl-group"
                data-testid={`course-resource-group-${group.chapterId}`}
              >
                <div className="dl-group__head">
                  <span className="dl-group__number" aria-hidden="true">
                    {String(group.chapterPosition).padStart(2, "0")}
                  </span>
                  <a
                    className="dl-group__title"
                    href={`/courses/${courseId}/watch/${group.chapterId}`}
                  >
                    {group.chapterTitle}
                  </a>
                  <span className="dl-group__count">
                    {group.resources.length} 件
                  </span>
                </div>
                <ul className="dl-list">
                  {group.resources.map((resource) => (
                    <ResourceRow key={resource.id} resource={resource} />
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="notice notice--soft">
            <FileIcon />
            <span>
              {`合計 ${formatBytes(totalResourceBytes(resources))}。ダウンロードした資料の再配布はご遠慮ください。`}
            </span>
          </p>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- icons */

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      <path d="M8 2v8" />
      <path d="M4.5 7 8 10.5 11.5 7" />
      <path d="M2.5 13h11" />
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
      style={{ flex: "none", marginTop: "2px" }}
    >
      <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z" />
      <path d="M9 1.5V5.5H13" />
    </svg>
  );
}
