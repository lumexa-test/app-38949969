import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

function generateReference(): string {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ENH-${code}`;
}

interface CreateDraftInput {
  userId: number;
  tenantId: string;
  photoUrl: string;
  photoFileName: string;
  photoMimeType: string;
  photoSizeBytes: number;
}

async function createDraft(input: CreateDraftInput) {
  return prisma.enhancementJob.create({
    data: {
      userId: input.userId,
      tenantId: input.tenantId,
      reference: generateReference(),
      photoUrl: input.photoUrl,
      photoFileName: input.photoFileName,
      photoMimeType: input.photoMimeType,
      photoSizeBytes: input.photoSizeBytes,
      selectedOptions: [],
      optionStrengths: {},
      status: 'draft',
      reviewStatus: 'pending',
    },
  });
}

/** By id, scoped only to tenant — callers check ownership themselves so a
 *  cross-user hit can be told apart (403) from a truly missing id (404). */
async function findInTenant(id: number, tenantId: string) {
  return prisma.enhancementJob.findFirst({
    where: { id, tenantId },
    include: { user: { select: { displayName: true, email: true } } },
  });
}

async function updateOptions(
  id: number,
  data: { selectedOptions: Prisma.InputJsonValue; optionStrengths: Prisma.InputJsonValue },
) {
  return prisma.enhancementJob.update({ where: { id }, data });
}

async function listMine(userId: number, tenantId: string, opts: { skip: number; take: number }) {
  return prisma.enhancementJob.findMany({
    where: { userId, tenantId, status: { not: 'draft' } },
    orderBy: { submittedAt: 'desc' },
    skip: opts.skip,
    take: opts.take,
  });
}

async function countMine(userId: number, tenantId: string) {
  return prisma.enhancementJob.count({ where: { userId, tenantId, status: { not: 'draft' } } });
}

async function listForTenant(tenantId: string, opts: { status?: string; skip: number; take: number }) {
  return prisma.enhancementJob.findMany({
    where: {
      tenantId,
      status: opts.status ? opts.status : { not: 'draft' },
    },
    include: { user: { select: { displayName: true, email: true } } },
    orderBy: { submittedAt: 'desc' },
    skip: opts.skip,
    take: opts.take,
  });
}

async function countForTenant(tenantId: string, status?: string) {
  return prisma.enhancementJob.count({
    where: { tenantId, status: status ? status : { not: 'draft' } },
  });
}

async function statusCounts(tenantId: string) {
  const rows = await prisma.enhancementJob.groupBy({
    by: ['status'],
    where: { tenantId, status: { not: 'draft' } },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { queued: 0, processing: 0, ready: 0, failed: 0 };
  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

async function recentForTenant(tenantId: string, take: number) {
  return prisma.enhancementJob.findMany({
    where: { tenantId, status: { not: 'draft' } },
    include: { user: { select: { displayName: true, email: true } } },
    orderBy: { submittedAt: 'desc' },
    take,
  });
}

export default {
  generateReference,
  createDraft,
  findInTenant,
  updateOptions,
  listMine,
  countMine,
  listForTenant,
  countForTenant,
  statusCounts,
  recentForTenant,
};
