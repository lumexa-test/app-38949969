import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageHeader';
import { PageContainer } from '@/components/AppLayout';
import { LoadingState, ErrorState } from '@/components/common/states';
import { CORRECTION_OPTIONS, STRENGTH_VALUES, type Strength } from '@/lib/correctionOptions';
import { getJob, runReview, saveOptions, type EnhancementJob } from '@/lib/enhancementJobs';
import { ApiError } from '@/lib/apiClient';
import type { FunctionComponent } from '@/common/types';

export const ChooseCorrections = (): FunctionComponent => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<EnhancementJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(true);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [strengths, setStrengths] = useState<Record<string, Strength>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getJob(id)
      .then((j) => {
        if (j.status !== 'draft') {
          navigate(`/requests/${j.id}`, { replace: true });
          return;
        }
        setJob(j);
        setSelected(new Set(j.selectedOptions));
        setStrengths(j.optionStrengths as Record<string, Strength>);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "This request isn't available."));
  }, [id, navigate]);

  useEffect(() => {
    if (!id || !job) return;
    setReviewing(true);
    runReview(id)
      .then(() => setReviewNotice(null))
      .catch((e) => {
        setReviewNotice(
          e instanceof ApiError ? e.message : 'Suggestions are unavailable — choose your corrections manually.',
        );
      })
      .finally(() => setReviewing(false));
    // Only ever needs to run once per loaded job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, job?.id]);

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setStrengths((prev) => {
      const opt = CORRECTION_OPTIONS.find((o) => o.key === key);
      if (!opt?.hasStrength || prev[key]) return prev;
      return { ...prev, [key]: 'medium' };
    });
  };

  const handleContinue = async (): Promise<void> => {
    if (!id || selected.size === 0) {
      setSubmitError('Select at least one correction.');
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const strengthPayload: Record<string, string> = {};
      for (const key of selected) {
        const opt = CORRECTION_OPTIONS.find((o) => o.key === key);
        if (opt?.hasStrength) strengthPayload[key] = strengths[key] ?? 'medium';
      }
      await saveOptions(id, { selectedOptions: Array.from(selected), optionStrengths: strengthPayload });
      navigate(`/enhance/${id}/confirm`);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not save your corrections.');
      if (err instanceof ApiError) toast.error(err.message);
    } finally {
      setSaving(false);
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
        <PageHeader title="Choose your corrections" description="Pick what you'd like FaceGlow AI to improve." />

        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className="rounded-full bg-muted px-2.5 py-1">1. Upload</span>
          <span className="rounded-full bg-[--mint] px-2.5 py-1 text-[--mint-dark]">2. Corrections</span>
          <span className="rounded-full bg-muted px-2.5 py-1">3. Confirm</span>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card shadow-card">
          <img src={job.photoUrl} alt="Uploaded photo" loading="lazy" className="aspect-[4/3] w-full object-cover" />
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-card">
          <p className="mb-2 text-sm font-semibold text-foreground">What we noticed</p>
          {reviewing ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reviewing your photo…
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {reviewNotice ?? 'Automatic suggestions are ready above.'}
            </p>
          )}
        </div>

        <div className="space-y-3">
          {CORRECTION_OPTIONS.map((opt) => {
            const isSelected = selected.has(opt.key);
            return (
              <div key={opt.key} className={`rounded-lg border p-4 transition-colors ${isSelected ? 'border-primary/50 bg-primary/5' : 'bg-card'}`}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(opt.key)}
                    className="mt-0.5 size-5 shrink-0 accent-primary"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-foreground">{opt.label}</span>
                    <span className="block text-xs text-muted-foreground">{opt.helperText}</span>
                  </span>
                </label>
                {opt.hasStrength && isSelected && (
                  <div className="mt-3 flex gap-1.5 pl-8">
                    {STRENGTH_VALUES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStrengths((prev) => ({ ...prev, [opt.key]: s }))}
                        className={`rounded-md border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                          (strengths[opt.key] ?? 'medium') === s
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border text-muted-foreground'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {submitError && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{submitError}</p>}

        <div className="flex justify-between gap-2">
          <Button variant="outline" asChild className="min-h-[44px]">
            <Link to="/enhance/new">Back</Link>
          </Button>
          <Button onClick={handleContinue} disabled={saving} className="min-h-[44px]">
            <Sparkles className="size-4" />
            {saving ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
};
