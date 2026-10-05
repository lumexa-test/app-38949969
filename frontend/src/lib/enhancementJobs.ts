import { apiClient } from '@/lib/apiClient';

export type JobStatus = 'draft' | 'queued' | 'processing' | 'ready' | 'failed';
export type ReviewStatus = 'pending' | 'complete' | 'unavailable';

export interface EnhancementJob {
  id: number;
  tenantId: string;
  userId: number;
  reference: string;
  photoUrl: string;
  photoFileName: string;
  photoMimeType: string;
  photoSizeBytes: number;
  selectedOptions: string[];
  optionStrengths: Record<string, string>;
  reviewNotes: string[] | null;
  reviewStatus: ReviewStatus;
  status: JobStatus;
  resultImagePath: string | null;
  failureMessage: string | null;
  creditsCharged: number;
  refundedAt: string | null;
  submittedAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { displayName: string; email: string };
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function createDraft(input: {
  photoUrl: string;
  photoFileName: string;
  photoMimeType: string;
  photoSizeBytes: number;
}): Promise<EnhancementJob> {
  return apiClient.post<EnhancementJob>('/api/enhancement-jobs', input);
}

export function getJob(id: string | number): Promise<EnhancementJob> {
  return apiClient.get<EnhancementJob>(`/api/enhancement-jobs/${id}`);
}

export function listMine(page = 1): Promise<PagedResult<EnhancementJob>> {
  return apiClient.get<PagedResult<EnhancementJob>>(`/api/enhancement-jobs?page=${page}`);
}

export function saveOptions(
  id: string | number,
  body: { selectedOptions: string[]; optionStrengths: Record<string, string> },
): Promise<EnhancementJob> {
  return apiClient.put<EnhancementJob>(`/api/enhancement-jobs/${id}/options`, body);
}

export function submitJob(id: string | number): Promise<{ job: EnhancementJob; balance: number }> {
  return apiClient.post<{ job: EnhancementJob; balance: number }>(`/api/enhancement-jobs/${id}/submit`, {});
}

export function listAdmin(params: { status?: string; page?: number }): Promise<PagedResult<EnhancementJob>> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.page) query.set('page', String(params.page));
  const qs = query.toString();
  return apiClient.get<PagedResult<EnhancementJob>>(`/api/admin/enhancement-jobs${qs ? `?${qs}` : ''}`);
}

export interface JobsOverview {
  counts: { queued: number; processing: number; ready: number; failed: number };
  recent: EnhancementJob[];
}

export function adminOverview(): Promise<JobsOverview> {
  return apiClient.get<JobsOverview>('/api/admin/enhancement-jobs/overview');
}
