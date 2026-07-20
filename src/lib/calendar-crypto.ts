// AES-256-GCM encryption helpers for Google Calendar OAuth tokens at rest.
//
// Key: process.env.CALENDAR_TOKEN_KEY, a base64-encoded 32-byte key. If the
// env var is absent (Karl hasn't set it up yet), we store tokens in PLAINTEXT
// and log a single warning — the calendar feature still works end-to-end,
// just without encryption at rest, so nothing crashes/blocks Phase 3 rollout
// before Karl provisions the key. Random IV per value (never fixed-salt/IV —
// that's banned) so identical plaintexts never produce identical ciphertexts.
//
// Ciphertext format: `enc:v1:<ivBase64>:<authTagBase64>:<ciphertextBase64>`
// The `enc:v1:` prefix lets decryptToken tell an encrypted value apart from a
// plaintext value stored before a key existed (or while no key is set), so
// rotating the key in later just works without a data migration.

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const ENC_PREFIX = "enc:v1:";
const IV_LENGTH = 12; // 96-bit IV, standard for GCM

let warnedNoKey = false;

function getKey(): Buffer | null {
  const raw = process.env.CALENDAR_TOKEN_KEY;
  if (!raw) {
    if (!warnedNoKey) {
      console.warn(
        "[calendar-crypto] CALENDAR_TOKEN_KEY is not set — calendar tokens will be stored in PLAINTEXT. Set a base64-encoded 32-byte key to enable encryption at rest.",
      );
      warnedNoKey = true;
    }
    return null;
  }
  try {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
      if (!warnedNoKey) {
        console.warn(
          `[calendar-crypto] CALENDAR_TOKEN_KEY is set but is not a valid base64-encoded 32-byte key (got ${key.length} bytes) — falling back to PLAINTEXT storage.`,
        );
        warnedNoKey = true;
      }
      return null;
    }
    return key;
  } catch {
    if (!warnedNoKey) {
      console.warn(
        "[calendar-crypto] CALENDAR_TOKEN_KEY could not be base64-decoded — falling back to PLAINTEXT storage.",
      );
      warnedNoKey = true;
    }
    return null;
  }
}

/**
 * Encrypts a token string for storage. No-ops (returns the plaintext
 * unchanged) if CALENDAR_TOKEN_KEY is absent/invalid — callers never need to
 * branch on whether encryption is active.
 */
export function encryptToken(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH); // random IV per value, never fixed
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return (
    ENC_PREFIX +
    [
      iv.toString("base64"),
      authTag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":")
  );
}

/**
 * Decrypts a stored token string. Gracefully returns the input unchanged if
 * it isn't in the `enc:v1:` format (plaintext fallback / no key case), and
 * returns null (logging) if decryption fails outright (e.g. key rotated).
 */
export function decryptToken(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(ENC_PREFIX)) return stored; // plaintext, pass through

  const key = getKey();
  if (!key) {
    console.warn(
      "[calendar-crypto] Encountered an encrypted token but CALENDAR_TOKEN_KEY is not set — cannot decrypt.",
    );
    return null;
  }

  const parts = stored.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) {
    console.warn("[calendar-crypto] Malformed encrypted token value.");
    return null;
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    console.warn(
      "[calendar-crypto] Failed to decrypt stored token (wrong/rotated key?).",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
