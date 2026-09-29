import { apiClient } from '@/lib/apiClient';

export interface CreditTransaction {
  id: number;
  type: 'signup_grant' | 'purchase' | 'enhancement_spend' | 'refund';
  amount: number;
  balanceAfter: number;
  description: string;
  relatedJobId: number | null;
  relatedJob: { reference: string } | null;
  createdAt: string;
}

export interface CreditsSummary {
  balance: number;
  items: CreditTransaction[];
  total: number;
  page: number;
  pageSize: number;
}

export function getCreditsSummary(page = 1): Promise<CreditsSummary> {
  return apiClient.get<CreditsSummary>(`/api/credits?page=${page}`);
}

export const CREDIT_PACKS = [
  { id: 'pack_10', credits: 10, priceUsd: 5 },
  { id: 'pack_30', credits: 30, priceUsd: 12 },
  { id: 'pack_100', credits: 100, priceUsd: 35 },
] as const;

export function checkoutPack(packId: string): Promise<{ checkoutUrl: string }> {
  return apiClient.post<{ checkoutUrl: string }>('/api/credits/checkout', { packId });
}
