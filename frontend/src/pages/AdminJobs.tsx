import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PageContainer } from '@/components/AppLayout';
import { PageHeader } from '@/components/common/PageHeader';
import { LoadingRows, ErrorState, EmptyState } from '@/components/common/states';
import { adminOverview, type JobsOverview } from '@/lib/enhancementJobs';
import { ApiError } from '@/lib/apiClient';
import type { FunctionComponent } from '@/common/types';

const POLL_MS = 15000;

const STATUS_CLASS: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  processing: 'bg-[--yellow]/40 text-[#7a5b06]',
  ready: 'bg-[--mint] text-[--mint-dark]',
  failed: 'bg-destructive/10 text-destructive',
};

const COUNT_CARDS: Array<{ key: keyof JobsOverview['counts']; label: string; icon: FunctionComponent }> = [
  { key: 'queued', label: 'Queued', icon: <Clock className="size-5" /> },
  { key: 'processing', label: 'Processing', icon: <Loader2 className="size-5" /> },
  { key: 'ready', label: 'Ready', icon: <CheckCircle2 className="size-5" /> },
  { key: 'failed', label: 'Failed', icon: <AlertTriangle className="size-5" /> },
];

export const AdminJobs = (): FunctionComponent => {
  const [overview, setOverview] = useState<JobsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    adminOverview()
      .then(setOverview)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load job status.'));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader title="Job tracker" description="Enhancement processing across the platform, updated automatically." />

        {error && <ErrorState message={error} onRetry={load} />}

        {!error && !overview && <LoadingRows rows={4} />}

        {!error && overview && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {COUNT_CARDS.map((c) => (
                <div key={c.key} className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-card">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">{c.icon}</span>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{overview.counts[c.key]}</p>
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold text-foreground">Recent jobs</h2>
              {overview.recent.length === 0 ? (
                <EmptyState title="No jobs yet." />
              ) : (
                <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-semibold">Reference</th>
                        <th className="px-4 py-3 font-semibold">Submitter</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Submitted</th>
                        <th className="px-4 py-3 font-semibold">Processing started</th>
                        <th className="px-4 py-3 font-semibold">Completed</th>
                        <th className="px-4 py-3 font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {overview.recent.map((job) => (
                        <tr key={job.id} className="border-b last:border-0">
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">{job.reference}</td>
                          <td className="whitespace-nowrap px-4 py-3">{job.user?.displayName || job.user?.email || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${STATUS_CLASS[job.status] ?? ''}`}>
                              {job.status}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {job.submittedAt ? new Date(job.submittedAt).toLocaleString() : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {job.processingStartedAt ? new Date(job.processingStartedAt).toLocaleString() : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}
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
            </div>
          </>
        )}
      </div>
    </PageContainer>
  );
};
