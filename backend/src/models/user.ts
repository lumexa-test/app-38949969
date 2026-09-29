import { prisma } from '../lib/prisma';

async function createUser(data: { email: string; password: string; tenantId: string; displayName?: string }) {
  return prisma.user.create({ data });
}

async function getUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

async function getUserById(id: number) {
  return prisma.user.findUnique({ where: { id } });
}

async function updatePassword(id: number, password: string) {
  return prisma.user.update({ where: { id }, data: { password } });
}

/** Tenant-scoped list of users (password never selected). */
async function listByTenant(tenantId: string) {
  return prisma.user.findMany({
    where: { tenantId },
    select: { id: true, email: true, tenantId: true, isAdmin: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

/** Deletes the user and their owned domain rows (self-service account deletion). */
async function deleteUser(id: number) {
  return prisma.$transaction(async (tx) => {
    await tx.creditTransaction.deleteMany({ where: { userId: id } });
    await tx.enhancementJob.deleteMany({ where: { userId: id } });
    await tx.user.delete({ where: { id } });
  });
}

export default { createUser, getUserByEmail, getUserById, updatePassword, listByTenant, deleteUser };
