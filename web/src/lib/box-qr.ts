/**
 * What a box's QR sticker says. Same family as the item code
 * (`inventory:item:<id>`), so one scanner reads both: `inventory:box:<code>`.
 *
 * The code is the one the API assigned when the location became a box (ten
 * characters, no I, L, O or U). It never changes, so a printed label stays valid.
 */
const PREFIX = "inventory:box:";
const CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

export function boxQrData(token: string): string {
  return `${PREFIX}${token}`;
}

/** The box code in a scanned value, or null for anything that is not a box code. */
export function parseBoxQr(raw: string): string | null {
  const v = raw.trim();
  if (!v.toLowerCase().startsWith(PREFIX)) return null;
  const token = v.slice(PREFIX.length).trim().toUpperCase();
  return CODE.test(token) ? token : null;
}
