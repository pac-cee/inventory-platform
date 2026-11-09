// Small pure helpers for get-drive-refresh-token.mjs, kept separate so they can be
// tested. Nothing here talks to Google or the disk.
import crypto from "node:crypto";

/** A value without the stray spaces, quotes or line ending a paste / Windows-edited file leaves. */
export const clean = (v) => (v ?? "").replace(/^[\s"']+|[\s"']+$/g, "");

/**
 * A way to recognise a secret WITHOUT showing it: its last 6 characters, its length and
 * the start of its hash. Two different tokens never share all three, so comparing the
 * line printed before and after proves whether a value really changed.
 */
export function fingerprint(value) {
  const v = clean(value);
  if (!v) return "(not set)";
  const sha = crypto.createHash("sha256").update(v).digest("hex").slice(0, 8);
  return `...${v.slice(-6)} - ${v.length} characters - sha256 ${sha}`;
}

/** The value of KEY= in a .env-style text (handles CRLF files), or "". */
export function readEnvValue(text, key) {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(text ?? "");
  return m ? clean(m[1]) : "";
}

/**
 * The copy-and-paste file: plain text, LF line endings, no quotes, nothing but what
 * to enter on Railway. Separate from .env on purpose, so it can be opened, checked and
 * copied from without the Windows line endings that broke the sign-in once already.
 */
export function renderOutFile({ clientId, clientSecret, refreshToken, folderId, when = new Date() }) {
  const lines = [
    `# Written ${when.toISOString()} by get-drive-refresh-token.mjs`,
    "# Copy each value (only what is AFTER the = sign) into the Railway variables of the api service,",
    "# then DELETE THIS FILE: it contains secrets and must never be committed or shared.",
    `GOOGLE_OAUTH_CLIENT_ID=${clean(clientId)}`,
    `GOOGLE_OAUTH_CLIENT_SECRET=${clean(clientSecret)}`,
    `GOOGLE_OAUTH_REFRESH_TOKEN=${clean(refreshToken)}`,
  ];
  if (clean(folderId)) lines.push(`GOOGLE_DRIVE_EBM_FOLDER_ID=${clean(folderId)}`);
  return lines.join("\n") + "\n";
}
