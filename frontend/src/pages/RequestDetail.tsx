import { useEffect, useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Clock, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/AppLayout';
import { LoadingState, ErrorState } from '@/components/common/states';
import { CompareSlider } from '@/components/CompareSlider';
import { optionLabel } from '@/lib/correctionOptions';
import { getJob, type EnhancementJob } from '@/lib/enhancementJobs';
import { ApiError } from '@/lib/apiClient';
import { useAuthStore } from '@/store/authStore';
import type { FunctionComponent } from '@/common/types';

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};
const STATUS_CLASS: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  processing: 'bg-[--yellow]/40 text-[#7a5b06]',
  ready: 'bg-[--mint] text-[--mint-dark]',
  failed: 'bg-destructive/10 text-destructive',
};

// POLL_MS: requests never leave `queued` in this build — see the schema note
// on EnhancementJob — so this only matters for the demo-seeded jobs that ARE
// processing/ready/failed. A short poll keeps a genuinely live one current
// without hammering the API.
const POLL_MS = 8000;

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const RequestDetail = (): FunctionComponent => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [job, setJob] = useState<EnhancementJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = (): void => {
      getJob(id)
        .then((j) => {
          if (cancelled) return;
          setJob(j);
          setError(null);
          if (j.status === 'queued' || j.status === 'processing') {
            timer = setTimeout(load, POLL_MS);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e instanceof ApiError ? e.message : "This request isn't available.");
        });
    };
    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (error) {
    return (
      <PageContainer>
        <ErrorState title="This request isn't available." message={error} />
      </PageContainer>
    );
  }
  if (!job) {
    return (
      <PageContainer>
        <LoadingState label="Loading request…" />
      </PageContainer>
    );
  }

  const isOwner = job.userId === user?.id;
  const submitterName = job.user?.displayName || job.user?.email || 'Member';

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{job.reference}</p>
            <h1 className="mt-1 text-2xl font-bold text-foreground">Enhancement request</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Submitted by {submitterName} · {formatDate(job.submittedAt)}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${STATUS_CLASS[job.status] ?? ''}`}>
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            {job.status === 'ready' && job.resultImagePath ? (
              <CompareSlider
                beforeSrc={job.photoUrl}
                afterSrc={job.resultImagePath}
                beforeAlt="Original photo"
                afterAlt="AI-enhanced photo"
              />
            ) : (
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
                <img src={job.photoUrl} alt="Original photo" className="size-full object-cover" />
                {(job.status === 'queued' || job.status === 'processing') && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-white">
                    <Loader2 className="size-8 animate-spin" />
                    <p className="text-sm font-semibold">
                      {job.status === 'queued' ? 'Queued for enhancement…' : 'Processing your photo…'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {job.status === 'failed' && (
              <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                  <AlertTriangle className="size-4" /> This request failed
                </p>
                <p className="text-sm text-muted-foreground">{job.failureMessage ?? 'Something went wrong.'}</p>
                {isOwner && (
                  <Button asChild size="sm" className="min-h-[44px]">
                    <Link to="/enhance/new">Submit again</Link>
                  </Button>
                )}
              </div>
            )}

            {isOwner && job.status === 'ready' && job.resultImagePath && (
              <a
                href={job.resultImagePath}
                download
                onClick={() => toast.success('Your enhanced image download is starting.')}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
              >
                <Download className="size-4" /> Download enhanced photo
              </a>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-4 shadow-card">
              <p className="mb-2 text-sm font-semibold text-foreground">Selected corrections</p>
              <ul className="flex flex-wrap gap-1.5">
                {job.selectedOptions.map((key) => (
                  <li key={key} className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    {optionLabel(key)}
                    {job.optionStrengths[key] ? ` · ${job.optionStrengths[key]}` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">{job.creditsCharged} credit charged</p>
            </div>

            <div className="rounded-lg border bg-card p-4 shadow-card">
              <p className="mb-2 text-sm font-semibold text-foreground">Automatic review</p>
              {job.reviewStatus === 'complete' && job.reviewNotes ? (
                <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                  {job.reviewNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Suggestions were unavailable for this request.</p>
              )}
            </div>

            <div className="rounded-lg border bg-card p-4 shadow-card">
              <p className="mb-3 text-sm font-semibold text-foreground">Timeline</p>
              <ul className="space-y-3 text-sm">
                <TimelineRow icon={<CheckCircle2 className="size-4 text-[--mint-deep]" />} label="Submitted" value={formatDate(job.submittedAt)} />
                <TimelineRow icon={<Clock className="size-4 text-muted-foreground" />} label="Processing started" value={formatDate(job.processingStartedAt)} />
                <TimelineRow icon={<CheckCircle2 className="size-4 text-[--mint-deep]" />} label="Completed" value={formatDate(job.completedAt)} />
                {job.status === 'failed' && (
                  <TimelineRow icon={<AlertTriangle className="size-4 text-destructive" />} label="Failed" value={formatDate(job.failedAt)} />
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
};

function TimelineRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }): FunctionComponent {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon} {label}
      </span>
      <span className="font-medium text-foreground">{value}</span>
    </li>
  );
}
