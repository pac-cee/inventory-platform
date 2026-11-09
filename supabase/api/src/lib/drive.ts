import { google } from "googleapis"
import { Readable } from "stream"

// Helper to convert a Buffer into a Readable stream, which googleapis expects
function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable()
  stream.push(buffer)
  stream.push(null)
  return stream
}

/**
 * Uploads an EBM receipt to the shared Google Drive directory.
 * @param fileBuffer The raw bytes of the uploaded file.
 * @param originalName The original file name (e.g. "receipt.pdf").
 * @param mimeType The file's MIME type (e.g. "application/pdf").
 * @returns The Google Drive File ID of the uploaded document.
 */
/** An environment value without the stray spaces, quotes or line ending a paste or a Windows-edited file can leave. */
const clean = (v: string | undefined): string => (v ?? "").replace(/^[\s"']+|[\s"']+$/g, "")

export async function uploadEbmReceipt(fileBuffer: Buffer, originalName: string, mimeType: string): Promise<string> {
  // 1. Ensure we have the credentials.
  // Auth is OAuth as a real Google account, not a service account: service
  // accounts have no Drive storage quota of their own, and the Shared Drive
  // workaround for that requires Google Workspace. Get GOOGLE_OAUTH_* values
  // by running `node get-drive-refresh-token.mjs` once (see that file).
  const GOOGLE_OAUTH_CLIENT_ID = clean(process.env.GOOGLE_OAUTH_CLIENT_ID)
  const GOOGLE_OAUTH_CLIENT_SECRET = clean(process.env.GOOGLE_OAUTH_CLIENT_SECRET)
  const GOOGLE_OAUTH_REFRESH_TOKEN = clean(process.env.GOOGLE_OAUTH_REFRESH_TOKEN)
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN) {
    throw Object.assign(
      new Error("Missing Google Drive OAuth credentials in environment variables (GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET/GOOGLE_OAUTH_REFRESH_TOKEN)."),
      { driveReason: "not_configured" as DriveReason },
    )
  }

  // Use the folder ID provided by the user (or from env in production)
  const folderId = clean(process.env.GOOGLE_DRIVE_EBM_FOLDER_ID) || "1YW2YHTOs1jOCqUL9jwrnj_SHzpSwSQyg"

  // 2. Authenticate as the account that authorized the refresh token.
  const auth = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET)
  auth.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN })

  const drive = google.drive({ version: "v3", auth })

  // 3. Upload the file
  try {
    const response = await drive.files.create({
      requestBody: {
        name: `${Date.now()}_${originalName}`,
        parents: [folderId],
      },
      media: {
        mimeType: mimeType,
        body: bufferToStream(fileBuffer),
      },
      fields: "id",
      // Required for the target folder to live in a Shared Drive — service
      // accounts have no personal storage quota, so a Shared Drive is the
      // only place they can create files without domain-wide delegation.
      supportsAllDrives: true,
    })

    if (!response.data.id) {
      throw new Error("Google Drive returned an empty file ID.")
    }

    return response.data.id
  } catch (error: any) {
    console.error("[Drive API Error]", error)
    throw Object.assign(new Error(`Failed to upload file to Google Drive: ${error.message}`), {
      driveReason: classifyDriveError(error).reason,
    })
  }
}


// ── Diagnosing Drive problems ───────────────────────────────────────────────

export type DriveReason =
  | "not_configured"
  | "client_rejected"
  | "token_rejected"
  | "scope_insufficient"
  | "folder_not_found"
  | "permission_denied"
  | "quota"
  | "network"
  | "unknown"

/** What went wrong with Google Drive, and what to do about it. Never contains a secret. */
export function classifyDriveError(err: any): { reason: DriveReason; fix: string } {
  const text = [err?.message, err?.response?.data?.error, err?.response?.data?.error_description, err?.code]
    .map((x) => (typeof x === "string" ? x : x?.message ?? ""))
    .join(" ")
  const status = Number(err?.response?.status ?? err?.status ?? (typeof err?.code === "number" ? err.code : 0))

  // Before everything that looks for "not found": ENOTFOUND (a DNS failure) contains those letters.
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(text)) {
    return { reason: "network", fix: "The server could not reach Google. Try again; if it persists, check the host's network." }
  }
  if (/Missing Google Drive OAuth credentials/i.test(text)) {
    return {
      reason: "not_configured",
      fix: "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN on the API service (run get-drive-refresh-token.mjs once to get the token).",
    }
  }
  if (/invalid_client|unauthorized_client/i.test(text)) {
    return {
      reason: "client_rejected",
      fix: "Google does not accept the client id / secret. They must be the pair from the same Google Cloud OAuth client that was used to authorise.",
    }
  }
  if (/invalid_grant/i.test(text)) {
    return {
      reason: "token_rejected",
      fix: "Google no longer accepts the saved authorisation (refresh token). It was revoked, the account's password/security changed, or — most often — the OAuth app is still in \"Testing\" mode, where refresh tokens expire after 7 days. Publish the OAuth consent screen (Google Cloud → APIs & Services → OAuth consent screen → Publish app), then run get-drive-refresh-token.mjs again and update GOOGLE_OAUTH_REFRESH_TOKEN.",
    }
  }
  if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) {
    return {
      reason: "scope_insufficient",
      fix: "The authorisation only has the narrow drive.file scope, which cannot see a folder it did not create. Re-run get-drive-refresh-token.mjs (it asks for the full drive scope by default) and update GOOGLE_OAUTH_REFRESH_TOKEN.",
    }
  }
  if (/storageQuotaExceeded|quota/i.test(text)) {
    return { reason: "quota", fix: "The Google account that authorised the token is out of Drive storage. Free space or use another account." }
  }
  if (status === 404 || /file not found|\bnotFound\b/.test(text)) {
    return {
      reason: "folder_not_found",
      fix: "Google cannot find that folder for this account. Check GOOGLE_DRIVE_EBM_FOLDER_ID (the part after /folders/ in the folder's URL; if the variable is unset the old built-in default is used), and that the authorising Google account can open the folder.",
    }
  }
  if (status === 403 || /forbidden|insufficientFilePermissions|permission/i.test(text)) {
    return {
      reason: "permission_denied",
      fix: "The authorising Google account can see the folder but is not allowed to add files to it. Share the folder with that account as an Editor.",
    }
  }
  return { reason: "unknown", fix: "Unrecognised Google error. See the API logs for \"[Drive API Error]\"." }
}

export interface DriveCheckStep {
  step: "credentials" | "token" | "folder"
  ok: boolean
  reason?: DriveReason
  fix?: string
  detail?: string
}

export interface DriveCheck {
  ok: boolean
  configured: { client_id: boolean; client_secret: boolean; refresh_token: boolean }
  /** Where the folder id came from; the built-in default is an old folder, usually wrong. */
  folder_id_source: "env" | "built-in default"
  /** Last 6 characters only, so it can be compared with the real id without exposing it. */
  folder_id_tail: string
  steps: DriveCheckStep[]
  folder?: { name: string; can_add_files: boolean | null }
}

/** The two Google calls a check needs, injectable so tests need no network. */
export interface DriveProbe {
  refresh(): Promise<void>
  folder(id: string): Promise<{ name: string; canAddChildren: boolean | null }>
}

function googleProbe(): DriveProbe {
  const auth = new google.auth.OAuth2(clean(process.env.GOOGLE_OAUTH_CLIENT_ID), clean(process.env.GOOGLE_OAUTH_CLIENT_SECRET))
  auth.setCredentials({ refresh_token: clean(process.env.GOOGLE_OAUTH_REFRESH_TOKEN) })
  const drive = google.drive({ version: "v3", auth })
  return {
    refresh: async () => {
      await auth.getAccessToken()
    },
    folder: async (id) => {
      const r = await drive.files.get({ fileId: id, fields: "id,name,capabilities(canAddChildren)", supportsAllDrives: true })
      return { name: r.data.name ?? "(unnamed)", canAddChildren: r.data.capabilities?.canAddChildren ?? null }
    },
  }
}

const DEFAULT_FOLDER = "1YW2YHTOs1jOCqUL9jwrnj_SHzpSwSQyg"

/**
 * Test the receipt storage end to end WITHOUT uploading anything: are the three
 * credentials set, does Google accept the token, can the account see the folder and
 * add files to it. Stops at the first failing step and says how to fix it.
 */
export async function checkDriveSetup(probe?: DriveProbe, env: NodeJS.ProcessEnv = process.env): Promise<DriveCheck> {
  const configured = {
    client_id: !!clean(env.GOOGLE_OAUTH_CLIENT_ID),
    client_secret: !!clean(env.GOOGLE_OAUTH_CLIENT_SECRET),
    refresh_token: !!clean(env.GOOGLE_OAUTH_REFRESH_TOKEN),
  }
  const fromEnv = !!clean(env.GOOGLE_DRIVE_EBM_FOLDER_ID)
  const folderId = clean(env.GOOGLE_DRIVE_EBM_FOLDER_ID) || DEFAULT_FOLDER
  const result: DriveCheck = {
    ok: false,
    configured,
    folder_id_source: fromEnv ? "env" : "built-in default",
    folder_id_tail: folderId.slice(-6),
    steps: [],
  }

  if (!configured.client_id || !configured.client_secret || !configured.refresh_token) {
    const missing = Object.entries(configured).filter(([, v]) => !v).map(([k]) => k).join(", ")
    const c = classifyDriveError(new Error("Missing Google Drive OAuth credentials"))
    result.steps.push({ step: "credentials", ok: false, reason: c.reason, fix: c.fix, detail: `missing: ${missing}` })
    return result
  }
  result.steps.push({ step: "credentials", ok: true })

  const p = probe ?? googleProbe()
  try {
    await p.refresh()
    result.steps.push({ step: "token", ok: true })
  } catch (err: any) {
    const c = classifyDriveError(err)
    result.steps.push({ step: "token", ok: false, reason: c.reason, fix: c.fix })
    return result
  }

  try {
    const f = await p.folder(folderId)
    result.folder = { name: f.name, can_add_files: f.canAddChildren }
    if (f.canAddChildren === false) {
      const c = classifyDriveError({ response: { status: 403 }, message: "forbidden" })
      result.steps.push({ step: "folder", ok: false, reason: c.reason, fix: c.fix, detail: `can see "${f.name}" but cannot add files` })
      return result
    }
    result.steps.push({ step: "folder", ok: true, detail: `"${f.name}"` })
  } catch (err: any) {
    const c = classifyDriveError(err)
    result.steps.push({ step: "folder", ok: false, reason: c.reason, fix: c.fix })
    return result
  }

  if (!fromEnv) {
    // It worked, but with the old built-in folder — almost certainly not the one meant.
    result.steps.push({
      step: "folder",
      ok: false,
      reason: "folder_not_found",
      fix: "GOOGLE_DRIVE_EBM_FOLDER_ID is not set, so receipts go to an old built-in folder. Set it to the id of the \"EBM In Box\" folder.",
      detail: "using the built-in default folder id",
    })
    return result
  }
  result.ok = true
  return result
}
