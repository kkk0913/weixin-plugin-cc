import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-128-ECB is required here because WeChat's CDN media protocol uses ECB payloads.
const ALGORITHM = 'aes-128-ecb';
const KEY_LENGTH = 16;

/**
 * Generate a random 16-byte AES key (hex encoded).
 */
export function generateAesKey(): string {
  return randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Encrypt plaintext with AES-128-ECB, returning base64 ciphertext.
 */
export function encryptAesEcb(plaintext: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  const cipher = createCipheriv(ALGORITHM, key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/**
 * Decrypt AES-128-ECB ciphertext (base64) back to plaintext.
 */
export function decryptAesEcb(ciphertext: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Calculate the AES-padded size for a given file size.
 * PKCS7 padding rounds up to the next 16-byte boundary.
 */
export function aesEcbPaddedSize(size: number): number {
  return size + (16 - (size % 16));
}
