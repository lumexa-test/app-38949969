/**
 * Seed script — runs after every `prisma db push` / `prisma migrate deploy`
 * to guarantee a single admin user exists. Idempotent (upsert keyed on
 * email), safe to run on every deploy.
 *
 * Email defaults to `admin@<APP_SLUG>.app` when APP_SLUG env var is set
 * (build pipeline injects this); otherwise falls back to `admin@app.local`.
 * Password is plain `admin123` (hashed at rest with bcrypt). Override
 * either via env var when needed.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function deriveEmail(): string {
  if (process.env.ADMIN_EMAIL) return process.env.ADMIN_EMAIL;
  const slug = (process.env.APP_SLUG ?? 'app')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
  return `admin@${slug}.app`;
}

async function main() {
  const email = deriveEmail();
  const plainPassword = process.env.ADMIN_PASSWORD ?? 'admin123';
  const password = await bcrypt.hash(plainPassword, 10);
  const tenantId = process.env.ADMIN_TENANT_ID ?? 'default';

  const admin = await prisma.user.upsert({
    where: { email },
    update: { isAdmin: true },
    create: { email, password, tenantId, isAdmin: true },
  });

  console.log(`[seed] Admin user ready: ${admin.email} (id=${admin.id})`);

  await seedDomainDemoData(tenantId);
}

// ─── Domain demo data (FaceGlow AI) ──────────────────────────────────────────
// Realistic members + a spread of enhancement requests across every status,
// so the dashboard, credits history and admin monitor look like a living
// product on first load. Idempotent — upserts keyed on email / reference.
async function seedDomainDemoData(tenantId: string): Promise<void> {
  const demoPassword = await bcrypt.hash('demo12345', 10);

  const members = [
    { email: 'sarah.chen@example.com', displayName: 'Sarah Chen', creditBalance: 5 },
    { email: 'marcus.reyes@example.com', displayName: 'Marcus Reyes', creditBalance: 2 },
    { email: 'priya.nair@example.com', displayName: 'Priya Nair', creditBalance: 8 },
  ];

  const users: Record<string, { id: number }> = {};
  for (const m of members) {
    const user = await prisma.user.upsert({
      where: { email: m.email },
      update: { displayName: m.displayName, creditBalance: m.creditBalance },
      create: { email: m.email, password: demoPassword, tenantId, displayName: m.displayName, creditBalance: m.creditBalance },
    });
    users[m.email] = user;
  }

  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  interface JobFixture {
    reference: string;
    email: string;
    photoUrl: string;
    photoFileName: string;
    resultImagePath?: string;
    status: 'queued' | 'processing' | 'ready' | 'failed';
    selectedOptions: string[];
    optionStrengths: Record<string, string>;
    failureMessage?: string;
    submittedAt: Date;
    processingStartedAt?: Date;
    completedAt?: Date;
    failedAt?: Date;
  }

  const jobs: JobFixture[] = [
    {
      reference: 'ENH-DEMO01',
      email: 'sarah.chen@example.com',
      photoUrl: '/uploads/label-nova-original-photo-8749c1af.jpg',
      photoFileName: 'sarah_portrait.jpg',
      resultImagePath: '/uploads/label-nova-enhanced-photo-c46b493d.jpg',
      status: 'ready',
      selectedOptions: ['darkSpotRemoval', 'skinSmoothing', 'brightness'],
      optionStrengths: { skinSmoothing: 'medium', brightness: 'light' },
      submittedAt: hoursAgo(30),
      processingStartedAt: hoursAgo(29),
      completedAt: hoursAgo(28),
    },
    {
      reference: 'ENH-DEMO02',
      email: 'sarah.chen@example.com',
      photoUrl: '/uploads/label-app-shell-image-1-02700324.jpg',
      photoFileName: 'sarah_headshot_v2.jpg',
      status: 'processing',
      selectedOptions: ['toneEvening', 'darkCircleReduction'],
      optionStrengths: { toneEvening: 'medium' },
      submittedAt: hoursAgo(2),
      processingStartedAt: hoursAgo(1),
    },
    {
      reference: 'ENH-DEMO03',
      email: 'marcus.reyes@example.com',
      photoUrl: '/uploads/label-app-shell-image-2-473bd95f.jpg',
      photoFileName: 'marcus_profile.png',
      status: 'queued',
      selectedOptions: ['blemishRemoval'],
      optionStrengths: {},
      submittedAt: hoursAgo(0.5),
    },
    {
      reference: 'ENH-DEMO04',
      email: 'marcus.reyes@example.com',
      photoUrl: '/uploads/label-media-1-af4a31f6.jpg',
      photoFileName: 'marcus_retry.jpg',
      status: 'failed',
      selectedOptions: ['skinSmoothing'],
      optionStrengths: { skinSmoothing: 'strong' },
      failureMessage: 'The uploaded photo was too low-resolution to process reliably.',
      submittedAt: hoursAgo(50),
      processingStartedAt: hoursAgo(49),
      failedAt: hoursAgo(48),
    },
    {
      reference: 'ENH-DEMO05',
      email: 'priya.nair@example.com',
      photoUrl: '/uploads/label-nova-original-photo-8749c1af.jpg',
      photoFileName: 'priya_event_photo.jpg',
      resultImagePath: '/uploads/label-nova-enhanced-photo-c46b493d.jpg',
      status: 'ready',
      selectedOptions: ['darkSpotRemoval', 'blemishRemoval', 'darkCircleReduction', 'toneEvening'],
      optionStrengths: { toneEvening: 'strong' },
      submittedAt: hoursAgo(96),
      processingStartedAt: hoursAgo(95),
      completedAt: hoursAgo(94),
    },
  ];

  for (const job of jobs) {
    const user = users[job.email];
    await prisma.enhancementJob.upsert({
      where: { reference: job.reference },
      update: {},
      create: {
        reference: job.reference,
        userId: user.id,
        tenantId,
        photoUrl: job.photoUrl,
        photoFileName: job.photoFileName,
        photoMimeType: 'image/jpeg',
        photoSizeBytes: 2_400_000,
        selectedOptions: job.selectedOptions,
        optionStrengths: job.optionStrengths,
        reviewStatus: 'unavailable',
        status: job.status,
        resultImagePath: job.resultImagePath,
        failureMessage: job.failureMessage,
        creditsCharged: 1,
        refundedAt: job.status === 'failed' ? hoursAgo(47.5) : undefined,
        submittedAt: job.submittedAt,
        processingStartedAt: job.processingStartedAt,
        completedAt: job.completedAt,
        failedAt: job.failedAt,
      },
    });
  }

  console.log(`[seed] Domain demo data ready: ${members.length} members, ${jobs.length} enhancement requests`);
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
