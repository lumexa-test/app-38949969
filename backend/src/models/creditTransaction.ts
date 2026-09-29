import { prisma } from '../lib/prisma';

/**
 * Atomically spend `amount` credits from a user's balance and record the
 * transaction. The conditional `updateMany` (balance >= amount in the WHERE)
 * is the guard against a race — if two requests fire at once, only one can
 * ever see `count === 1`.
 *
 * Returns the transaction row, or null when the balance was insufficient.
 */
async function spend(params: {
  userId: number;
  tenantId: string;
  amount: number; // positive number of credits to deduct
  type: string;
  description: string;
  relatedJobId?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: params.userId, creditBalance: { gte: params.amount } },
      data: { creditBalance: { decrement: params.amount } },
    });
    if (updated.count === 0) return null;

    const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
    return tx.creditTransaction.create({
      data: {
        userId: params.userId,
        tenantId: params.tenantId,
        type: params.type,
        amount: -params.amount,
        balanceAfter: user.creditBalance,
        description: params.description,
        relatedJobId: params.relatedJobId,
      },
    });
  });
}

/** Grant (or refund) credits — always succeeds. */
async function grant(params: {
  userId: number;
  tenantId: string;
  amount: number; // positive number of credits to add
  type: string;
  description: string;
  relatedJobId?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: params.userId },
      data: { creditBalance: { increment: params.amount } },
    });
    return tx.creditTransaction.create({
      data: {
        userId: params.userId,
        tenantId: params.tenantId,
        type: params.type,
        amount: params.amount,
        balanceAfter: user.creditBalance,
        description: params.description,
        relatedJobId: params.relatedJobId,
      },
    });
  });
}

async function history(userId: number, tenantId: string, opts: { skip: number; take: number }) {
  return prisma.creditTransaction.findMany({
    where: { userId, tenantId },
    include: { relatedJob: { select: { reference: true } } },
    orderBy: { createdAt: 'desc' },
    skip: opts.skip,
    take: opts.take,
  });
}

async function count(userId: number, tenantId: string) {
  return prisma.creditTransaction.count({ where: { userId, tenantId } });
}

export default { spend, grant, history, count };
