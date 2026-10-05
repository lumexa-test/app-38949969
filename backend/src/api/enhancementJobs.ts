import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { handlePrismaError } from '../lib/handleError';
import EnhancementJob from '../models/enhancementJob';
import { isValidOptionKey, STRENGTH_VALUES } from '../lib/correctionOptions';

const ENHANCEMENT_COST = 1;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function requireUser(req: Request, res: Response): { id: number; tenantId: string; isAdmin: boolean } | null {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return null;
  }
  return req.user;
}

/** Loads a job by id (tenant-scoped) and enforces ownership, telling a
 *  cross-user hit (403) apart from a genuinely missing id (404). Writes the
 *  response and returns null when access should stop there. */
async function loadOwnedOrRespond(
  res: Response,
  id: number,
  user: { id: number; tenantId: string },
) {
  const job = await EnhancementJob.findInTenant(id, user.tenantId);
  if (!job) {
    res.status(404).json({ message: 'Request not found' });
    return null;
  }
  if (job.userId !== user.id) {
    res.status(403).json({ message: 'You can only manage your own requests.' });
    return null;
  }
  return job;
}

// POST /api/enhancement-jobs — start a new request from an already-uploaded photo.
async function create(req: Request, res: Response): Promise<any> {
  const user = requireUser(req, res);
  if (!user) return;

  const { photoUrl, photoFileName, photoMimeType, photoSizeBytes } = req.body;
  if (typeof photoUrl !== 'string' || !photoUrl) {
    return res.status(400).json({ message: 'A photo is required.' });
  }
  if (!ALLOWED_MIME_TYPES.includes(photoMimeType)) {
    return res.status(400).json({ message: 'Only JPG, PNG or WEBP images up to 10 MB are accepted.' });
  }
  if (typeof photoSizeBytes !== 'number' || photoSizeBytes <= 0 || photoSizeBytes > MAX_PHOTO_BYTES) {
    return res.status(400).json({ message: 'Only JPG, PNG or WEBP images up to 10 MB are accepted.' });
  }

  try {
    const job = await EnhancementJob.createDraft({
      userId: user.id,
      tenantId: user.tenantId,
      photoUrl,
      photoFileName: typeof photoFileName === 'string' && photoFileName ? photoFileName : 'photo',
      photoMimeType,
      photoSizeBytes,
    });
    return res.status(201).json(job);
  } catch (error) {
    return handlePrismaError(error, res);
  }
}

// PATCH /api/enhancement-jobs/:id/options — save/continue with chosen corrections.
async function updateOptions(req: Request, res: Response): Promise<any> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);

  const rawSelected: unknown = req.body.selectedOptions;
  const rawStrengths: unknown = req.body.optionStrengths ?? {};

  if (!Array.isArray(rawSelected) || rawSelected.length === 0) {
    return res.status(400).json({ message: 'Select at least one correction.' });
  }
  if (!rawSelected.every((k) => typeof k === 'string' && isValidOptionKey(k))) {
    return res.status(400).json({ message: 'One or more selected corrections are invalid.' });
  }
  if (
    typeof rawStrengths !== 'object' ||
    rawStrengths === null ||
    Array.isArray(rawStrengths) ||
    !Object.values(rawStrengths as Record<string, unknown>).every(
      (v) => typeof v === 'string' && STRENGTH_VALUES.includes(v as (typeof STRENGTH_VALUES)[number]),
    )
  ) {
    return res.status(400).json({ message: 'One or more strength values are invalid.' });
  }
  const selectedOptions = rawSelected as string[];
  const optionStrengths = rawStrengths as Record<string, string>;

  try {
    const job = await loadOwnedOrRespond(res, id, user);
    if (!job) return;
    if (job.status !== 'draft') {
      return res.status(409).json({ message: 'This request has already been submitted.' });
    }

    const updated = await EnhancementJob.updateOptions(id, { selectedOptions, optionStrengths });
    return res.status(200).json(updated);
  } catch (error) {
    return handlePrismaError(error, res);
  }
}

// POST /api/enhancement-jobs/:id/submit — spend a credit and queue the request.
async function submit(req: Request, res: Response): Promise<any> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);

  try {
    const job = await loadOwnedOrRespond(res, id, user);
    if (!job) return;
    if (job.status !== 'draft') {
      return res.status(409).json({ message: 'This request has already been submitted.' });
    }
    const selected = Array.isArray(job.selectedOptions) ? job.selectedOptions : [];
    if (selected.length === 0) {
      return res.status(400).json({ message: 'Select at least one correction.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Conditional guard: only flips a still-draft row, so a double-click
      // (or two concurrent submits) only ever queues the request once.
      const flipped = await tx.enhancementJob.updateMany({
        where: { id, status: 'draft' },
        data: { status: 'queued', submittedAt: new Date(), creditsCharged: ENHANCEMENT_COST },
      });
      if (flipped.count === 0) return { conflict: true as const };

      const spent = await tx.user.updateMany({
        where: { id: user.id, creditBalance: { gte: ENHANCEMENT_COST } },
        data: { creditBalance: { decrement: ENHANCEMENT_COST } },
      });
      if (spent.count === 0) {
        // Roll back the status flip — insufficient credits, nothing charged.
        await tx.enhancementJob.update({
          where: { id },
          data: { status: 'draft', submittedAt: null, creditsCharged: 0 },
        });
        return { insufficientCredits: true as const };
      }

      const freshUser = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          tenantId: user.tenantId,
          type: 'enhancement_spend',
          amount: -ENHANCEMENT_COST,
          balanceAfter: freshUser.creditBalance,
          description: `Enhancement request ${job.reference}`,
          relatedJobId: id,
        },
      });
      const updatedJob = await tx.enhancementJob.findUniqueOrThrow({ where: { id } });
      return { job: updatedJob, balance: freshUser.creditBalance };
    });

    if ('conflict' in result) return res.status(409).json({ message: 'This request has already been submitted.' });
    if ('insufficientCredits' in result) {
      return res.status(400).json({ message: "You don't have enough credits." });
    }
    return res.status(200).json(result);
  } catch (error) {
    return handlePrismaError(error, res);
  }
}

// GET /api/enhancement-jobs — the signed-in user's own submitted requests.
async function listMine(req: Request, res: Response): Promise<any> {
  const user = requireUser(req, res);
  if (!user) return;

  const page = Math.max(1, Number(req.query.page) || 1);
  const take = 25;
  const skip = (page - 1) * take;

  try {
    const [items, total] = await Promise.all([
      EnhancementJob.listMine(user.id, user.tenantId, { skip, take }),
      EnhancementJob.countMine(user.id, user.tenantId),
    ]);
    return res.status(200).json({ items, total, page, pageSize: take });
  } catch (error) {
    return handlePrismaError(error, res);
  }
}

// GET /api/enhancement-jobs/:id — owner, or admin (read-only).
async function getOne(req: Request, res: Response): Promise<any> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);

  try {
    const job = await EnhancementJob.findInTenant(id, user.tenantId);
    if (!job) return res.status(404).json({ message: "This request isn't available." });
    if (job.userId !== user.id && !user.isAdmin) {
      return res.status(403).json({ message: "This request isn't available." });
    }
    return res.status(200).json(job);
  } catch (error) {
    return handlePrismaError(error, res);
  }
}

export default { create, updateOptions, submit, listMine, getOne };
export { requireUser };
