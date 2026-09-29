import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/AppLayout';
import { EmptyState, ErrorState } from '@/components/common/states';
import { optionLabel } from '@/lib/correctionOptions';
import { listMine, type EnhancementJob } from '@/lib/enhancementJobs';
import { ApiError } from '@/lib/apiClient';
import { useAuthStore } from '@/store/authStore';
import type { FunctionComponent } from '@/common/types';

const STATUS_CLASS: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  processing: 'bg-[--yellow]/40 text-[#7a5b06]',
  ready: 'bg-[--mint] text-[--mint-dark]',
  failed: 'bg-destructive/10 text-destructive',
};

export const Dashboard = (): FunctionComponent => {
  const { user } = useAuthStore();
  const [jobs, setJobs] = useState<EnhancementJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    setJobs(null);
    setError(null);
    listMine()
      .then((res) => setJobs(res.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load your requests.'));
  };

  useEffect(load, []);

  const displayName = user?.displayName || user?.email || 'there';

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Welcome back, {displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Here&rsquo;s what&rsquo;s happening with your photos.</p>
          </div>
          <span className="rounded-full bg-[--mint] px-4 py-2 text-sm font-bold text-[--mint-dark]">
            {user?.creditBalance ?? 0} credits
          </span>
        </div>

        <Link
          to="/enhance/new"
          className="flex items-center justify-between gap-4 rounded-lg border bg-card p-5 shadow-card transition-transform hover:-translate-y-0.5 hover:shadow-float"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <ImagePlus className="size-5" />
            </span>
            <div>
              <p className="font-semibold text-foreground">New enhancement</p>
              <p className="text-sm text-muted-foreground">Upload a photo and get a natural-looking result.</p>
            </div>
          </div>
          <Sparkles className="size-5 shrink-0 text-primary" />
        </Link>

        <div>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Your requests</h2>

          {error && <ErrorState message={error} onRetry={load} />}

          {!error && jobs === null && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full rounded-lg" />
              ))}
            </div>
          )}

          {!error && jobs !== null && jobs.length === 0 && (
            <EmptyState
              title="No enhancements yet"
              description="Upload a photo to see the difference."
              action={
                <Button asChild>
                  <Link to="/enhance/new">New enhancement</Link>
                </Button>
              }
            />
          )}

          {!error && jobs !== null && jobs.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {jobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/requests/${job.id}`}
                  className="group overflow-hidden rounded-lg border bg-card shadow-card transition-transform hover:-translate-y-0.5 hover:shadow-float"
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
                    <img
                      src={job.status === 'ready' && job.resultImagePath ? job.resultImagePath : job.photoUrl}
                      alt={`Enhancement request ${job.reference}`}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{job.reference}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${STATUS_CLASS[job.status] ?? ''}`}>
                        {job.status}
                      </span>
                    </div>
                    <p className="truncate text-sm text-foreground">
                      {job.selectedOptions.slice(0, 2).map(optionLabel).join(', ')}
                      {job.selectedOptions.length > 2 ? ` +${job.selectedOptions.length - 2}` : ''}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{job.creditsCharged} credit</span>
                      <span>{job.submittedAt ? new Date(job.submittedAt).toLocaleDateString() : ''}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
};
