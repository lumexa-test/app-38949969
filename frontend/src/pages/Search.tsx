import { useState, type FormEvent } from 'react';
import { Search as SearchIcon, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer } from '@/components/AppLayout';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { askSearch, type SearchResult } from '@/lib/search';
import { ApiError } from '@/lib/apiClient';
import type { FunctionComponent } from '@/common/types';

export const Search = (): FunctionComponent => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setNotConfigured(null);
    askSearch(trimmed)
      .then((res) => {
        setResult(res);
        toast.success('Search complete');
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 503) {
          setNotConfigured(e.message);
        } else {
          setError(e instanceof ApiError ? e.message : 'Search failed. Please try again.');
        }
      })
      .finally(() => setLoading(false));
  };

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader title="Search" description="Ask a question and get a grounded, cited answer." />

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything…"
              rows={3}
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !query.trim()} className="min-h-[44px]">
              <SearchIcon />
              {loading ? 'Searching…' : 'Search'}
            </Button>
          </form>
        </Card>

        {notConfigured && (
          <div className="rounded-lg border border-border bg-muted/50 p-6 text-center">
            <p className="text-sm font-semibold text-foreground">Search isn't connected yet</p>
            <p className="mt-1 text-sm text-muted-foreground">{notConfigured}</p>
          </div>
        )}

        {error && <ErrorState message={error} onRetry={handleSubmit as unknown as () => void} />}

        {!notConfigured && !error && !loading && !result && (
          <EmptyState
            icon={<SearchIcon />}
            title="No search yet"
            description="Ask a question above to get a cited answer."
          />
        )}

        {result && !error && (
          <Card>
            <CardContent className="space-y-4 p-6">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{result.answer}</p>
              {result.citations.length > 0 && (
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
                  <ul className="space-y-1.5">
                    {result.citations.map((url, i) => (
                      <li key={i}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                        >
                          <ExternalLink className="size-3.5 shrink-0" />
                          <span className="truncate">{url}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
};
