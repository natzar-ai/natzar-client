/**
 * Attachments, in one call.
 *
 * Sending a file is three steps — presign, PUT the bytes, reference the staging
 * key on the message — and the middle one is the only place where getting it
 * subtly wrong is easy: the `Content-Type` of the PUT must match the
 * `mimeType` the slot was signed for, or S3 rejects the upload with a
 * signature error that says nothing about content types.
 *
 * @packageDocumentation
 */

import type {NatzarClient, CallOptions} from './client';
import type {CreateUploadUrlsRequest} from './contract/endpoints';

/** One file to send, as bytes plus the metadata the transcript will show. */
export interface UploadInput {
  /** Name shown on the transcript. */
  fileName: string;
  /** MIME type. Must be one the platform accepts (images, PDF, CSV, text, docx, xlsx). */
  mimeType: string;
  /** The bytes. A `Blob`/`File` in the browser, a `Uint8Array`/`ArrayBuffer` anywhere. */
  data: Blob | ArrayBuffer | Uint8Array;
}

/** A staged file, ready to reference on a message or reply post. */
export interface StagedAttachment {
  stagingKey: string;
  fileName: string;
  mimeType: string;
}

function byteLength(data: UploadInput['data']): number {
  if (data instanceof Uint8Array) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.size;
}

function toBody(data: UploadInput['data']): BodyInit {
  if (data instanceof Uint8Array) {
    // Copy into a standalone buffer: a Uint8Array view over a larger pool
    // would otherwise upload the whole pool.
    return data.slice().buffer as ArrayBuffer;
  }
  return data as BodyInit;
}

/**
 * Presign, upload, and return the staging keys — in the SAME order as `files`,
 * which is what lets you zip them back onto your own metadata.
 *
 * Pass the result straight to `attachments` on a message post:
 *
 * ```ts
 * const staged = await uploadAttachments(natzar, {externalPatientId: 'u_42', files: [photo]});
 * await natzar.agent.send({externalPatientId: 'u_42', text: 'Does this look infected?', attachments: staged});
 * ```
 *
 * Staged files that are never referenced are garbage-collected, so an
 * abandoned upload costs nothing.
 */
export async function uploadAttachments(
  client: NatzarClient,
  args: {
    /** Our patient id. Provide this OR `externalPatientId`. */
    patientId?: string;
    /** Your patient id. Provide this OR `patientId`. */
    externalPatientId?: string;
    files: UploadInput[];
    /** The `fetch` for the S3 PUTs. Defaults to the global one. */
    fetch?: typeof fetch;
    signal?: AbortSignal;
  } & CallOptions,
): Promise<StagedAttachment[]> {
  if (args.files.length === 0) return [];
  const doFetch = args.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('natzar-client: no global fetch — pass one via `fetch`.');

  const body = {
    ...(args.patientId ? {patientId: args.patientId} : {}),
    ...(args.externalPatientId ? {externalPatientId: args.externalPatientId} : {}),
    files: args.files.map((f) => ({
      fileName: f.fileName,
      mimeType: f.mimeType,
      sizeBytes: byteLength(f.data),
    })),
  } as CreateUploadUrlsRequest;

  const {uploads} = await client.attachments.createUploadUrls(
    body,
    args.signal ? {signal: args.signal} : {},
  );

  // Slots come back in request order — that is the contract, and it is what
  // makes this zip safe.
  return Promise.all(
    uploads.map(async (slot, i) => {
      const file = args.files[i];
      const res = await doFetch(slot.uploadUrl, {
        method: 'PUT',
        // MUST match the mimeType the slot was signed with. A mismatch fails
        // as an opaque S3 signature error, so it is set from the same value
        // rather than from the Blob's own type.
        headers: {'Content-Type': file.mimeType},
        body: toBody(file.data),
        ...(args.signal ? {signal: args.signal} : {}),
      });
      if (!res.ok) {
        throw new Error(`natzar-client: upload of "${file.fileName}" failed (${res.status})`);
      }
      return {stagingKey: slot.stagingKey, fileName: file.fileName, mimeType: file.mimeType};
    }),
  );
}
