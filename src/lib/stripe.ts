import Stripe from "stripe";

/**
 * Stripe integration (Sprint 3).
 *
 * Checkout uses the hosted Stripe Checkout page in `payment` mode — the app
 * never sees card details. Courses are mapped to pre-created Prices in the
 * Stripe dashboard (docs/stripe-products.md); each Product carries
 * `metadata.courseId` so the two catalogues stay linkable.
 *
 * There is no webhook in this deployment: the success URL carries the Checkout
 * Session id back to the app, which verifies it against the Stripe API before
 * recording the purchase. Every write is idempotent on (user, course), so a
 * replayed or forged session id cannot corrupt entitlements.
 */

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  // Pin to the SDK's default version so API responses stay stable across
  // dependency upgrades.
  typescript: true,
});

/** courseId → Stripe Price id (one-off payment, JPY). Test-mode account. */
const STRIPE_PRICE_BY_COURSE: Record<string, string> = {
  "next-app-router": "price_1U4xOu2M1J7YK37IpyHSMo7q",
  "typescript-type-design": "price_1U4xOv2M1J7YK37Ih2ckXrBS",
  "sqlite-turso-edge": "price_1U4xOw2M1J7YK37IMCId2ACi",
  "auth-from-scratch": "price_1U4xOx2M1J7YK37I1aCoxOow",
  "design-tokens-for-devs": "price_1U4xOy2M1J7YK37ITriEnKWa",
};

/** The Price id a course is sold through, or null when it has none yet. */
export function priceIdForCourse(courseId: string): string | null {
  return STRIPE_PRICE_BY_COURSE[courseId] ?? null;
}

export type CheckoutSessionInput = {
  courseId: string;
  courseTitle: string;
  userId: string;
  userEmail: string;
  origin: string;
};

/**
 * Creates a one-off Checkout Session. `metadata` (userId/courseId) is what the
 * success page later verifies, so a session created for one account cannot be
 * redeemed by another.
 */
export async function createCourseCheckoutSession(
  input: CheckoutSessionInput
): Promise<Stripe.Checkout.Session> {
  const priceId = priceIdForCourse(input.courseId);
  if (!priceId) {
    throw new Error(`このコースは現在購入できません: ${input.courseId}`);
  }

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    // Product names/prices come from Stripe; the course title is attached as
    // metadata purely for traceability in the dashboard.
    client_reference_id: input.userId,
    customer_email: input.userEmail,
    metadata: {
      userId: input.userId,
      courseId: input.courseId,
    },
    success_url: `${input.origin}/courses/${input.courseId}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/courses/${input.courseId}?canceled=1`,
  });
}

export type VerifiedPurchase = {
  sessionId: string;
  userId: string;
  courseId: string;
  amountJpy: number;
};

export class PurchaseVerificationError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "not-found"
      | "not-paid"
      | "wrong-user"
      | "wrong-course"
  ) {
    super(message);
    this.name = "PurchaseVerificationError";
  }
}

/**
 * Confirms a Checkout Session id really belongs to a completed payment for
 * this user and course. Throws PurchaseVerificationError otherwise — the
 * caller must not record a purchase on failure.
 */
export async function verifyCheckoutSession(
  sessionId: string,
  expect: { userId: string; courseId: string }
): Promise<VerifiedPurchase> {
  const session = await stripe.checkout.sessions
    .retrieve(sessionId)
    .catch(() => {
      throw new PurchaseVerificationError(
        "決済セッションを検証できませんでした。",
        "not-found"
      );
    });

  if (session.metadata?.userId !== expect.userId) {
    throw new PurchaseVerificationError(
      "この決済は現在のアカウントのものではありません。",
      "wrong-user"
    );
  }
  if (session.metadata?.courseId !== expect.courseId) {
    throw new PurchaseVerificationError(
      "この決済はこのコースのものではありません。",
      "wrong-course"
    );
  }
  if (session.payment_status !== "paid") {
    throw new PurchaseVerificationError(
      "決済が完了していません。",
      "not-paid"
    );
  }

  // JPY has no minor unit, so amount_total is already yen.
  const amountJpy =
    typeof session.amount_total === "number" ? session.amount_total : 0;

  return {
    sessionId: session.id,
    userId: expect.userId,
    courseId: expect.courseId,
    amountJpy,
  };
}
