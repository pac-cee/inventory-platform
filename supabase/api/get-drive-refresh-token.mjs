// One-time setup: obtain an OAuth refresh token for Google Drive access under
// a personal Google account — used because service accounts have no Drive
// storage quota of their own and Shared Drives require Google Workspace.
//
// Run this LOCALLY (it opens a browser-based consent flow on your machine):
//
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node get-drive-refresh-token.mjs
//
// It prints a URL — open it, sign in with the Google account that owns the
// Drive folder receipts should upload into, and grant access. The script
// then WRITES the three GOOGLE_OAUTH_* values directly into .env (creating
// it from .env.example if it doesn't exist yet) — no manual copy-paste,
// which is easy to get wrong since these values are long enough that
// terminals line-wrap them.
import { google } from "googleapis";
import http from "node:http";
import fs from "node:fs";
import { clean, fingerprint, readEnvValue, renderOutFile } from "./drive-token-lib.mjs";

// Trim stray whitespace, quotes and the hidden carriage return a Windows-edited .env
// leaves at the end of every line: with one on the client id Google answers
// "Error 401: invalid_client - The OAuth client was not found".
const clientId = clean(process.env.GOOGLE_OAUTH_CLIENT_ID);
const clientSecret = clean(process.env.GOOGLE_OAUTH_CLIENT_SECRET);
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first (from a 'Desktop app' OAuth client).");
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}`;
const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

// SCOPE: "drive.file" only lets the app see files/folders it created itself, so
// a folder that already exists (or was SHARED with the account — e.g. the EBM
// folder) looks like "File not found" and uploads into it fail with a 404. Use
// the full "drive" scope (the default here) to upload into an existing/shared
// folder. Set GOOGLE_DRIVE_SCOPE=drive.file to go back to the narrow scope (then
// the app has to create its own folder). Whichever account you sign in with
// must have EDIT access to GOOGLE_DRIVE_EBM_FOLDER_ID.
const scope =
  process.env.GOOGLE_DRIVE_SCOPE === "drive.file"
    ? "https://www.googleapis.com/auth/drive.file"
    : "https://www.googleapis.com/auth/drive";

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces a refresh_token even if you've authorized this app before
  scope: [scope],
});

console.log("\nOpen this URL in your browser and sign in with the Google account");
console.log("that owns the Drive folder receipts should upload into:\n");
console.log(authUrl);
console.log("\nWaiting for you to finish the consent screen...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get("code");
  if (!code) {
    res.end("No code received — check the terminal and try again.");
    return;
  }
  res.end("Done — you can close this tab and go back to the terminal.");
  server.close();

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    if (!tokens.refresh_token) {
      console.error("\nNo refresh_token came back. This usually means you've authorized this");
      console.error("app before without revoking it. Go to https://myaccount.google.com/permissions,");
      console.error("remove access for this app, then run this script again.\n");
      process.exitCode = 1;
      return;
    }
    const envPath = new URL("./.env", import.meta.url);
    const before = readEnvValue(readIfExists(envPath), "GOOGLE_OAUTH_REFRESH_TOKEN");
    const folderId = clean(process.env.GOOGLE_DRIVE_EBM_FOLDER_ID) || readEnvValue(readIfExists(envPath), "GOOGLE_DRIVE_EBM_FOLDER_ID");

    writeToEnvFile(clientId, clientSecret, tokens.refresh_token);
    const outPath = writeOutFile({ clientId, clientSecret, refreshToken: tokens.refresh_token, folderId });

    console.log("REFRESH TOKEN, to confirm it really changed (the value itself is never printed):");
    console.log(`  before: ${fingerprint(before)}`);
    console.log(`  now:    ${fingerprint(tokens.refresh_token)}`);
    console.log(`  ${clean(before) === clean(tokens.refresh_token) ? "!! SAME as before" : "OK - different from before"}\n`);

    await verifyWithGoogle(tokens.refresh_token, folderId);

    console.log("\nTO FINISH:");
    console.log(`  1. Open ${outPath}`);
    console.log("     It holds the values in plain text, ready to copy into the Railway variables of the api service.");
    console.log("  2. After copying, DELETE that file.");
    console.log("  3. Railway restarts by itself; then open /api/diagnostics/drive on your web app: all three steps should say ok.\n");
  } catch (err) {
    console.error("Failed to exchange code for tokens:", err.message);
    process.exitCode = 1;
  }
});

function writeToEnvFile(clientId, clientSecret, refreshToken) {
  const envPath = new URL("./.env", import.meta.url);
  let contents = "";
  try {
    contents = fs.readFileSync(envPath, "utf8");
  } catch {
    // No .env yet — start from .env.example so other required keys aren't lost.
    try {
      contents = fs.readFileSync(new URL("./.env.example", import.meta.url), "utf8");
    } catch {
      contents = "";
    }
  }

  const setLine = (text, key, value) => {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  };

  contents = setLine(contents, "GOOGLE_OAUTH_CLIENT_ID", clientId);
  contents = setLine(contents, "GOOGLE_OAUTH_CLIENT_SECRET", clientSecret);
  contents = setLine(contents, "GOOGLE_OAUTH_REFRESH_TOKEN", refreshToken);

  fs.writeFileSync(envPath, contents);
  console.log(`\nSuccess! Wrote GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN directly into ${envPath.pathname}\n`);
  console.log("Double check GOOGLE_DRIVE_EBM_FOLDER_ID is also set there, then you're done.\n");
}

function readIfExists(url) {
  try {
    return fs.readFileSync(url, "utf8");
  } catch {
    return "";
  }
}

/** A clean, LF-only copy of the values to copy from. Git-ignored; delete after use. */
function writeOutFile(values) {
  const outUrl = new URL("./drive-oauth.out.txt", import.meta.url);
  fs.writeFileSync(outUrl, renderOutFile(values), { mode: 0o600 });
  console.log(`Also wrote a clean copy for copy-pasting: ${outUrl.pathname}`);
  return outUrl.pathname;
}

/** The real confirmation: does Google accept the NEW token, and can it reach the folder? */
async function verifyWithGoogle(refreshToken, folderId) {
  console.log("CHECKING WITH GOOGLE (using the new token):");
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  try {
    await auth.getAccessToken();
    console.log("  [ok] Google accepts the new token");
  } catch (err) {
    console.log(`  [FAILED] Google rejected the new token: ${err.message}`);
    return;
  }
  if (!folderId) {
    console.log("  [skipped] no GOOGLE_DRIVE_EBM_FOLDER_ID known here, so the folder was not checked");
    return;
  }
  try {
    const drive = google.drive({ version: "v3", auth });
    const r = await drive.files.get({ fileId: folderId, fields: "id,name,capabilities(canAddChildren)", supportsAllDrives: true });
    const canAdd = r.data.capabilities?.canAddChildren;
    console.log(`  [ok] can see the folder "${r.data.name}"`);
    console.log(canAdd === false ? "  [FAILED] ...but this account may NOT add files to it (needs Editor access)" : "  [ok] and can add files to it");
  } catch (err) {
    console.log(`  [FAILED] cannot open the folder (${err.message}). Check GOOGLE_DRIVE_EBM_FOLDER_ID and that this Google account can edit the folder.`);
  }
}

server.listen(PORT);
