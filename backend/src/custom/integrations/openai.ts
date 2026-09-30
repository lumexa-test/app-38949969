// INTEGRATION KIT — OpenAI (text, chat, embeddings, speech-to-text, image analysis).
//
// Staged verbatim when the project owner supplies OPENAI_API_KEY. The kit is
// the app's ONLY OpenAI client: app code imports the helpers below into its
// own seams (see backend/src/lib/integrationSeam.ts); the router exists for
// the frontend.
//
// PLATFORM METERING — do not "fix" this: the client is constructed with an
// apiKey and NO explicit baseURL. When the owner chooses the platform's shared
// key instead of their own, the platform injects a proxy token as
// OPENAI_API_KEY plus an OPENAI_BASE_URL pointing at its metering gateway. The
// official SDK reads OPENAI_BASE_URL from the environment on its own, so the
// same code path serves both bring-your-own-key and platform-metered projects.
// Hardcoding https://api.openai.com/v1 here would bypass metering and bill the
// platform for usage it cannot attribute.
import express, { Request, Response, Router } from 'express';
import OpenAI, { toFile } from 'openai';
import middleware from '../../middleware';

const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';
const DEFAULT_TRANSCRIBE_MODEL = 'whisper-1';
// Vision rides on the chat model — gpt-4o-mini reads images natively.
const DEFAULT_VISION_MODEL = 'gpt-4o-mini';
// Whisper accepts up to 25 MB per file; base64 inflates by ~4/3.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// OpenAI accepts up to 20 MB per image.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const INTEGRATION = 'OpenAI';
const NOT_CONFIGURED_MESSAGE = 'OpenAI API key is not configured.';

function apiKey(): string {
  return (process.env.OPENAI_API_KEY ?? '').trim();
}

/** True once the owner has supplied OPENAI_API_KEY. Check before calling a helper. */
export function isOpenAIConfigured(): boolean {
  return Boolean(apiKey());
}

/** Thrown by every helper. `message` is user-safe; `status` is the HTTP status to answer with. */
export class OpenAIError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpenAIError';
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatArgs {
  /** At least one entry. */
  messages: ChatMessage[];
  /** System prompt; omit for none. */
  system?: string;
  /** Omit for the kit's default. */
  model?: string;
  /** Clamped to 1..4096. */
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  finishReason: string;
}

export interface EmbedArgs {
  input: string | string[];
  model?: string;
}

export interface EmbedResult {
  embeddings: number[][];
  model: string;
}

export interface TranscribeArgs {
  /** Raw audio bytes (mp3, mp4, m4a, wav, webm, ogg, flac). Max 25 MB. */
  audio: Buffer;
  /** File name with extension — Whisper uses it to sniff the format. */
  filename: string;
  /** ISO-639-1 hint, e.g. 'en'. Omit to auto-detect. */
  language?: string;
  /** Omit for the kit's default. */
  model?: string;
}

export interface TranscribeResult {
  text: string;
  model: string;
}

export interface AnalyzeImageArgs {
  /** What to do with the image — describe it, read the receipt, check the product photo. */
  prompt: string;
  /** Raw image bytes (jpeg, png, gif, webp). Max 20 MB. Pass this OR `imageUrl`. */
  image?: Buffer;
  /** MIME type of `image`. Defaults to image/jpeg. */
  mimeType?: string;
  /** Public https URL of the image (e.g. a stored media asset). Pass this OR `image`. */
  imageUrl?: string;
  /** System prompt; omit for none. */
  system?: string;
  /** Omit for the kit's default. */
  model?: string;
  /** Clamped to 1..4096. */
  maxTokens?: number;
  /** 'low' is cheaper and enough for classification; 'high' for reading small text. Default 'auto'. */
  detail?: 'low' | 'high' | 'auto';
}

export type AnalyzeImageResult = ChatResult;

/**
 * Construct LAZILY, per call — never at module top level. A missing key must
 * not crash boot; the router still mounts and its routes answer 503, so adding
 * the key later and redeploying activates the feature with no code change.
 */
function client(): OpenAI {
  return new OpenAI({ apiKey: apiKey() });
}

/** Map SDK failures to a user-safe error. Never leaks the key or the raw error. */
const BUSY_MESSAGE = 'AI is busy right now — please try again shortly.';
const UNAVAILABLE_MESSAGE = 'The AI service is unavailable right now.';
const MODEL_UNAVAILABLE_MESSAGE = "This AI model isn't available. Try again with the default model.";
/** OpenAI 429 codes that mean the account is out of quota, not just busy. */
const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

type SdkError = { status?: number; message?: string; code?: string; headers?: Record<string, string> };

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
 * an expired session).
 */
function toOpenAIError(err: unknown, where: string): OpenAIError {
  const e = (err ?? {}) as SdkError;
  console.error(`[openai] ${where} failed (${e.status ?? 'no response'}):`, e.message);
  switch (gatewayErrorType(err)) {
    case 'insufficient_credits':
      return new OpenAIError(402, 'AI credits have run out. The app owner can add more in Billing.');
    case 'model_not_supported':
      return new OpenAIError(400, MODEL_UNAVAILABLE_MESSAGE);
    case 'per_project_hourly_cap':
    case 'per_project_daily_cap':
      return new OpenAIError(429, 'This app has reached its AI usage limit for now. Please try again later.');
    case 'wallet_concurrency_limit':
      return new OpenAIError(429, BUSY_MESSAGE);
  }
  const status = e.status;
  if (!status) return new OpenAIError(502, "Couldn't reach the AI service. Please try again.");
  if (status === 401 || status === 403) return new OpenAIError(503, NOT_CONFIGURED_MESSAGE);
  if (status === 402) return new OpenAIError(502, 'The AI provider account has a billing problem. The app owner needs to check it.');
  if (status === 429 && e.code && QUOTA_CODES.has(e.code)) {
    return new OpenAIError(502, "The AI provider's usage limit has been reached. The app owner needs to check the account.");
  }
  if (status === 429) return new OpenAIError(429, BUSY_MESSAGE);
  if (status === 404) return new OpenAIError(400, MODEL_UNAVAILABLE_MESSAGE);
  if (status === 400 || status === 413 || status === 422) {
    return new OpenAIError(400, "The AI couldn't process this request. Try shorter text or a smaller file.");
  }
  if (status >= 500) return new OpenAIError(502, 'The AI service is temporarily unavailable. Please try again.');
  return new OpenAIError(502, UNAVAILABLE_MESSAGE);
}

/** One chat completion. Throws OpenAIError (503 when not configured, 400 on empty input). */
export async function chatCompletion(args: ChatArgs): Promise<ChatResult> {
  if (!isOpenAIConfigured()) throw new OpenAIError(503, NOT_CONFIGURED_MESSAGE);
  const messages = (args.messages ?? [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content }));
  if (messages.length === 0) throw new OpenAIError(400, 'messages must contain at least one entry');

  try {
    const completion = await client().chat.completions.create({
      model: args.model || DEFAULT_CHAT_MODEL,
      max_tokens: Math.min(Math.max(Number(args.maxTokens) || 1024, 1), 4096),
      messages: args.system ? [{ role: 'system' as const, content: args.system }, ...messages] : messages,
    });
    return {
      content: completion.choices?.[0]?.message?.content ?? '',
      model: completion.model,
      finishReason: completion.choices?.[0]?.finish_reason ?? 'stop',
    };
  } catch (err) {
    throw toOpenAIError(err, 'chat');
  }
}

/** Embeddings for one or many strings. Throws OpenAIError. */
export async function embedText(args: EmbedArgs): Promise<EmbedResult> {
  if (!isOpenAIConfigured()) throw new OpenAIError(503, NOT_CONFIGURED_MESSAGE);
  const input = (Array.isArray(args.input) ? args.input : [args.input])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  if (input.length === 0) throw new OpenAIError(400, 'input is required');

  try {
    const result = await client().embeddings.create({ model: args.model || DEFAULT_EMBED_MODEL, input });
    return { embeddings: result.data.map((d) => d.embedding), model: result.model };
  } catch (err) {
    throw toOpenAIError(err, 'embed');
  }
}

/** Speech-to-text for one audio file. Throws OpenAIError (503 when not configured, 400 on empty/oversized audio). */
export async function transcribeAudio(args: TranscribeArgs): Promise<TranscribeResult> {
  if (!isOpenAIConfigured()) throw new OpenAIError(503, NOT_CONFIGURED_MESSAGE);
  if (!args.audio || args.audio.length === 0) throw new OpenAIError(400, 'audio is required');
  if (args.audio.length > MAX_AUDIO_BYTES) throw new OpenAIError(400, 'audio must be 25 MB or smaller');
  const filename = String(args.filename ?? '').trim() || 'audio.webm';
  const model = args.model || DEFAULT_TRANSCRIBE_MODEL;

  try {
    const result = await client().audio.transcriptions.create({
      file: await toFile(args.audio, filename),
      model,
      ...(args.language ? { language: args.language } : {}),
    });
    return { text: result.text ?? '', model };
  } catch (err) {
    throw toOpenAIError(err, 'transcribe');
  }
}

/**
 * Resolve the image input to what the chat API accepts: a data URL for bytes,
 * the URL itself for a hosted image. Throws OpenAIError(400) on bad input.
 */
function imageInputUrl(args: AnalyzeImageArgs): string {
  const hasBytes = Boolean(args.image && args.image.length > 0);
  const url = String(args.imageUrl ?? '').trim();
  if (hasBytes && url) throw new OpenAIError(400, 'pass either image or imageUrl, not both');
  if (hasBytes) {
    if (args.image!.length > MAX_IMAGE_BYTES) throw new OpenAIError(400, 'image must be 20 MB or smaller');
    const mime = String(args.mimeType ?? '').split(';')[0].trim().toLowerCase() || 'image/jpeg';
    if (!IMAGE_MIME_TYPES.has(mime)) throw new OpenAIError(400, 'image must be JPEG, PNG, GIF or WebP');
    return `data:${mime};base64,${args.image!.toString('base64')}`;
  }
  if (!url) throw new OpenAIError(400, 'image or imageUrl is required');
  if (!/^https?:\/\//i.test(url)) throw new OpenAIError(400, 'imageUrl must be an http(s) URL');
  return url;
}

/** Vision: ask the model about one image. Throws OpenAIError (503 when not configured, 400 on bad input). */
export async function analyzeImage(args: AnalyzeImageArgs): Promise<AnalyzeImageResult> {
  if (!isOpenAIConfigured()) throw new OpenAIError(503, NOT_CONFIGURED_MESSAGE);
  const prompt = String(args.prompt ?? '').trim();
  if (!prompt) throw new OpenAIError(400, 'prompt is required');
  const imageUrl = imageInputUrl(args);
  const detail: 'low' | 'high' | 'auto' = args.detail === 'low' || args.detail === 'high' ? args.detail : 'auto';

  // Typed against the SDK's param type: an untyped literal widens `detail` to
  // string and the create() overloads stop matching.
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...(args.system ? [{ role: 'system' as const, content: args.system }] : []),
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl, detail } },
      ],
    },
  ];
  try {
    const completion = await client().chat.completions.create({
      model: args.model || DEFAULT_VISION_MODEL,
      max_tokens: Math.min(Math.max(Number(args.maxTokens) || 1024, 1), 4096),
      messages,
    });
    return {
      content: completion.choices?.[0]?.message?.content ?? '',
      model: completion.model,
      finishReason: completion.choices?.[0]?.finish_reason ?? 'stop',
    };
  } catch (err) {
    // Upstream 400 here is almost always the IMAGE, not the request: a URL
    // OpenAI's fetcher cannot download (private bucket, hotlink-protected
    // host, expired signed URL) or bytes that are not a decodable image. That
    // is the caller's input, so answer 400 with a hint instead of the generic
    // 502 — seen live: a Wikimedia URL the model fetcher was refused for.
    if ((err as { status?: number }).status === 400 && !gatewayErrorType(err)) {
      console.error('[openai] vision rejected the image:', (err as Error).message);
      throw new OpenAIError(400, 'The image could not be read — make sure the URL is public and the file is a valid JPEG, PNG, GIF or WebP.');
    }
    throw toOpenAIError(err, 'vision');
  }
}

// ── HTTP surface — thin shells over the helpers ─────────────────────────────

function sendError(res: Response, err: unknown): Response {
  if (err instanceof OpenAIError) {
    if (err.status === 503) {
      return res.status(503).json({ error: 'integration_not_configured', integration: INTEGRATION, message: err.message });
    }
    return res.status(err.status).json({ message: err.message });
  }
  console.error('[openai] unexpected error:', err);
  return res.status(502).json({ message: UNAVAILABLE_MESSAGE });
}

// POST /api/ai/chat — { messages: [{role, content}], system?, model?, maxTokens? }
async function chat(req: Request, res: Response): Promise<any> {
  const body = (req.body ?? {}) as Partial<ChatArgs>;
  try {
    return res.json(
      await chatCompletion({
        messages: body.messages ?? [],
        system: body.system,
        model: body.model,
        maxTokens: body.maxTokens,
      }),
    );
  } catch (err) {
    return sendError(res, err);
  }
}

// POST /api/ai/embed — { input: string | string[], model? }
async function embed(req: Request, res: Response): Promise<any> {
  const body = (req.body ?? {}) as Partial<EmbedArgs>;
  try {
    return res.json(await embedText({ input: body.input ?? '', model: body.model }));
  } catch (err) {
    return sendError(res, err);
  }
}

// POST /api/ai/transcribe — { audioBase64: string, filename?: string, language?: string, model?: string }
async function transcribe(req: Request, res: Response): Promise<any> {
  const body = (req.body ?? {}) as { audioBase64?: string; filename?: string; language?: string; model?: string };
  try {
    const audio = Buffer.from(String(body.audioBase64 ?? ''), 'base64');
    return res.json(
      await transcribeAudio({ audio, filename: body.filename ?? 'audio.webm', language: body.language, model: body.model }),
    );
  } catch (err) {
    return sendError(res, err);
  }
}

// POST /api/ai/analyze-image — { prompt, imageBase64?, mimeType?, imageUrl?, system?, model?, maxTokens?, detail? }
async function analyze(req: Request, res: Response): Promise<any> {
  const body = (req.body ?? {}) as Partial<AnalyzeImageArgs> & { imageBase64?: string };
  try {
    const imageBase64 = String(body.imageBase64 ?? '').trim();
    return res.json(
      await analyzeImage({
        prompt: body.prompt ?? '',
        ...(imageBase64 ? { image: Buffer.from(imageBase64, 'base64'), mimeType: body.mimeType } : {}),
        imageUrl: body.imageUrl,
        system: body.system,
        model: body.model,
        maxTokens: body.maxTokens,
        detail: body.detail,
      }),
    );
  } catch (err) {
    return sendError(res, err);
  }
}

const router = Router();
// Authenticated: AI calls cost the owner real money, so they are not open to
// anonymous traffic. Drop jwtCheck only if the product genuinely needs a public
// AI surface, and add your own rate limiting if you do.
router.post('/chat', middleware.jwtCheck, chat);
router.post('/embed', middleware.jwtCheck, embed);
export default router;

/**
 * Transcription is mounted BEFORE the app's global express.json() (default
 * 100 kB limit) so a base64 audio body can reach it; the router carries its
 * own 34 MB parser (25 MB of audio, base64-inflated). The global parser skips
 * a body that is already parsed.
 */
export const transcribeRouter = Router();
transcribeRouter.use(express.json({ limit: '34mb' }));
transcribeRouter.post('/', middleware.jwtCheck, transcribe);

/**
 * Same reason as transcription: a base64 image body (20 MB, base64-inflated
 * to ~27 MB) would be rejected by the global 100 kB parser, so this router
 * mounts before it with its own limit. URL-only calls are tiny and fine either way.
 */
export const analyzeImageRouter = Router();
analyzeImageRouter.use(express.json({ limit: '28mb' }));
analyzeImageRouter.post('/', middleware.jwtCheck, analyze);
