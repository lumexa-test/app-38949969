import { Request, Response } from 'express';
import User from '../models/user';
import EnhancementJob from '../models/enhancementJob';
import { handlePrismaError } from '../lib/handleError';

// List all users in the actor's tenant. Mounted behind jwtCheck + requireAdmin.
async function listUsers(req: Request, res: Response): Promise<any> {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    const users = await User.listByTenant(req.user.tenantId);
    return res.status(200).json(users);
  } catch (error) {
    console.error('Error listing users:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

const VALID_STATUSES = ['queued', 'processing', 'ready', 'failed'];

// GET /api/admin/enhancement-jobs?status=&page= — every submitted request on
// the platform (tenant-scoped, not user-scoped), read-only.
async function listEnhancementJobs(req: Request, res: Response): Promise<any> {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
  const status = typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status)
    ? req.query.status
    : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const take = 25;
  const skip = (page - 1) * take;

  try {
    const [items, total] = await Promise.all([
      EnhancementJob.listForTenant(req.user.tenantId, { status, skip, take }),
      EnhancementJob.countForTenant(req.user.tenantId, status),
    ]);
    return res.status(200).json({ items, total, page, pageSize: take });
  } catch (error) {
    return handlePrismaError(error, res);
  }
}

// GET /api/admin/enhancement-jobs/overview — counts per state + recent jobs.
async function jobsOverview(req: Request, res: Response): Promise<any> {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const [counts, recent] = await Promise.all([
      EnhancementJob.statusCounts(req.user.tenantId),
      EnhancementJob.recentForTenant(req.user.tenantId, 25),
    ]);
    return res.status(200).json({ counts, recent });
  } catch (error) {
    return handlePrismaError(error, res);
  }
}

export default { listUsers, listEnhancementJobs, jobsOverview };
