import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { join } from 'path';
import { existsSync } from 'fs';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import enhancementJobRoutes from './routes/enhancementJobs';
import creditsRoutes from './routes/credits';
import uploadRoutes from './custom/uploads';
import config from '../config';
import { prisma } from './lib/prisma';
import paymentsRouter, { stripeWebhookRouter } from './custom/integrations/stripe';
import perplexityRouter from './custom/integrations/perplexity';

const app = express();

// Honor X-Forwarded-Proto / Host from the ALB so `req.protocol` and
// `req.get('host')` reflect the public-facing URL, not the internal one.
// Required for redirect URLs (Stripe success_url / cancel_url, OAuth) to
// resolve correctly when the app is deployed behind a reverse proxy.
app.set('trust proxy', true);

// Strip APP_BASE_PATH prefix from incoming requests (ALB path-based routing)
const basePath = process.env.APP_BASE_PATH ?? '';
// '/' means "served at root" = NO prefix. Treating it as a real prefix
// slices the leading slash off every request (→ /health, /api/* 404).
if (basePath && basePath !== '/') {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.path.startsWith(basePath)) {
      req.url = req.url.slice(basePath.length) || '/';
    }
    next();
  });
}

app.use(cors());
app.use('/api/payments/webhook', stripeWebhookRouter);
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// ── DOMAIN ROUTES GO HERE ──────────────────────────────────────────────
app.use('/api/enhancement-jobs', enhancementJobRoutes);
app.use('/api/credits', creditsRoutes);
// ───────────────────────────────────────────────────────────────────────

// Custom routes (non-CRUD features: search, webhooks, exports, etc.)
// Claude writes these to src/routes/ and imports them here.
// Example: app.use('/api/search', searchRoutes);
app.use('/api/uploads', uploadRoutes); // image uploads → platform proxy (see "Image uploads" in backend/CLAUDE.md; never touch S3/AWS directly)
app.use('/api/payments', paymentsRouter);
app.use('/api/perplexity', perplexityRouter);

// Serve frontend static files (production: vite build output copied to public/)
const publicDir = join(__dirname, '..', '..', 'public');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir, {
    setHeaders: (res, filePath) => {
      if (/[\\/]uploads[\\/]/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  // SPA fallback — serve index.html for any non-API route
  // Express 5 / path-to-regexp v8 requires named catch-all params
  app.get('/{*path}', (_req: Request, res: Response) => {
    res.sendFile(join(publicDir, 'index.html'));
  });
}

// Global error handler — must be last
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

// Seed demo user on startup (idempotent — skips if already exists)
async function seedDemoUser(): Promise<void> {
  const email = process.env.DEMO_USER_EMAIL || 'demo@app.com';
  const password = process.env.DEMO_USER_PASSWORD || 'demo123';
  try {
    const existing = await prisma.user.findFirst({ where: { email } });
    if (!existing) {
      const hashed = await bcrypt.hash(password, 10);
      await prisma.user.create({
        data: { email, password: hashed, tenantId: 'default', displayName: 'Demo User', creditBalance: 3 },
      });
      console.log(`Demo user seeded: ${email}`);
    }
  } catch (err) {
    console.warn('Demo user seed skipped:', err instanceof Error ? err.message : err);
  }
}

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  seedDemoUser();
});
