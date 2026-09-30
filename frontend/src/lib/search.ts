import { apiClient } from '@/lib/apiClient';

export interface SearchResult {
  answer: string;
  citations: string[];
  model: string;
}

export function askSearch(query: string): Promise<SearchResult> {
  return apiClient.post<SearchResult>('/api/perplexity/ask', { query });
}
