// INTEGRATION KIT — Stripe (checkout + webhook).
//
// Staged verbatim when the project owner supplies STRIPE_SECRET_KEY +
// STRIPE_PUBLISHABLE_KEY. REPLACES the not-configured stub the first build left
// here.
//
// LOOSE COUPLING BY DESIGN: this kit owns its own `PaymentSession` table and
// links back to the app's domain through a free-form (referenceType,
// referenceId) pair — e.g. ("Order", "42"). It therefore needs NO knowledge of
// the app's models and adds no column to them. The only app-specific work left
// is deciding what to do when a payment completes, which is why this is the one
// kit that still asks for an agent turn.
//
// WEBHOOKS AND THE RAW BODY: Stripe signs the exact bytes it sent. The global
// express.json() would consume them first, so the webhook router is mounted
// BEFORE the body parser (see the recipe's `position: 'before-body-parser'`)
// and parses its own raw payload.
import { Request, Response, Router } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { prisma } from '../../lib/prisma';
import middleware from '../../middleware';

function secretKey(): string {
  return (process.env.STRIPE_SECRET_KEY ?? '').trim();
}

function webhookSecret(): string {
  return (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
}

/** Construct LAZILY inside the handler — a missing key must never crash boot. */
function client(): Stripe {
  return new Stripe(secretKey());
}

/** True once the owner has supplied STRIPE_SECRET_KEY. Check before calling the helper. */
export function isStripeConfigured(): boolean {
  return Boolean(secretKey());
}

/** Thrown by createCheckoutSession. `message` is user-safe; `status` is the HTTP status to answer with. */
export class StripeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

export interface CheckoutArgs {
  /** At least one priced entry. */
  items: CheckoutItem[];
  /** Absolute URLs; `session_id` is appended to successUrl by the kit. */
  successUrl: string;
  cancelUrl: string;
  /** What this payment is for, e.g. ("Booking", booking.id). Fulfilment looks the record up by this pair. */
  referenceType?: string;
  referenceId?: string;
  customerEmail?: string;
}

export interface CheckoutSession {
  /** Redirect the browser here. */
  url: string | null;
  sessionId: string;
}

/**
 * Create a Stripe Checkout session and record it as a pending PaymentSession.
 * Throws StripeError (503 when not configured, 400 on invalid input).
 */
export async function createCheckoutSession(args: CheckoutArgs): Promise<CheckoutSession> {
  if (!isStripeConfigured()) throw new StripeError(503, 'Stripe is not configured.');

  const items = (args.items ?? []).filter((i) => i && typeof i.name === 'string' && Number(i.amountCents) > 0);
  if (items.length === 0) throw new StripeError(400, 'items must contain at least one priced entry');
  if (!args.successUrl || !args.cancelUrl) throw new StripeError(400, 'successUrl and cancelUrl are required');

  try {
    const session = await client().checkout.sessions.create({
      mode: 'payment',
      line_items: items.map((i) => ({
        quantity: Math.max(1, Math.floor(Number(i.quantity) || 1)),
        price_data: {
          currency: (i.currency || 'usd').toLowerCase(),
          unit_amount: Math.round(Number(i.amountCents)),
          product_data: {
            name: String(i.name),
            ...(i.description ? { description: String(i.description) } : {}),
          },
        },
      })),
      // {CHECKOUT_SESSION_ID} is substituted by Stripe on redirect, so the
      // success page can confirm payment even when webhooks are unavailable.
      success_url: `${args.successUrl}${args.successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: args.cancelUrl,
      ...(args.customerEmail ? { customer_email: args.customerEmail } : {}),
      metadata: {
        ...(args.referenceType ? { referenceType: args.referenceType } : {}),
        ...(args.referenceId ? { referenceId: args.referenceId } : {}),
      },
    });

    await prisma.paymentSession.create({
      data: {
        stripeSessionId: session.id,
        status: 'pending',
        amountTotal: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
        customerEmail: args.customerEmail ?? null,
        referenceType: args.referenceType ?? null,
        referenceId: args.referenceId ?? null,
      },
    });

    return { url: session.url, sessionId: session.id };
  } catch (err) {
    if (err instanceof StripeError) throw err;
    const e = err as { statusCode?: number; message?: string };
    console.error(`[stripe] checkout failed (${e.statusCode ?? '?'}):`, e.message);
    if (e.statusCode === 401) throw new StripeError(503, 'Stripe is not configured.');
    throw new StripeError(502, 'Could not start checkout right now.');
  }
}

function notConfigured(res: Response) {
  return res.status(503).json({
    error: 'integration_not_configured',
    integration: 'Stripe',
    message: 'Stripe API key is not configured.',
  });
}

export interface CheckoutItem {
  name?: string;
  amountCents?: number;
  quantity?: number;
  currency?: string;
  description?: string;
}

// POST /api/payments/checkout
// body { items, successUrl, cancelUrl, referenceType?, referenceId?, customerEmail? }
async function createCheckout(req: Request, res: Response): Promise<any> {
  const body = (req.body ?? {}) as Partial<CheckoutArgs>;
  try {
    return res.json(
      await createCheckoutSession({
        items: body.items ?? [],
        successUrl: body.successUrl ?? '',
        cancelUrl: body.cancelUrl ?? '',
        referenceType: body.referenceType,
        referenceId: body.referenceId,
        customerEmail: body.customerEmail,
      }),
    );
  } catch (err) {
    if (err instanceof StripeError) {
      if (err.status === 503) return notConfigured(res);
      return res.status(err.status).json({ message: err.message });
    }
    console.error('[stripe] unexpected checkout error:', err);
    return res.status(502).json({ message: 'Could not start checkout right now.' });
  }
}

async function getSession(req: Request, res: Response): Promise<any> {
  if (!secretKey()) return notConfigured(res);

  try {
    const session = await client().checkout.sessions.retrieve(String(req.params.id));
    const paid = session.payment_status === 'paid';

    // Keep our row in step even when webhooks are not configured — and FULFIL
    // here too, not just record. The webhook is the fast path, but it is inert
    // whenever STRIPE_WEBHOOK_SECRET is absent (the platform catalog does not
    // collect it today), which makes this lookup the only place a completed
    // payment is ever observed. Marking the row paid without calling
    // onPaymentCompleted would confirm the payment to the user and never act on
    // it — money taken, nothing granted.
    //
    // Same atomic claim the webhook uses: whichever path sees the payment first
    // wins the row, and count 0 means the other already fulfilled it. Running
    // both is safe.
    if (paid) {
      const claimed = await prisma.paymentSession
        .updateMany({
          where: { stripeSessionId: session.id, status: { not: 'paid' } },
          data: { status: 'paid', amountTotal: session.amount_total ?? 0 },
        })
        .catch(() => ({ count: 0 })); // row may not exist on a replayed/foreign session

      if (claimed.count > 0) {
        // Never let a fulfilment failure turn a confirmed payment into a 502 —
        // the charge succeeded either way, and the caller must still be told.
        try {
          await onPaymentCompleted(
            session.metadata?.referenceType ?? null,
            session.metadata?.referenceId ?? null,
            session,
          );
        } catch (err) {
          console.error('[stripe] fulfilment from session lookup failed:', (err as Error).message);
        }
      }
    } else {
      await prisma.paymentSession
        .update({
          where: { stripeSessionId: session.id },
          data: {
            status: session.status ?? 'pending',
            amountTotal: session.amount_total ?? 0,
          },
        })
        .catch(() => undefined); // row may not exist on a replayed/foreign session
    }

    return res.json({
      sessionId: session.id,
      status: paid ? 'paid' : (session.status ?? 'pending'),
      paid,
      amountTotal: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
      customerEmail: session.customer_details?.email ?? null,
      referenceType: session.metadata?.referenceType ?? null,
      referenceId: session.metadata?.referenceId ?? null,
    });
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    console.error(`[stripe] session lookup failed (${e.statusCode ?? '?'}):`, e.message);
    if (e.statusCode === 404) return res.status(404).json({ message: 'Payment session not found.' });
    if (e.statusCode === 401) return notConfigured(res);
    return res.status(502).json({ message: 'Could not check that payment right now.' });
  }
}

// Credit pack definitions mirrored here for fulfilment — kept in sync with
// the pricing in backend/src/api/credits.ts.
const CREDIT_PACKS: Record<string, number> = {
  pack_10: 10,
  pack_30: 30,
  pack_100: 100,
};

/**
 * Called once per successfully completed checkout, AFTER the PaymentSession row
 * is marked paid. This is the app-specific hook: mark the order fulfilled, grant
 * access, send a confirmation. `referenceType`/`referenceId` are whatever the
 * checkout call passed (e.g. "Order" / "42").
 *
 * Called from BOTH the webhook and GET /api/payments/session/:id, whichever
 * observes the completed payment first — the atomic status claim on
 * PaymentSession guarantees exactly one of them runs this. It must not throw:
 * from the webhook a throw would make Stripe retry a payment that already
 * succeeded, and from the session lookup it would fail the success page.
 */
async function onPaymentCompleted(
  referenceType: string | null,
  referenceId: string | null,
  session: Stripe.Checkout.Session,
): Promise<void> {
  console.log(
    `[stripe] payment completed for ${referenceType ?? 'unknown'}:${referenceId ?? 'unknown'} ` +
      `(${session.amount_total ?? 0} ${session.currency ?? 'usd'})`,
  );

  if (referenceType === 'CreditPack' && referenceId) {
    // referenceId format: "{packId}:{userId}" e.g. "pack_10:42"
    const colonIdx = referenceId.indexOf(':');
    if (colonIdx === -1) {
      console.error('[stripe] CreditPack referenceId missing colon separator:', referenceId);
      return;
    }
    const packId = referenceId.slice(0, colonIdx);
    const userId = parseInt(referenceId.slice(colonIdx + 1), 10);
    if (!userId || isNaN(userId)) {
      console.error('[stripe] CreditPack referenceId has invalid userId:', referenceId);
      return;
    }
    const credits = CREDIT_PACKS[packId];
    if (!credits) {
      console.error('[stripe] unknown CreditPack id:', packId);
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: userId },
          data: { creditBalance: { increment: credits } },
        });
        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            tenantId: user.tenantId,
            type: 'purchase',
            amount: credits,
            balanceAfter: user.creditBalance,
            description: `Purchased ${credits} credits`,
          },
        });
      });
      console.log(`[stripe] granted ${credits} credits to user ${userId}`);
    } catch (err) {
      console.error(`[stripe] failed to grant credits (${packId} → user ${userId}):`, (err as Error).message);
    }
  }
}

// POST /api/payments/webhook — raw body, signature-verified.
async function webhook(req: Request, res: Response): Promise<any> {
  if (!secretKey()) return notConfigured(res);

  const secret = webhookSecret();
  if (!secret) {
    // Refuse rather than trusting unsigned input: an unverified webhook lets
    // anyone mark any order paid. The success page's session lookup is the
    // supported path until a signing secret is configured.
    console.error('[stripe] webhook received but STRIPE_WEBHOOK_SECRET is not set — rejecting');
    return res.status(503).json({ message: 'Webhooks are not configured.' });
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) return res.status(400).json({ message: 'Missing stripe-signature header' });

  let event: Stripe.Event;
  try {
    // req.body is a Buffer here because this router mounts ahead of express.json().
    event = client().webhooks.constructEvent(req.body as Buffer, String(signature), secret);
  } catch (err) {
    console.error('[stripe] webhook signature verification failed:', (err as Error).message);
    return res.status(400).json({ message: 'Invalid signature' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      // Idempotency: Stripe retries, and a duplicate must not double-fulfil.
      // updateMany with a status guard is atomic — count 0 means already done.
      const claimed = await prisma.paymentSession.updateMany({
        where: { stripeSessionId: session.id, status: { not: 'paid' } },
        data: { status: 'paid', amountTotal: session.amount_total ?? 0 },
      });

      if (claimed.count > 0) {
        await onPaymentCompleted(
          session.metadata?.referenceType ?? null,
          session.metadata?.referenceId ?? null,
          session,
        );
      }
    }
  } catch (err) {
    // Log and still 200: Stripe retries non-2xx, and the payment itself already
    // succeeded. A stuck retry loop is worse than a logged local failure.
    console.error(`[stripe] handler for ${event.type} failed:`, (err as Error).message);
  }

  return res.json({ received: true });
}

// Mounted at /api/payments/webhook BEFORE express.json() — raw body required.
export const stripeWebhookRouter = Router();
stripeWebhookRouter.post('/', express.raw({ type: 'application/json' }), webhook);

// Mounted at /api/payments with the ordinary API routes.
const router = Router();
router.post('/checkout', middleware.jwtCheck, createCheckout);
router.get('/session/:id', getSession);
export default router;
