import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/AppLayout';
import { PageHeader } from '@/components/common/PageHeader';
import { LoadingRows, ErrorState, EmptyState } from '@/components/common/states';
import { optionLabel } from '@/lib/correctionOptions';
import { listAdmin, type EnhancementJob, type JobStatus } from '@/lib/enhancementJobs';
import { ApiError } from '@/lib/apiClient';
import type { FunctionComponent } from '@/common/types';

const TABS: Array<{ key: JobStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'queued', label: 'Queued' },
  { key: 'processing', label: 'Processing' },
  { key: 'ready', label: 'Ready' },
  { key: 'failed', label: 'Failed' },
];

const STATUS_CLASS: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  processing: 'bg-[--yellow]/40 text-[#7a5b06]',
  ready: 'bg-[--mint] text-[--mint-dark]',
  failed: 'bg-destructive/10 text-destructive',
};

export const AdminRequests = (): FunctionComponent => {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<EnhancementJob[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    setItems(null);
    setError(null);
    listAdmin({ status: tab === 'all' ? undefined : tab, page })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load requests.'));
  };

  useEffect(load, [tab, page]);

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader title="Request monitor" description={`${total} enhancement request${total === 1 ? '' : 's'} across the platform.`} />

        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setTab(t.key); setPage(1); }}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                tab === t.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <ErrorState message={error} onRetry={load} />}

        {!error && items === null && <LoadingRows rows={8} />}

        {!error && items !== null && items.length === 0 && (
          <EmptyState title="No requests match this filter." />
        )}

        {!error && items !== null && items.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Photo</th>
                  <th className="px-4 py-3 font-semibold">Submitter</th>
                  <th className="px-4 py-3 font-semibold">Corrections</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Credits</th>
                  <th className="px-4 py-3 font-semibold">Submitted</th>
                  <th className="px-4 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {items.map((job) => (
                  <tr key={job.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <img src={job.photoUrl} alt="" className="size-10 rounded-md object-cover" />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">
                      {job.user?.displayName || job.user?.email || '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {job.selectedOptions.slice(0, 2).map(optionLabel).join(', ')}
                      {job.selectedOptions.length > 2 ? ` +${job.selectedOptions.length - 2}` : ''}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${STATUS_CLASS[job.status] ?? ''}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{job.creditsCharged}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {job.submittedAt ? new Date(job.submittedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link to={`/requests/${job.id}`} className="font-semibold text-primary hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && items !== null && items.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </PageContainer>
  );
};
