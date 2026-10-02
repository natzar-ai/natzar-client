// GENERATED FILE — do not edit.
//
// Copied verbatim from natzar-core's shared/partner-api by
// scripts/sync-contract.mjs. Edit the source there; this copy exists only so
// the published package is self-contained.
/**
 * Sealing the session credential to the frame key
 * (docs/EMBED-INTEGRATION-REDESIGN-PLAN.md §4.3, §4.5, review M1, RG0 F1/F4).
 *
 * The frame (or the browser SDK acting as one) generates a NON-EXTRACTABLE
 * ECDH P-256 key pair before anything else runs and sends only the public
 * key (`frameKey`, a JWK) in `hello-ack`. Natzar seals the `nz1` credential
 * to it; the customer's server, the host page, its recorders and fetch
 * patches relay ciphertext only, and a grant sealed to another frame's key
 * cannot be opened (fixation, T5).
 *
 * The AEAD also BINDS the grant: its additional data is a tuple of the
 * session's security facts that the frame rebuilds from ITS OWN knowledge
 * (configuration, bound `hello`, own URL, own key), never from the relayed
 * grant. A page that rewrites `parentOrigin`, `frameUrl`, the surface or the
 * partner, or swaps the ephemeral or recipient key (including the negated
 * points −E and −Q, which give the same ECDH x-coordinate), gets
 * `unseal_failed` (RG0 F1, F4).
 *
 * ## Format (version 2, pinned)
 *
 * ```
 * epk   = fresh ephemeral ECDH P-256 key pair (one per seal)
 * Z     = ECDH(epk.private, frameKey)                  32 bytes (x coordinate)
 * K     = HKDF-SHA256(ikm = Z, salt = SEALING_HKDF_SALT, info = SEALING_HKDF_INFO, L = 32)
 * iv    = 12 random bytes
 * aad   = UTF-8(JSON.stringify([SEALING_AAD_TAG, partnerId, environment, zone, audience, surface,
 *                               sessionId, parentOrigin, frameUrl, frameKeyThumbprint, epk.x, epk.y]))
 *         (frameUrl is null for `headless`; frameKeyThumbprint is RFC 7638 of the recipient key)
 * ct    = AES-256-GCM(K, iv, plaintext = nz1 token (70 ASCII bytes), aad) = ciphertext ‖ 16-byte tag
 * sealedToken = {epk: {kty, crv, x, y} of epk.public, iv: base64url(iv), ct: base64url(ct)}
 * ```
 *
 * Every tuple member is a validated ASCII string (or null), so the JSON
 * encoding is unambiguous. base64url is unpadded and canonical (RFC 4648 §5):
 * `iv` is 16 characters, `ct` 115, JWK coordinates 43. After decryption the
 * plaintext must be a well-formed `nz1` credential of that same session.
 *
 * One implementation over WebCrypto (`globalThis.crypto.subtle`), for Node
 * ≥ 20 and browsers. Imports no zod and uses no DOM types. Fixed test vectors
 * are built in the tests from the same pinned format; the exported sealer
 * has no deterministic path (RG0 F5).
 *
 * @packageDocumentation
 */

import {
  API_KEY_ZONES,
  DEPLOYMENT_ENVIRONMENT_REGEX,
  LOGIN_REF_PREFIX,
  NZ1_SESSION_ID_REGEX,
  NZ1_TOKEN_LENGTH,
  PARTNER_ID_REGEX,
  SESSION_AUDIENCES,
  isFrameSurface,
  isSurfaceOf,
  parseNz1Token,
  type SessionAudience,
  type SessionSurface,
  type SessionZone,
} from './sessions';
import type {P256PublicJwk, SealedToken} from './sessions-schemas';
import {isCanonicalParentOrigin} from './sessions-origins';

/** Descriptive name of the sealing scheme. */
export const SEALING_ALGORITHM = 'ECDH-ES/P-256+HKDF-SHA256+A256GCM' as const;
/** HKDF salt (UTF-8). Changing it is a new sealing version. */
export const SEALING_HKDF_SALT = 'natzar/nz1-seal/v2/salt' as const;
/** HKDF info (UTF-8). Changing it is a new sealing version. */
export const SEALING_HKDF_INFO = 'natzar/nz1-seal/v2/A256GCM' as const;
/** First member of the AAD tuple. Changing the tuple is a new sealing version. */
export const SEALING_AAD_TAG = 'natzar/nz1-seal/v2' as const;
/** AES-GCM IV length in bytes. */
export const SEALING_IV_BYTES = 12;
/** AES-GCM tag length in bytes. */
export const SEALING_TAG_BYTES = 16;
/** `iv`: 12 bytes, base64url (16 characters, no padding). */
export const SEALED_IV_REGEX = /^[A-Za-z0-9_-]{16}$/;
/** `ct`: the 70-byte credential plus the 16-byte tag, base64url (115 characters, the last one of 16). */
export const SEALED_CT_REGEX = /^[A-Za-z0-9_-]{114}[AEIMQUYcgkosw048]$/;
/** A P-256 JWK coordinate: 32 bytes, base64url (43 characters, the last one of 16). */
export const P256_COORDINATE_REGEX = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/** Structural subset of WebCrypto's `CryptoKey` (keeps this contract DOM-free). */
export interface CryptoKeyLike {
  /** `public`, `private` or `secret`. */
  readonly type: string;
  /** Whether the key material can be exported. The frame's private key must not be. */
  readonly extractable: boolean;
  /** The key's algorithm. */
  readonly algorithm: object;
  /** Permitted operations. */
  readonly usages: readonly string[];
}

/** The frame's key pair: the private key never leaves WebCrypto; the public JWK goes into `hello-ack`. */
export interface FrameKeyPair {
  /** Non-extractable ECDH P-256 private key (`deriveBits` only). */
  privateKey: CryptoKeyLike;
  /** The public key as a minimal JWK (`kty`, `crv`, `x`, `y`). */
  publicJwk: P256PublicJwk;
}

/** Why a sealing operation failed. Deliberately coarse: an unseal failure never says which check failed. */
export type SealingErrorCode = 'invalid_input' | 'unseal_failed' | 'webcrypto_unavailable';

/** A sealing failure. `message` never contains key material, ciphertext or the credential. */
export class SealingError extends Error {
  /** Machine-readable reason. */
  readonly code: SealingErrorCode;
  constructor(code: SealingErrorCode) {
    super(`nz1 sealing: ${code}`);
    this.name = 'SealingError';
    this.code = code;
  }
}

// The subset of SubtleCrypto used here, typed structurally (the platform and
// the SDK compile this file with different lib settings).
interface SubtleLike {
  importKey(format: string, keyData: object, algorithm: object | string, extractable: boolean, usages: string[]): Promise<CryptoKeyLike>;
  generateKey(algorithm: object, extractable: boolean, usages: string[]): Promise<{publicKey: CryptoKeyLike; privateKey: CryptoKeyLike}>;
  exportKey(format: 'jwk', key: CryptoKeyLike): Promise<Record<string, unknown>>;
  deriveBits(algorithm: object, baseKey: CryptoKeyLike, length: number): Promise<ArrayBuffer>;
  deriveKey(algorithm: object, baseKey: CryptoKeyLike, derivedKeyType: object, extractable: boolean, usages: string[]): Promise<CryptoKeyLike>;
  encrypt(algorithm: object, key: CryptoKeyLike, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algorithm: object, key: CryptoKeyLike, data: Uint8Array): Promise<ArrayBuffer>;
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}
interface CryptoLike {
  subtle: SubtleLike;
  getRandomValues(array: Uint8Array): Uint8Array;
}

function webCrypto(): CryptoLike {
  const c = (globalThis as unknown as {crypto?: Partial<CryptoLike>}).crypto;
  if (!c || typeof c.subtle !== 'object' || typeof c.getRandomValues !== 'function') throw new SealingError('webcrypto_unavailable');
  return c as CryptoLike;
}

const ECDH_P256 = {name: 'ECDH', namedCurve: 'P-256'} as const;
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// ------------------------------------------------------------- base64url

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url of `bytes`. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[n >> 18] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64URL[n >> 18] + B64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63];
  }
  return out;
}

/**
 * The bytes of CANONICAL unpadded base64url `text`, or null: no padding, no
 * other alphabet, no impossible length, and the unused low bits of the last
 * character must be zero (so every byte string has exactly one encoding).
 */
export function base64UrlDecode(text: string): Uint8Array | null {
  if (typeof text !== 'string' || text.length % 4 === 1) return null;
  const values: number[] = [];
  for (const ch of text) {
    const v = B64URL.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < values.length; i += 4) {
    const n = (values[i] << 18) | ((values[i + 1] ?? 0) << 12) | ((values[i + 2] ?? 0) << 6) | (values[i + 3] ?? 0);
    const left = values.length - i;
    out[o++] = (n >> 16) & 255;
    if (left > 2) out[o++] = (n >> 8) & 255;
    if (left > 3) out[o++] = n & 255;
    if (left === 2 && (n & 0xffff) !== 0) return null;
    if (left === 3 && (n & 0xff) !== 0) return null;
  }
  return out;
}

// ------------------------------------------------------------------- JWK

/** Whether `value` is exactly a P-256 public JWK `{kty:'EC', crv:'P-256', x, y}` with canonical coordinates. */
export function isP256PublicJwk(value: unknown): value is P256PublicJwk {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort();
  return keys.length === 4 && keys.join() === 'crv,kty,x,y' && v.kty === 'EC' && v.crv === 'P-256'
    && typeof v.x === 'string' && P256_COORDINATE_REGEX.test(v.x) && typeof v.y === 'string' && P256_COORDINATE_REGEX.test(v.y);
}

/** The minimal public JWK of an exported key (drops `ext`, `key_ops` and anything else), or throws. */
export function publicJwkOf(jwk: Record<string, unknown>): P256PublicJwk {
  const out = {kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y};
  if (!isP256PublicJwk(out)) throw new SealingError('invalid_input');
  return out;
}

async function importPublic(subtle: SubtleLike, jwk: P256PublicJwk): Promise<CryptoKeyLike> {
  // WebCrypto rejects a point that is not on the curve.
  return subtle.importKey('jwk', {...jwk, ext: true}, ECDH_P256, true, []);
}

async function aesKey(subtle: SubtleLike, privateKey: CryptoKeyLike, publicKey: CryptoKeyLike, usage: 'encrypt' | 'decrypt'): Promise<CryptoKeyLike> {
  const z = new Uint8Array(await subtle.deriveBits({name: 'ECDH', public: publicKey}, privateKey, 256));
  const ikm = await subtle.importKey('raw', z, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {name: 'HKDF', hash: 'SHA-256', salt: utf8(SEALING_HKDF_SALT), info: utf8(SEALING_HKDF_INFO)},
    ikm, {name: 'AES-GCM', length: 256}, false, [usage],
  );
}

/**
 * A fresh frame key pair: the private key NON-EXTRACTABLE with `deriveBits`
 * only, the public key as a minimal JWK. Called by the frame shell's boot
 * script before the bundle loads, and by the browser SDK.
 */
export async function generateFrameKeyPair(): Promise<FrameKeyPair> {
  const {subtle} = webCrypto();
  const pair = await subtle.generateKey(ECDH_P256, false, ['deriveBits']);
  return {privateKey: pair.privateKey, publicJwk: publicJwkOf(await subtle.exportKey('jwk', pair.publicKey))};
}

/**
 * The facts a sealed credential is bound to (the AAD tuple minus the two
 * keys). The SERVER fills it from the session record; the FRAME fills it
 * from its own configuration (`partnerId`, `environment`, `zone`), its path
 * (`audience`), the bound `hello` (`surface`, `parentOrigin` = the bound
 * origin), its own URL (`frameUrl`) and `grant.sessionId`; the browser SDK
 * from its own deployment, surface `headless`, `parentOrigin =
 * location.origin` and `frameUrl: null`.
 */
export interface SealBinding {
  /** The partner. */
  partnerId: string;
  /** The deployment environment. */
  environment: string;
  /** The residency zone. */
  zone: SessionZone;
  /** The audience. */
  audience: SessionAudience;
  /** The surface (never `native`: it is not sealed). */
  surface: SessionSurface;
  /** The session. */
  sessionId: string;
  /** The exact embedding origin (the frame's bound origin; the page origin for `headless`). */
  parentOrigin: string;
  /** The frame's own URL (`frameUrlFor`); null for `headless`, which has no frame. */
  frameUrl: string | null;
}

function validBinding(b: unknown): b is SealBinding {
  if (typeof b !== 'object' || b === null) return false;
  const v = b as Record<string, unknown>;
  if (!(SESSION_AUDIENCES as readonly unknown[]).includes(v.audience)) return false;
  const audience = v.audience as SessionAudience;
  if (!isSurfaceOf(audience, v.surface) || v.surface === 'native') return false;
  const frameUrlOk = v.frameUrl === null
    ? v.surface === 'headless'
    : typeof v.frameUrl === 'string' && /^https?:\/\/[\x21-\x7e]{1,2040}$/.test(v.frameUrl) && isFrameSurface(audience, v.surface);
  return frameUrlOk
    && typeof v.partnerId === 'string' && PARTNER_ID_REGEX.test(v.partnerId)
    && typeof v.environment === 'string' && DEPLOYMENT_ENVIRONMENT_REGEX.test(v.environment)
    && (API_KEY_ZONES as readonly unknown[]).includes(v.zone)
    && typeof v.sessionId === 'string' && NZ1_SESSION_ID_REGEX.test(v.sessionId)
    && isCanonicalParentOrigin(v.parentOrigin);
}

/**
 * The AAD of a seal: the UTF-8 of `JSON.stringify` of the pinned tuple (see
 * the module doc). Pure and exported so the server, the frames, the SDK and
 * independent test implementations build exactly the same bytes. Throws
 * `invalid_input` for a malformed binding, thumbprint or key.
 */
export function sealingAad(binding: SealBinding, frameKeyThumbprintValue: string, epk: P256PublicJwk): string {
  if (!validBinding(binding) || !/^[A-Za-z0-9_-]{43}$/.test(frameKeyThumbprintValue) || !isP256PublicJwk(epk)) {
    throw new SealingError('invalid_input');
  }
  const b = binding;
  return JSON.stringify([
    SEALING_AAD_TAG, b.partnerId, b.environment, b.zone, b.audience, b.surface, b.sessionId, b.parentOrigin, b.frameUrl,
    frameKeyThumbprintValue, epk.x, epk.y,
  ]);
}

/**
 * Seal `token` (the session's `nz1` credential) to the frame's public key,
 * bound to `binding` (server side, at mint and renew). Every seal uses a
 * fresh ephemeral key and IV. Throws `invalid_input` when the token is
 * malformed or belongs to another session, the binding is malformed, or
 * `frameKey` is not a valid P-256 public key.
 */
export async function sealToFrameKey(token: string, frameKey: P256PublicJwk, binding: SealBinding): Promise<SealedToken> {
  const wc = webCrypto();
  const {subtle} = wc;
  if (!validBinding(binding) || parseNz1Token(token)?.sessionId !== binding.sessionId || !isP256PublicJwk(frameKey)) {
    throw new SealingError('invalid_input');
  }
  let recipient: CryptoKeyLike;
  try {
    recipient = await importPublic(subtle, frameKey);
  } catch {
    throw new SealingError('invalid_input');
  }
  const pair = await subtle.generateKey(ECDH_P256, false, ['deriveBits']);
  const epk = publicJwkOf(await subtle.exportKey('jwk', pair.publicKey));
  const aad = sealingAad(binding, await frameKeyThumbprint(frameKey), epk);
  const iv = wc.getRandomValues(new Uint8Array(SEALING_IV_BYTES));
  const key = await aesKey(subtle, pair.privateKey, recipient, 'encrypt');
  const ct = new Uint8Array(await subtle.encrypt({name: 'AES-GCM', iv, additionalData: utf8(aad), tagLength: SEALING_TAG_BYTES * 8}, key, utf8(token)));
  return {epk, iv: base64UrlEncode(iv), ct: base64UrlEncode(ct)};
}

/** Whether `key` is a non-extractable ECDH P-256 private key (the only kind a frame may unseal with; RG0 N1). */
function isFramePrivateKey(key: unknown): key is CryptoKeyLike {
  if (typeof key !== 'object' || key === null) return false;
  const k = key as {type?: unknown; extractable?: unknown; algorithm?: {name?: unknown; namedCurve?: unknown}};
  return k.type === 'private' && k.extractable === false && k.algorithm?.name === 'ECDH' && k.algorithm?.namedCurve === 'P-256';
}

/**
 * Open a sealed credential with the frame's key pair (its non-extractable
 * private key and its own public JWK), checking the binding the frame
 * rebuilt from its own facts. Returns the `nz1` credential of
 * `binding.sessionId`; throws `invalid_input` for a malformed input or an
 * extractable/foreign key, and `unseal_failed` for anything cryptographic
 * (another frame's key, a rewritten tuple member, a modified `epk`, `iv` or
 * `ct`, or a plaintext that is not this session's credential), without
 * saying which.
 */
export async function unsealWithPrivateKey(sealed: SealedToken, frame: FrameKeyPair, binding: SealBinding): Promise<string> {
  const {subtle} = webCrypto();
  if (typeof sealed !== 'object' || sealed === null || !isP256PublicJwk(sealed.epk) || typeof sealed.iv !== 'string'
    || !SEALED_IV_REGEX.test(sealed.iv) || typeof sealed.ct !== 'string' || !SEALED_CT_REGEX.test(sealed.ct)
    || typeof frame !== 'object' || frame === null || !isFramePrivateKey(frame.privateKey) || !isP256PublicJwk(frame.publicJwk)
    || !validBinding(binding)) {
    throw new SealingError('invalid_input');
  }
  const iv = base64UrlDecode(sealed.iv);
  const ct = base64UrlDecode(sealed.ct);
  if (!iv || !ct || iv.length !== SEALING_IV_BYTES || ct.length !== NZ1_TOKEN_LENGTH + SEALING_TAG_BYTES) throw new SealingError('invalid_input');
  const aad = sealingAad(binding, await frameKeyThumbprint(frame.publicJwk), sealed.epk);
  let token: string;
  try {
    const epk = await importPublic(subtle, sealed.epk);
    const key = await aesKey(subtle, frame.privateKey, epk, 'decrypt');
    const pt = await subtle.decrypt({name: 'AES-GCM', iv, additionalData: utf8(aad), tagLength: SEALING_TAG_BYTES * 8}, key, ct);
    token = new TextDecoder('utf-8', {fatal: true}).decode(pt);
  } catch {
    throw new SealingError('unseal_failed');
  }
  if (parseNz1Token(token)?.sessionId !== binding.sessionId) throw new SealingError('unseal_failed');
  return token;
}

/**
 * RFC 7638 thumbprint of a P-256 public JWK: base64url(SHA-256 of
 * `{"crv":"P-256","kty":"EC","x":"…","y":"…"}`), 43 characters. The session
 * record stores it as `frameKeyThumbprint`; a renewal must present the same
 * key.
 */
export async function frameKeyThumbprint(jwk: P256PublicJwk): Promise<string> {
  if (!isP256PublicJwk(jwk)) throw new SealingError('invalid_input');
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return base64UrlEncode(new Uint8Array(await webCrypto().subtle.digest('SHA-256', utf8(canonical))));
}

/**
 * `loginRef` of a customer login id: lower-case hex SHA-256 of
 * `natzar-login:<login>` (§4.7 rule 5). Computed on the customer's server;
 * the raw id never leaves it.
 */
export async function loginRefFor(login: string): Promise<string> {
  if (typeof login !== 'string' || login.length === 0) throw new SealingError('invalid_input');
  const digest = new Uint8Array(await webCrypto().subtle.digest('SHA-256', utf8(`${LOGIN_REF_PREFIX}${login}`)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
