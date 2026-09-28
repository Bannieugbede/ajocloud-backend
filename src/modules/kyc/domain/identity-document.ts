import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * The NIN document uploaded at stage 2 (ADR-015).
 *
 * A photo of an identity document is the most sensitive thing the platform
 * holds, so it is encrypted before it reaches the database, with a key derived
 * for this purpose alone. A copy of the database without the deployment's
 * secret holds nothing readable.
 */

/** The request body limit is 1 MiB, and base64 adds a third. */
export const MAX_DOCUMENT_BYTES = 700 * 1024;

export type DocumentContentType = 'image/jpeg' | 'image/png' | 'application/pdf';

const SIGNATURES: readonly { type: DocumentContentType; bytes: readonly number[] }[] = [
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

export type DocumentProblem = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'TYPE_MISMATCH';

/**
 * Decodes and checks an upload. The declared type must agree with the file's
 * own signature: trusting the declared type alone would let anything be stored
 * under an image's name.
 */
export function inspectDocument(
  base64: string,
  declaredType: string,
):
  | { ok: true; bytes: Buffer; contentType: DocumentContentType }
  | { ok: false; problem: DocumentProblem } {
  const bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (bytes.length === 0) return { ok: false, problem: 'EMPTY' };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, problem: 'TOO_LARGE' };
  const detected = SIGNATURES.find((signature) =>
    signature.bytes.every((byte, index) => bytes[index] === byte),
  );
  if (!detected) return { ok: false, problem: 'UNSUPPORTED_TYPE' };
  if (detected.type !== declaredType) return { ok: false, problem: 'TYPE_MISMATCH' };
  return { ok: true, bytes, contentType: detected.type };
}

export function contentDigest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A key used for nothing but documents, so rotating it touches nothing else. */
export function documentKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'ajocloud', 'kyc-document-v1', 32));
}

/** version (1) ‖ iv (12) ‖ tag (16) ‖ ciphertext. */
export function encryptDocument(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), body]);
}

export function decryptDocument(sealed: Buffer, key: Buffer): Buffer {
  if (sealed[0] !== FORMAT_VERSION) throw new Error('Unknown document format');
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(sealed.subarray(1 + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}
