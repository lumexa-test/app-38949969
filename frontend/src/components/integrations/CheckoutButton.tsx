// INTEGRATION KIT — Stripe (frontend: the checkout trigger).
//
// Staged verbatim, then IMPORTED AND WIRED by the agent into the app's real
// domain flow (see the kit's `instruction`) — this component never appears
// anywhere on its own. Nothing about payment exists in the app before this.
//
// Deliberately GENERIC: it knows nothing about Booking/Order/whatever this
// app calls its domain record. `referenceType`/`referenceId` are the only
// link back to it — the agent supplies those from the real page it's used on.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient, ApiError } from '@/lib/apiClient';

export interface CheckoutLineItem {
  name: string;
  /** Smallest currency unit — $12.50 is 1250. */
  amountCents: number;
  quantity?: number;
  description?: string;
}

export interface CheckoutButtonProps {
  items: CheckoutLineItem[];
  /** What this payment is for, e.g. "Booking". The ONLY link back to the
   *  app's own record — required for the payment to ever be fulfilled. */
  referenceType: string;
  referenceId: string;
  customerEmail?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  /** Called on a failure BEFORE redirect (network/validation/not-configured).
   *  Render it with whatever inline-error pattern the surrounding page uses. */
  onError?: (message: string) => void;
}

export function CheckoutButton({
  items,
  referenceType,
  referenceId,
  customerEmail,
  label = 'Pay now',
  className,
  disabled,
  onError,
}: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);

  const startCheckout = async (): Promise<void> => {
    if (items.length === 0) return;
    setLoading(true);
    try {
      const successUrl = `${window.location.origin}${window.location.pathname}?payment=success`;
      const cancelUrl = `${window.location.origin}${window.location.pathname}?payment=canceled`;
      const res = await apiClient.post<{ url: string }>('/api/payments/checkout', {
        items,
        successUrl,
        cancelUrl,
        referenceType,
        referenceId,
        ...(customerEmail ? { customerEmail } : {}),
      });
      window.location.href = res.url;
    } catch (e) {
      onError?.(e instanceof ApiError ? e.message : 'Could not start checkout');
      setLoading(false);
    }
  };

  return (
    <Button onClick={() => void startCheckout()} disabled={disabled || loading || items.length === 0} className={className}>
      {loading ? 'Redirecting…' : label}
    </Button>
  );
}

export default CheckoutButton;
