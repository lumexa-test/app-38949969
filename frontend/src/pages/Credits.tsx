import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/components/AppLayout';
import { PageHeader } from '@/components/common/PageHeader';
import { LoadingRows, ErrorState, EmptyState } from '@/components/common/states';
import { CheckoutButton } from '@/components/integrations/CheckoutButton';
import { PaymentStatusBanner } from '@/components/integrations/PaymentStatusBanner';
import { CREDIT_PACKS, getCreditsSummary, type CreditTransaction } from '@/lib/credits';
import { useAuthStore } from '@/store/authStore';
import { ApiError } from '@/lib/apiClient';
import type { FunctionComponent } from '@/common/types';

const TYPE_LABEL: Record<string, string> = {
  signup_grant: 'Free credits',
  purchase: 'Purchase',
  enhancement_spend: 'Enhancement',
  refund: 'Refund',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export const Credits = (): FunctionComponent => {
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<CreditTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const user = useAuthStore((s) => s.user);

  const load = (): void => {
    setBalance(null);
    setHistory(null);
    setError(null);
    getCreditsSummary()
      .then((res) => {
        setBalance(res.balance);
        setHistory(res.items);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load your credits.'));
  };

  useEffect(load, []);

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader title="Credits & billing" description="Manage your credit balance and buy more when you need them." />

        {sessionId && (
          <PaymentStatusBanner sessionId={sessionId} onPaid={load} />
        )}

        {error && <ErrorState message={error} onRetry={load} />}

        {!error && (
          <>
            <div className="rounded-lg border bg-card p-5 shadow-card">
              <p className="text-sm text-muted-foreground">Current balance</p>
              <p className="mt-1 text-3xl font-bold text-foreground">
                {balance === null ? '—' : balance} <span className="text-base font-medium text-muted-foreground">credits</span>
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold text-foreground">Buy more credits</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {CREDIT_PACKS.map((pack) => (
                  <div key={pack.id} className="flex flex-col items-start gap-3 rounded-lg border bg-card p-5 shadow-card">
                    <p className="text-2xl font-bold text-foreground">{pack.credits} credits</p>
                    <p className="text-sm text-muted-foreground">${pack.priceUsd.toFixed(2)} one-time</p>
                    <CheckoutButton
                      items={[{ name: `${pack.credits} credits`, amountCents: pack.priceUsd * 100 }]}
                      referenceType="CreditPack"
                      referenceId={`${pack.id}:${user?.id ?? ''}`}
                      customerEmail={user?.email}
                      label="Buy"
                      className="min-h-[44px] w-full"
                      onError={(msg) => setCheckoutNotice(msg)}
                    />
                  </div>
                ))}
              </div>
              {checkoutNotice && (
                <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">{checkoutNotice}</p>
              )}
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold text-foreground">History</h2>
              {history === null && <LoadingRows rows={4} />}
              {history !== null && history.length === 0 && (
                <EmptyState title="No credit activity yet." />
              )}
              {history !== null && history.length > 0 && (
                <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold">Type</th>
                        <th className="px-4 py-3 font-semibold">Amount</th>
                        <th className="px-4 py-3 font-semibold">Balance after</th>
                        <th className="px-4 py-3 font-semibold">Request</th>
                        <th className="px-4 py-3 font-semibold">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((tx) => (
                        <tr key={tx.id} className="border-b last:border-0">
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(tx.createdAt)}</td>
                          <td className="whitespace-nowrap px-4 py-3">{TYPE_LABEL[tx.type] ?? tx.type}</td>
                          <td className={`whitespace-nowrap px-4 py-3 font-semibold ${tx.amount < 0 ? 'text-destructive' : 'text-[--mint-deep]'}`}>
                            {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">{tx.balanceAfter}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {tx.relatedJob ? (
                              <Link to={`/requests/${tx.relatedJobId}`} className="text-primary hover:underline">
                                {tx.relatedJob.reference}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{tx.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </PageContainer>
  );
};
