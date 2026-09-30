// INTEGRATION KIT — Perplexity (web-search-grounded AI answers).
//
// Staged verbatim when the project owner supplies PERPLEXITY_API_KEY. The kit
// is the app's ONLY Perplexity client: app code imports the helper below into
// its own seams (see backend/src/lib/integrationSeam.ts); the router exists
// for the frontend.
//
// Perplexity's API is OpenAI-compatible, so the official `openai` SDK is
// reused here pointed at Perplexity's base URL — no separate SDK dependency.
//
// When the owner picks the platform key, the platform injects a proxy token as
// PERPLEXITY_API_KEY plus PERPLEXITY_BASE_URL pointing at its metering gateway.
// The base URL is therefore read from the environment (falling back to
// Perplexity's own) so the same code serves both cases.
import { Request, Response, Router } from 'express';
import OpenAI from 'openai';
import middleware from '../../middleware';

const DEFAULT_MODEL = 'sonar';
const DEFAULT_BASE_URL = 'https://api.perplexity.ai';
const INTEGRATION = 'Perplexity';
const NOT_CONFIGURED_MESSAGE = 'Perplexity API key is not configured.';

function apiKey(): string {
  return (process.env.PERPLEXITY_API_KEY ?? '').trim();
}

function baseUrl(): string {
  return (process.env.PERPLEXITY_BASE_URL ?? '').trim() || DEFAULT_BASE_URL;
}

/** True once the owner has supplied PERPLEXITY_API_KEY. Check before calling the helper. */
export function isPerplexityConfigured(): boolean {
  return Boolean(apiKey());
}

/** Thrown by the helper. `message` is user-safe; `status` is the HTTP status to answer with. */
export class PerplexityError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PerplexityError';
  }
}

export interface AskArgs {
  query: string;
  /** Omit for the kit's default. */
  model?: string;
}

export interface AskResult {
  answer: string;
  /** Source URLs. Always render them next to the answer. */
  citations: string[];
  model: string;
}

/** Construct LAZILY, per call — a missing key must never crash boot. */
function client(): OpenAI {
  return new OpenAI({ apiKey: apiKey(), baseURL: baseUrl() });
}

const BUSY_MESSAGE = 'Perplexity is busy right now — please try again shortly.';
const UNAVAILABLE_MESSAGE = 'The search service is unavailable right now.';
const MODEL_UNAVAILABLE_MESSAGE = "This search model isn't available. Try again with the default model.";

type SdkError = { status?: number; message?: string; headers?: Record<string, string> };

/**
 * The platform LLM gateway tags every refusal it makes itself (no credits,
 * unpriced model, spend cap) with this header; provider errors never carry
 * it. Read from the headers, never the body, so an unparseable error still
 * maps cleanly.
 */
function gatewayErrorType(err: unknown): string | undefined {
  return (err as SdkError | undefined)?.headers?.['x-lumexa-gateway-error'];
}

/**
 * Status-first mapping; nothing here requires the error body to parse.
 * 503 is reserved for "not configured" (the frontend renders it as a calm
 * not-connected state) and 401 is never returned (the frontend treats it as
 * an expired session). Perplexity answers 401 both for a bad key and for an
 * account with no credit left, so that message covers both.
 */
function toPerplexityError(err: unknown): PerplexityError {
  const e = (err ?? {}) as SdkError;
  console.error(`[perplexity] ask failed (${e.status ?? 'no response'}):`, e.message);
  switch (gatewayErrorType(err)) {
    case 'insufficient_credits':
      return new PerplexityError(402, 'AI credits have run out. The app owner can add more in Billing.');
    case 'model_not_supported':
      return new PerplexityError(400, MODEL_UNAVAILABLE_MESSAGE);
    case 'per_project_hourly_cap':
    case 'per_project_daily_cap':
      return new PerplexityError(429, 'This app has reached its AI usage limit for now. Please try again later.');
    case 'wallet_concurrency_limit':
      return new PerplexityError(429, BUSY_MESSAGE);
  }
  const status = e.status;
  if (!status) return new PerplexityError(502, "Couldn't reach the search service. Please try again.");
  if (status === 401 || status === 403) return new PerplexityError(503, 'Perplexity API key is invalid or out of credit.');
  if (status === 402) return new PerplexityError(502, 'The search provider account has a billing problem. The app owner needs to check it.');
  if (status === 429) return new PerplexityError(429, BUSY_MESSAGE);
  if (status === 404) return new PerplexityError(400, MODEL_UNAVAILABLE_MESSAGE);
  if (status === 400 || status === 413 || status === 422) {
    return new PerplexityError(400, "The search couldn't process this request. Try a shorter question.");
  }
  if (status >= 500) return new PerplexityError(502, 'The search service is temporarily unavailable. Please try again.');
  return new PerplexityError(502, UNAVAILABLE_MESSAGE);
}

/** One grounded answer with citations. Throws PerplexityError (503 when not configured, 400 on empty query). */
export async function askPerplexity(args: AskArgs): Promise<AskResult> {
  if (!isPerplexityConfigured()) throw new PerplexityError(503, NOT_CONFIGURED_MESSAGE);
  const query = String(args.query ?? '').trim();
  if (!query) throw new PerplexityError(400, 'query is required');

  try {
    const completion = await client().chat.completions.create({
      model: args.model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: query }],
    });
    // Perplexity extends the OpenAI-compatible response with a top-level
    // `citations` array — not part of the official openai SDK's response
    // type, so it's read defensively off the raw payload.
    const citations = Array.isArray((completion as any).citations)
      ? ((completion as any).citations as unknown[]).map((c) => String(c))
      : [];
    return { answer: completion.choices?.[0]?.message?.content ?? '', citations, model: completion.model };
  } catch (err) {
    throw toPerplexityError(err);
  }
}

// ── HTTP surface — thin shell over the helper ───────────────────────────────

function sendError(res: Response, err: unknown): Response {
  if (err instanceof PerplexityError) {
    if (err.status === 503) {
      return res.status(503).json({ error: 'integration_not_configured', integration: INTEGRATION, message: err.message });
    }
    return res.status(err.status).json({ message: err.message });
  }
  console.error('[perplexity] unexpected error:', err);
  return res.status(502).json({ message: UNAVAILABLE_MESSAGE });
}

// POST /api/perplexity/ask — { query: string, model? }
async function ask(req: Request, res: Response): Promise<any> {
  const body = (req.body ?? {}) as Partial<AskArgs>;
  try {
    return res.json(await askPerplexity({ query: body.query ?? '', model: body.model }));
  } catch (err) {
    return sendError(res, err);
  }
}

const router = Router();
// Authenticated: AI search calls cost the owner real money, so they are not
// open to anonymous traffic. Drop jwtCheck only if the product genuinely
// needs a public research surface, and add your own rate limiting if you do.
router.post('/ask', middleware.jwtCheck, ask);
export default router;
