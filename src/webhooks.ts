/**
 * Webhook signature verification (and signing, for your own tests).
 *
 * The header Natzar sends is
 *
 * ```
 * X-Natzar-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
 * ```
 *
 * where the digest covers `"<t>" + "." + rawBody`. Two rules make verification
 * actually protective rather than ceremonial, and both are enforced here:
 *
 *  1. **Verify the RAW bytes.** Sign-then-parse, never parse-then-re-serialize:
 *     `JSON.stringify(JSON.parse(body))` is a different byte string (key order,
 *     number formatting, whitespace) and will not match. Every function here
 *     takes the raw body and refuses to take a parsed object.
 *  2. **Bound the timestamp.** A valid signature is valid forever; the
 *     timestamp is what stops a captured delivery from being replayed
 *     tomorrow. The default tolerance is 5 minutes.
 *
 * Implemented on WebCrypto so one build works in Node 18+, Deno, Bun, Workers
 * and the browser — hence async. Comparison is constant-time; a byte-by-byte
 * `===` on a digest leaks how much of a forged signature was right.
 *
 * @packageDocumentation
 */

import {
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_VERSION,
  type WebhookEvent,
} from './contract/webhooks';

export {WEBHOOK_EVENT_HEADER, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_SIGNATURE_VERSION};

/** Default replay window, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Why a delivery failed verification. Never surface these to the sender. */
export type WebhookVerifyFailure =
  /** The header was absent, or not `t=…,v1=…`. */
  | 'malformed_signature'
  /** The timestamp is outside the tolerance — a replay, or badly skewed clocks. */
  | 'timestamp_out_of_tolerance'
  /** The digest does not match: wrong secret, or the body was altered. */
  | 'signature_mismatch'
  /** The signature verified but the body is not JSON — never expected. */
  | 'invalid_body';

/** Result of {@link verifyWebhook}. */
export type WebhookVerifyResult =
  | {valid: true; event: WebhookEvent; timestamp: number}
  | {valid: false; reason: WebhookVerifyFailure};

const encoder = new TextEncoder();

function subtle(): SubtleCrypto {
  const c = (globalThis as {crypto?: Crypto}).crypto;
  if (!c?.subtle) {
    throw new Error(
      'natzar-client: WebCrypto is unavailable. On Node < 18 do ' +
        '`globalThis.crypto = require("node:crypto").webcrypto` before verifying.',
    );
  }
  return c.subtle;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await subtle().importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, [
    'sign',
  ]);
  const mac = await subtle().sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time hex comparison. Length is not secret; content is. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The `t=…,v1=…` header, split. `null` when it is not that shape. */
export function parseSignatureHeader(header: string | null | undefined): {t: number; v1: string} | null {
  if (!header) return null;
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't') t = Number(value);
    else if (key === WEBHOOK_SIGNATURE_VERSION) v1 = value;
  }
  if (t === null || !Number.isFinite(t) || !v1 || !/^[0-9a-f]+$/i.test(v1)) return null;
  return {t, v1};
}

/**
 * Build the signature header for a body — the same computation the sender
 * performs.
 *
 * Exported so you can drive your own webhook endpoint in tests with genuinely
 * signed deliveries instead of stubbing verification out, which is the usual
 * way a signature check ends up never having been exercised.
 */
export async function signWebhook(args: {
  secret: string;
  rawBody: string;
  /** Unix SECONDS. Defaults to now. */
  timestamp?: number;
}): Promise<string> {
  const t = Math.floor(args.timestamp ?? Date.now() / 1000);
  const digest = await hmacHex(args.secret, `${t}.${args.rawBody}`);
  return `t=${t},${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

/**
 * Verify one delivery and return the typed event.
 *
 * @param args.rawBody - The EXACT bytes of the request body as a string. If
 * your framework parsed it for you, reconfigure it: an object cannot be
 * verified, and this function will not pretend otherwise.
 */
export async function verifyWebhook(args: {
  secret: string;
  rawBody: string;
  /** The `X-Natzar-Signature` header value. */
  signature: string | null | undefined;
  /** Replay window in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Current time in ms, for tests. */
  nowMs?: number;
}): Promise<WebhookVerifyResult> {
  const parsed = parseSignatureHeader(args.signature);
  if (!parsed) return {valid: false, reason: 'malformed_signature'};

  const tolerance = args.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = (args.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - parsed.t) > tolerance) {
    return {valid: false, reason: 'timestamp_out_of_tolerance'};
  }

  const expected = await hmacHex(args.secret, `${parsed.t}.${args.rawBody}`);
  if (!timingSafeEqualHex(parsed.v1, expected)) return {valid: false, reason: 'signature_mismatch'};

  try {
    return {valid: true, event: JSON.parse(args.rawBody) as WebhookEvent, timestamp: parsed.t};
  } catch {
    return {valid: false, reason: 'invalid_body'};
  }
}

/**
 * `verifyWebhook` for a standard `Request` (Workers, Deno, Node's undici, any
 * framework that hands you one).
 *
 * Reads the body itself, so the caller cannot accidentally verify a
 * re-serialized copy — which is the mistake this overload exists to make
 * impossible.
 */
export async function verifyWebhookRequest(
  req: Request,
  args: {secret: string; toleranceSeconds?: number; nowMs?: number},
): Promise<WebhookVerifyResult> {
  const rawBody = await req.text();
  return verifyWebhook({
    secret: args.secret,
    rawBody,
    signature: req.headers.get(WEBHOOK_SIGNATURE_HEADER),
    ...(args.toleranceSeconds !== undefined ? {toleranceSeconds: args.toleranceSeconds} : {}),
    ...(args.nowMs !== undefined ? {nowMs: args.nowMs} : {}),
  });
}

/**
 * Verify, then dispatch to a per-event handler.
 *
 * Deliveries retry, so the SAME event id can arrive twice. Deduplicate on
 * `event.id` before doing anything with side effects; `onDuplicate` is here so
 * that check has an obvious home rather than being remembered per handler.
 */
export async function handleWebhook(args: {
  secret: string;
  rawBody: string;
  signature: string | null | undefined;
  toleranceSeconds?: number;
  /** Return true if this event id was already processed. */
  seen?: (id: string) => boolean | Promise<boolean>;
  onEvent: (event: WebhookEvent) => void | Promise<void>;
  onDuplicate?: (event: WebhookEvent) => void | Promise<void>;
}): Promise<WebhookVerifyResult> {
  const result = await verifyWebhook({
    secret: args.secret,
    rawBody: args.rawBody,
    signature: args.signature,
    ...(args.toleranceSeconds !== undefined ? {toleranceSeconds: args.toleranceSeconds} : {}),
  });
  if (!result.valid) return result;
  if (args.seen && (await args.seen(result.event.id))) {
    await args.onDuplicate?.(result.event);
    return result;
  }
  await args.onEvent(result.event);
  return result;
}
