/**
 * AES-256-GCM encryption/decryption for SystemConfig sensitive values.
 *
 * Key source: CONFIG_ENCRYPTION_KEY env var — must be exactly 64 hex chars (32 bytes).
 * Generate a new key:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Stored format:  <iv_hex>:<authTag_hex>:<ciphertext_hex>
 * All three parts are lower-case hex, joined by colons.
 *
 * ⚠  Changing CONFIG_ENCRYPTION_KEY after values have been saved makes all
 *    previously encrypted values unreadable.  The system will log a warning and
 *    fall back to the corresponding env-var for any key it cannot decrypt.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const REQUIRED_HEX_LEN = 64; // 32 bytes → 64 hex chars

// ── Key resolution ─────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const hex = process.env.CONFIG_ENCRYPTION_KEY ?? '';
  if (!hex) {
    throw new Error(
      'CONFIG_ENCRYPTION_KEY is not set. ' +
      'Generate one and add it to .env:\n' +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (hex.length !== REQUIRED_HEX_LEN) {
    throw new Error(
      `CONFIG_ENCRYPTION_KEY must be ${REQUIRED_HEX_LEN} hex characters (32 bytes). ` +
      `Got ${hex.length} chars.`,
    );
  }
  return Buffer.from(hex, 'hex');
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Encrypts a plaintext string.
 * Returns a colon-separated `iv:authTag:ciphertext` hex string.
 * Throws if CONFIG_ENCRYPTION_KEY is not set or invalid.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypts a value produced by `encrypt()`.
 * Throws if the key is wrong, the value is tampered, or CONFIG_ENCRYPTION_KEY is not set.
 */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted value format (expected iv:authTag:ciphertext)');
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Returns true if `value` looks like an encrypted blob produced by `encrypt()`.
 * Three colon-separated, non-empty, hex-only segments.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return (
    parts.length === 3 &&
    parts.every((p) => p.length > 0 && /^[0-9a-fA-F]+$/.test(p))
  );
}

/**
 * Returns whether CONFIG_ENCRYPTION_KEY is currently set and valid.
 * Use this before calling saveLlmConfig() to give a helpful error to the admin.
 */
export function isEncryptionKeyConfigured(): boolean {
  const hex = process.env.CONFIG_ENCRYPTION_KEY ?? '';
  return hex.length === REQUIRED_HEX_LEN;
}
