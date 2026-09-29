import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageHeader';
import { PageContainer } from '@/components/AppLayout';
import { LoadingState, ErrorState } from '@/components/common/states';
import { optionLabel } from '@/lib/correctionOptions';
import { getJob, submitJob, type EnhancementJob } from '@/lib/enhancementJobs';
import { ApiError } from '@/lib/apiClient';
import { useAuthStore } from '@/store/authStore';
import type { FunctionComponent } from '@/common/types';

const ENHANCEMENT_COST = 1;

export const ConfirmEnhancement = (): FunctionComponent => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();

  const [job, setJob] = useState<EnhancementJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getJob(id)
      .then((j) => {
        if (j.status !== 'draft') {
          navigate(`/requests/${j.id}`, { replace: true });
          return;
        }
        if (j.selectedOptions.length === 0) {
          navigate(`/enhance/${j.id}/options`, { replace: true });
          return;
        }
        setJob(j);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "This request isn't available."));
  }, [id, navigate]);

  const balance = user?.creditBalance ?? 0;
  const hasEnoughCredits = balance >= ENHANCEMENT_COST;

  const handleSubmit = async (): Promise<void> => {
    if (!id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitJob(id);
      updateUser({ creditBalance: result.balance });
      toast.success(`Enhancement submitted — ${result.job.reference}`);
      navigate(`/requests/${result.job.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not submit your request.';
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <PageContainer>
        <ErrorState title="This request isn't available." message={loadError} />
      </PageContainer>
    );
  }
  if (!job) {
    return (
      <PageContainer>
        <LoadingState label="Loading your request…" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Confirm your enhancement" description="Review your selections before we get to work." />

        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className="rounded-full bg-muted px-2.5 py-1">1. Upload</span>
          <span className="rounded-full bg-muted px-2.5 py-1">2. Corrections</span>
          <span className="rounded-full bg-[--mint] px-2.5 py-1 text-[--mint-dark]">3. Confirm</span>
        </div>

        <div className="flex gap-4 rounded-lg border bg-card p-4 shadow-card">
          <img src={job.photoUrl} alt="Uploaded photo" loading="lazy" className="size-24 shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{job.photoFileName}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {job.selectedOptions.map((key) => (
                <li key={key} className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                  {optionLabel(key)}
                  {job.optionStrengths[key] ? ` · ${job.optionStrengths[key]}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border bg-card p-4 shadow-card">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Cost</span>
            <span className="font-semibold text-foreground">{ENHANCEMENT_COST} credit</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Current balance</span>
            <span className="font-semibold text-foreground">{balance} credits</span>
          </div>
          <div className="flex justify-between border-t pt-2 text-sm">
            <span className="text-muted-foreground">Resulting balance</span>
            <span className="font-semibold text-foreground">
              {hasEnoughCredits ? balance - ENHANCEMENT_COST : balance} credits
            </span>
          </div>
        </div>

        {!hasEnoughCredits && (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">You&rsquo;re out of credits</p>
            <p className="text-sm text-muted-foreground">Buy a credit pack to submit this enhancement.</p>
            <Button asChild size="sm" className="min-h-[44px]">
              <Link to="/credits">Buy credits</Link>
            </Button>
          </div>
        )}

        {submitError && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{submitError}</p>}

        <div className="flex justify-between gap-2">
          <Button variant="outline" asChild className="min-h-[44px]">
            <Link to={`/enhance/${job.id}/options`}>Back</Link>
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !hasEnoughCredits} className="min-h-[44px]">
            <Wand2 className="size-4" />
            {submitting ? 'Submitting…' : 'Submit enhancement'}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
};
