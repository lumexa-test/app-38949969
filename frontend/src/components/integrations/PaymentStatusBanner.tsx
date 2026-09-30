// INTEGRATION KIT — Stripe (frontend: post-checkout confirmation).
//
// Staged verbatim, then wired by the agent onto whatever page the browser
// lands on after Stripe redirects back (see CheckoutButton's successUrl).
//
// WHY THIS EXISTS RATHER THAN "just show a success message": arriving at the
// success URL is NOT proof of payment (a user can hit back/reload, or the
// redirect can fire before Stripe's own confirmation settles). This queries
// the AUTHORITATIVE status via GET /api/payments/session/:id and renders
// accordingly — it is the only correct way to confirm a payment client-side.
//
// IT ALSO TRIGGERS FULFILMENT. GET /api/payments/session/:id is not a passive
// read: server-side it claims the PaymentSession row and runs
// onPaymentCompleted (grant the plan, mark the order paid). With no webhook
// secret configured — the platform catalog does not collect one — this request
// is the ONLY thing that ever fulfils a payment. So by the time this banner
// says "confirmed", the server state HAS changed underneath whatever the page
// already loaded, and a page that fetched its subscription/order on mount is
// now showing stale data. That is what `onPaid` is for: wire it to refetch.
import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '@/lib/apiClient';

export interface PaymentStatusBannerProps {
  /** The `session_id` query param Stripe appended to the success URL. */
  sessionId: string;
  /**
   * Called ONCE when the payment confirms paid — refetch whatever the payment
   * changed (`/api/subscriptions/me`, the order, the user's plan). Without it
   * the page keeps rendering the state it loaded before checkout and the user
   * sees "Payment confirmed." next to their old plan. Not called on
   * pending/error.
   */
  onPaid?: () => void;
  className?: string;
}

interface SessionStatus {
  paid: boolean;
  status: string;
  amountTotal: number;
  currency: string;
}

export function PaymentStatusBanner({ sessionId, onPaid, className }: PaymentStatusBannerProps) {
  const [state, setState] = useState<'loading' | 'paid' | 'pending' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  // Held in a ref so an inline arrow from the parent does not re-run the effect
  // — that would re-query the session and fire onPaid on every render.
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<SessionStatus>(`/api/payments/session/${encodeURIComponent(sessionId)}`)
      .then((s) => {
        if (cancelled) return;
        setState(s.paid ? 'paid' : 'pending');
        // After the state flip, so the parent's refetch races nothing here.
        if (s.paid) onPaidRef.current?.();
      })
      .catch((e) => {
        if (cancelled) return;
        setState('error');
        setMessage(e instanceof ApiError ? e.message : 'Could not confirm this payment');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (state === 'loading') {
    return (
      <div className={`flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground ${className ?? ''}`}>
        <Loader2 className="size-4 animate-spin" />
        Confirming your payment…
      </div>
    );
  }
  if (state === 'paid') {
    return (
      <div className={`flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm text-foreground ${className ?? ''}`}>
        <CheckCircle2 className="size-4 text-primary" />
        Payment confirmed.
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground ${className ?? ''}`}>
      <XCircle className="size-4 text-destructive" />
      {state === 'pending' ? 'Payment not completed.' : (message ?? 'Could not confirm this payment.')}
    </div>
  );
}

export default PaymentStatusBanner;
