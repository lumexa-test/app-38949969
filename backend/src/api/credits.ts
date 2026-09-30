import { Request, Response } from 'express';
import { handlePrismaError } from '../lib/handleError';
import { handleSeamError, IntegrationNotConfiguredError } from '../lib/integrationSeam';
import { isStripeConfigured, createCheckoutSession, StripeError } from '../custom/integrations/stripe';
import CreditTransaction from '../models/creditTransaction';
import User from '../models/user';

// Pinned pricing (section 11 of the brief) — one-time packs, no subscriptions.
export const CREDIT_PACKS = [
  { id: 'pack_10', credits: 10, priceUsd: 5 },
  { id: 'pack_30', credits: 30, priceUsd: 12 },
  { id: 'pack_100', credits: 100, priceUsd: 35 },
] as const;

function requireUser(req: Request, res: Response): { id: number; email: string; tenantId: string } | null {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return null;
  }
  return req.user;
}

// GET /api/credits — balance + history
async function getSummary(req: Request, res: Response): Promise<any> {
  const user = requireUser(req, res);
  if (!user) return;

  const page = Math.max(1, Number(req.query.page) || 1);
  const take = 25;
  const skip = (page - 1) * take;

  try {
    const [me, items, total] = await Promise.all([
      User.getUserById(user.id),
      CreditTransaction.history(user.id, user.tenantId, { skip, take }),
      CreditTransaction.count(user.id, user.tenantId),
    ]);
    return res.status(200).json({ balance: me?.creditBalance ?? 0, items, total, page, pageSize: take });
  } catch (error) {
    return handlePrismaError(error, res);
  }
}

// POST /api/credits/checkout — { packId }
async function checkout(req: Request, res: Response): Promise<any> {
  const user = requireUser(req, res);
  if (!user) return;

  const pack = CREDIT_PACKS.find((p) => p.id === req.body.packId);
  if (!pack) return res.status(400).json({ message: 'Unknown credit pack.' });

  if (!isStripeConfigured()) {
    if (handleSeamError(new IntegrationNotConfiguredError('Stripe'), res)) return;
  }

  const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

  try {
    const session = await createCheckoutSession({
      items: [{ name: `${pack.credits} credits`, amountCents: pack.priceUsd * 100 }],
      successUrl: `${frontendBase}/credits`,
      cancelUrl: `${frontendBase}/credits`,
      referenceType: 'CreditPack',
      referenceId: `${pack.id}:${user.id}`,
      customerEmail: user.email,
    });
    return res.status(200).json({ checkoutUrl: session.url });
  } catch (error) {
    if (error instanceof StripeError) {
      return res.status(error.status).json({ message: error.message });
    }
    if (handleSeamError(error, res)) return;
    return handlePrismaError(error, res);
  }
}

export default { getSummary, checkout };
