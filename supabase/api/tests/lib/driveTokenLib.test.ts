import { describe, it, expect } from "vitest";
// @ts-expect-error plain .mjs helper next to the script, no type declarations
import { clean, fingerprint, readEnvValue, renderOutFile } from "../../drive-token-lib.mjs";

describe("get-drive-refresh-token helpers", () => {
  it("clean strips quotes, spaces and the hidden carriage return", () => {
    expect(clean('"abc"\r')).toBe("abc");
    expect(clean("  abc \r\n")).toBe("abc");
    expect(clean(undefined)).toBe("");
  });

  it("fingerprint recognises a secret without revealing it", () => {
    const token = "1//0gSUPERSECRETREFRESHTOKENVALUE-abcdef";
    const fp = fingerprint(token);
    expect(fp).toContain("abcdef"); // last 6
    expect(fp).toContain(`${token.length} characters`);
    expect(fp).not.toContain("SUPERSECRET");
    expect(fingerprint("")).toBe("(not set)");
  });

  it("two different tokens never print the same fingerprint, even with the same ending and length", () => {
    expect(fingerprint("aaaa-123456")).not.toBe(fingerprint("bbbb-123456"));
  });

  it("the same token with a Windows line ending has the same fingerprint (so before/after compares fairly)", () => {
    expect(fingerprint("tok-123456\r")).toBe(fingerprint("tok-123456"));
  });

  it("readEnvValue reads a key from a CRLF .env and gives '' when absent", () => {
    const env = 'A=1\r\nGOOGLE_OAUTH_REFRESH_TOKEN="tok123"\r\nB=2\r\n';
    expect(readEnvValue(env, "GOOGLE_OAUTH_REFRESH_TOKEN")).toBe("tok123");
    expect(readEnvValue(env, "NOPE")).toBe("");
    expect(readEnvValue("", "A")).toBe("");
  });

  it("the copy file is LF-only plain text with no quotes, and says to delete it", () => {
    const out = renderOutFile({ clientId: "id\r", clientSecret: '"sec"', refreshToken: " tok ", folderId: "folder\r", when: new Date("2026-11-02T10:00:00Z") });
    expect(out).not.toContain("\r");
    expect(out).not.toContain('"');
    expect(out).toContain("GOOGLE_OAUTH_CLIENT_ID=id\n");
    expect(out).toContain("GOOGLE_OAUTH_CLIENT_SECRET=sec\n");
    expect(out).toContain("GOOGLE_OAUTH_REFRESH_TOKEN=tok\n");
    expect(out).toContain("GOOGLE_DRIVE_EBM_FOLDER_ID=folder\n");
    expect(out).toMatch(/DELETE THIS FILE/);
    expect(out).toContain("2026-11-02T10:00:00.000Z");
  });

  it("leaves the folder line out when the folder is not known", () => {
    expect(renderOutFile({ clientId: "a", clientSecret: "b", refreshToken: "c", folderId: "" })).not.toContain("GOOGLE_DRIVE_EBM_FOLDER_ID");
  });
});
