import Link from "next/link";
import Image from "next/image";
import { formatPrice, LEVEL_LABEL, type Course } from "@/lib/course-types";

export function CourseCard({ course, priority = false }: { course: Course; priority?: boolean }) {
  return (
    <article className="course-card">
      <Link href={`/courses/${course.id}`} aria-label={`${course.title} の詳細を見る`}>
        <div className="course-card__media">
          <Image
            src={course.thumbnailUrl}
            alt={`${course.title} のサムネイル`}
            width={640}
            height={360}
            priority={priority}
            // Token-protected CDN thumbnails are fetched as-is (see
            // src/lib/courses.ts — signedAssetsUrl).
            unoptimized
          />
        </div>
        <div className="course-card__body">
          <h3 className="course-card__title">{course.title}</h3>
          <p className="course-card__subtitle">{course.subtitle}</p>
          <div className="course-card__meta">
            {/* The badge lives in the body rather than over the artwork: the
                thumbnails carry their own chrome text at the top-left. */}
            <span className={`badge badge--${course.level}`}>
              {LEVEL_LABEL[course.level]}
            </span>
            <span className="course-card__chapters">
              {course.chapterCount} チャプター
            </span>
            <span className="course-card__price" data-testid="course-price">
              {formatPrice(course.priceJpy)}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
