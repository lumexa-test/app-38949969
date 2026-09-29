import dotenv from 'dotenv';
dotenv.config();

const jwtSecret = process.env.JWT_SECRET_KEY;
if (!jwtSecret) {
  console.warn('WARNING: JWT_SECRET_KEY not set — using insecure default. Set it in production!');
}

const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: jwtSecret || 'dev_secret_key_change_in_production',
  // DATABASE_URL is read directly by Prisma from .env — no need to pass it manually

  // ─── Image uploads via the platform upload proxy ──────────────────────────
  // The app holds NO AWS credentials. Admin image uploads are forwarded to the
  // platform's upload proxy (POST {proxy}/v1/projects/{projectId}/uploads) with
  // a scoped token; the platform writes to S3 under projects/{projectId}/admin/
  // using its own creds. All three are injected by the platform at build/deploy.
  // When any is unset, /api/uploads returns a "not configured" error.
  mediaProxyUrl: (process.env.MEDIA_UPLOAD_PROXY_URL || '').replace(/\/+$/, ''),
  mediaUploadToken: process.env.MEDIA_UPLOAD_TOKEN || '',
  projectId: process.env.PROJECT_ID || '',
};

export default config;
