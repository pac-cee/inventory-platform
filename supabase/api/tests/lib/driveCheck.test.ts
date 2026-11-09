import { describe, it, expect } from "vitest";
import { checkDriveSetup, classifyDriveError, type DriveProbe } from "../../src/lib/drive.js";

const ENV_OK = {
  GOOGLE_OAUTH_CLIENT_ID: "id",
  GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  GOOGLE_OAUTH_REFRESH_TOKEN: "token",
  GOOGLE_DRIVE_EBM_FOLDER_ID: "1AbCdEfGhIjKlMnOpQrStUvWxYz123456",
} as NodeJS.ProcessEnv;

const probe = (over: Partial<DriveProbe> = {}): DriveProbe => ({
  refresh: async () => {},
  folder: async () => ({ name: "EBM In Box", canAddChildren: true }),
  ...over,
});

describe("classifyDriveError — what went wrong and what to do", () => {
  it("missing settings", () => {
    expect(classifyDriveError(new Error("Missing Google Drive OAuth credentials in environment variables")).reason).toBe("not_configured");
  });
  it("invalid_grant: the saved authorisation is no longer accepted, and says why (7-day Testing expiry)", () => {
    const c = classifyDriveError({ message: "invalid_grant", response: { data: { error: "invalid_grant" } } });
    expect(c.reason).toBe("token_rejected");
    expect(c.fix).toMatch(/7 days/i);
    expect(c.fix).toMatch(/Publish/);
  });
  it("a wrong client id/secret is a different problem from a dead token", () => {
    expect(classifyDriveError({ message: "invalid_client" }).reason).toBe("client_rejected");
  });
  it("the narrow drive.file scope", () => {
    expect(classifyDriveError({ message: "Request had insufficient authentication scopes." }).reason).toBe("scope_insufficient");
  });
  it("folder not found (404) and permission denied (403)", () => {
    expect(classifyDriveError({ response: { status: 404 }, message: "File not found: abc" }).reason).toBe("folder_not_found");
    expect(classifyDriveError({ response: { status: 403 }, message: "forbidden" }).reason).toBe("permission_denied");
  });
  it("quota is not mistaken for plain permission", () => {
    expect(classifyDriveError({ response: { status: 403 }, message: "The user's Drive storage quota has been exceeded (storageQuotaExceeded)" }).reason).toBe("quota");
  });
  it("a DNS failure (ENOTFOUND) is a network problem, NOT a missing folder", () => {
    expect(classifyDriveError({ message: "getaddrinfo ENOTFOUND www.googleapis.com" }).reason).toBe("network");
  });
  it("network problems and the unrecognised", () => {
    expect(classifyDriveError({ message: "getaddrinfo ENOTFOUND www.googleapis.com" }).reason).toBe("network");
    expect(classifyDriveError(new Error("something odd")).reason).toBe("unknown");
  });
  it("no fix text ever contains a credential-looking value", () => {
    for (const e of [{ message: "invalid_grant" }, { message: "invalid_client" }, { response: { status: 404 } }]) {
      expect(classifyDriveError(e).fix).not.toMatch(/ya29\.|GOCSPX|1\/\/0/);
    }
  });
});

describe("checkDriveSetup", () => {
  it("all good: credentials, token and folder pass, with the folder's name", async () => {
    const c = await checkDriveSetup(probe(), ENV_OK);
    expect(c.ok).toBe(true);
    expect(c.steps.map((s) => [s.step, s.ok])).toEqual([["credentials", true], ["token", true], ["folder", true]]);
    expect(c.folder).toEqual({ name: "EBM In Box", can_add_files: true });
    expect(c.folder_id_source).toBe("env");
  });

  it("missing settings stops at step 1 and names which ones, without touching Google", async () => {
    let touched = false;
    const c = await checkDriveSetup(probe({ refresh: async () => { touched = true; } }), { ...ENV_OK, GOOGLE_OAUTH_REFRESH_TOKEN: "" } as NodeJS.ProcessEnv);
    expect(c.ok).toBe(false);
    expect(c.configured).toEqual({ client_id: true, client_secret: true, refresh_token: false });
    expect(c.steps).toHaveLength(1);
    expect(c.steps[0]).toMatchObject({ step: "credentials", ok: false, reason: "not_configured", detail: "missing: refresh_token" });
    expect(touched).toBe(false);
  });

  it("a rejected token stops at step 2 with the 7-day explanation", async () => {
    const c = await checkDriveSetup(probe({ refresh: async () => { throw { message: "invalid_grant" }; } }), ENV_OK);
    expect(c.ok).toBe(false);
    expect(c.steps.map((s) => s.step)).toEqual(["credentials", "token"]);
    expect(c.steps[1]).toMatchObject({ ok: false, reason: "token_rejected" });
  });

  it("a folder Google cannot find stops at step 3", async () => {
    const c = await checkDriveSetup(probe({ folder: async () => { throw { response: { status: 404 }, message: "File not found" }; } }), ENV_OK);
    expect(c.ok).toBe(false);
    expect(c.steps[2]).toMatchObject({ step: "folder", ok: false, reason: "folder_not_found" });
  });

  it("a folder that can be seen but not written to is reported as a permission problem", async () => {
    const c = await checkDriveSetup(probe({ folder: async () => ({ name: "EBM In Box", canAddChildren: false }) }), ENV_OK);
    expect(c.ok).toBe(false);
    expect(c.steps[2]).toMatchObject({ reason: "permission_denied" });
    expect(c.steps[2].detail).toMatch(/cannot add files/);
  });

  it("works with the built-in default folder, but flags it as almost certainly the wrong one", async () => {
    const c = await checkDriveSetup(probe(), { ...ENV_OK, GOOGLE_DRIVE_EBM_FOLDER_ID: "" } as NodeJS.ProcessEnv);
    expect(c.ok).toBe(false);
    expect(c.folder_id_source).toBe("built-in default");
    expect(c.steps.at(-1)).toMatchObject({ step: "folder", ok: false });
    expect(c.steps.at(-1)!.fix).toMatch(/GOOGLE_DRIVE_EBM_FOLDER_ID/);
  });

  it("values with a Windows line ending, quotes or spaces still count as set (the invalid_client trap)", async () => {
    const env = {
      GOOGLE_OAUTH_CLIENT_ID: '"abc"\r',
      GOOGLE_OAUTH_CLIENT_SECRET: " secret \r\n",
      GOOGLE_OAUTH_REFRESH_TOKEN: "token\r",
      GOOGLE_DRIVE_EBM_FOLDER_ID: "folder-id-123456\r",
    } as NodeJS.ProcessEnv;
    const c = await checkDriveSetup(probe(), env);
    expect(c.ok).toBe(true);
    expect(c.folder_id_tail).toBe("123456"); // measured on the cleaned value, not "56\r"
  });

  it("a value that is only whitespace counts as missing", async () => {
    const c = await checkDriveSetup(probe(), { ...ENV_OK, GOOGLE_OAUTH_CLIENT_ID: "  \r" } as NodeJS.ProcessEnv);
    expect(c.configured.client_id).toBe(false);
    expect(c.ok).toBe(false);
  });

  it("never returns the folder id or any credential value: only the last 6 characters of the id", async () => {
    const env = {
      GOOGLE_OAUTH_CLIENT_ID: "CLIENT-ID-SENTINEL",
      GOOGLE_OAUTH_CLIENT_SECRET: "CLIENT-SECRET-SENTINEL",
      GOOGLE_OAUTH_REFRESH_TOKEN: "REFRESH-TOKEN-SENTINEL",
      GOOGLE_DRIVE_EBM_FOLDER_ID: "FOLDER-ID-SENTINEL-123456",
    } as NodeJS.ProcessEnv;
    const c = await checkDriveSetup(probe(), env);
    const json = JSON.stringify(c);
    expect(c.folder_id_tail).toBe("123456");
    for (const secret of ["CLIENT-ID-SENTINEL", "CLIENT-SECRET-SENTINEL", "REFRESH-TOKEN-SENTINEL", "FOLDER-ID-SENTINEL"]) {
      expect(json).not.toContain(secret);
    }
  });
});
