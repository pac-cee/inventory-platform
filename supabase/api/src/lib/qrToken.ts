import crypto from "node:crypto";

/**
 * The code printed on a box's QR sticker.
 *
 * Crockford-style base32: no I, L, O or U, so a code read aloud or typed by hand
 * is not mixed up with 1 or 0. Ten characters is 50 bits — plenty for a few
 * thousand boxes, and not guessable by trying codes (the lookup also needs a
 * signed-in user).
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const QR_TOKEN_LENGTH = 10;

export function newQrToken(): string {
  const bytes = crypto.randomBytes(QR_TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < QR_TOKEN_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Accepts what a scanner or a person might hand over: any case, stray spaces. */
export function normalizeQrToken(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  return new RegExp(`^[${ALPHABET}]{${QR_TOKEN_LENGTH}}$`).test(t) ? t : null;
}
