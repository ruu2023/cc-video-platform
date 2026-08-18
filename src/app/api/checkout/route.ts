import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getPublishedCourse } from "@/lib/courses";
import { hasPurchased } from "@/lib/entitlements";
import {
  createCourseCheckoutSession,
  priceIdForCourse,
} from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * Starts a Stripe Checkout session for one course.
 *
 * The course detail page posts a small form here (progressive enhancement:
 * the button is a real <button> in a real <form>, no client JS required).
 * Every failure mode bounces back to the course page with a query flag so the
 * UI can explain itself instead of dead-ending.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const courseId = String(form?.get("courseId") ?? "").trim();
  const coursePath = courseId ? `/courses/${courseId}` : "/courses";
  const back = (query: string) =>
    NextResponse.redirect(new URL(`${coursePath}${query}`, request.nextUrl.origin), 303);

  if (!courseId) {
    return back("?checkout=invalid");
  }

  const user = await getCurrentUser();
  if (!user) {
    // Same funnel the page-level link uses: send the visitor through login and
    // bring them straight back to this course afterwards.
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(coursePath)}`, request.nextUrl.origin),
      303
    );
  }

  const course = await getPublishedCourse(courseId);
  if (!course) {
    return NextResponse.redirect(new URL("/courses", request.nextUrl.origin), 303);
  }

  // Already entitled? Then there is nothing to sell — never offer a second
  // charge for the same (user, course).
  if (await hasPurchased(user.id, course.id)) {
    return back("?checkout=already-purchased");
  }

  if (!priceIdForCourse(course.id)) {
    return back("?checkout=unavailable");
  }

  try {
    const session = await createCourseCheckoutSession({
      courseId: course.id,
      courseTitle: course.title,
      userId: user.id,
      userEmail: user.email,
      origin: request.nextUrl.origin,
    });

    if (!session.url) {
      return back("?checkout=error");
    }

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    console.error("checkout: failed to create session", error);
    return back("?checkout=error");
  }
}
