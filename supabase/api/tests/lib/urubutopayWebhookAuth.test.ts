import { describe, it, expect, afterEach } from "vitest";
import * as jose from "jose";
import { env } from "../../src/env.js";
import {
  credentialsMatch,
  issueWebhookToken,
  verifyWebhookToken,
  webhookAuthRequired,
} from "../../src/lib/urubutopay/webhookAuth.js";

const saved = { ...env };
afterEach(() => Object.assign(env, saved));

describe("webhook credentials", () => {
  it("match only the exact configured user and password", () => {
    env.urubutopayWebhookUser = "verlet";
    env.urubutopayWebhookPassword = "s3cret-long-password";
    expect(credentialsMatch("verlet", "s3cret-long-password")).toBe(true);
    expect(credentialsMatch("verlet", "wrong")).toBe(false);
    expect(credentialsMatch("other", "s3cret-long-password")).toBe(false);
    expect(credentialsMatch(undefined, undefined)).toBe(false);
    expect(credentialsMatch(["verlet"], "s3cret-long-password")).toBe(false);
  });

  it("never match when nothing is configured (even for empty strings)", () => {
    env.urubutopayWebhookUser = "";
    env.urubutopayWebhookPassword = "";
    expect(credentialsMatch("", "")).toBe(false);
  });
});

describe("webhook token", () => {
  it("round-trips, with or without the Bearer prefix(es)", async () => {
    const token = await issueWebhookToken(); // already "Bearer <jwt>"
    expect(token.startsWith("Bearer ")).toBe(true);
    expect(await verifyWebhookToken(token)).toBe(true);
    expect(await verifyWebhookToken(`Bearer ${token}`)).toBe(true); // "Bearer Bearer x"
    expect(await verifyWebhookToken(token.replace("Bearer ", ""))).toBe(true);
  });

  it("rejects missing, garbage and tampered tokens", async () => {
    expect(await verifyWebhookToken(undefined)).toBe(false);
    expect(await verifyWebhookToken("Bearer")).toBe(false);
    expect(await verifyWebhookToken("Bearer not.a.jwt")).toBe(false);
    const token = await issueWebhookToken();
    expect(await verifyWebhookToken(token.slice(0, -3) + "abc")).toBe(false);
  });

  it("rejects an app login JWT signed with JWT_SECRET (different key and audience)", async () => {
    const userToken = await new jose.SignJWT({ sub: "someone" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(env.jwtSecret));
    expect(await verifyWebhookToken(`Bearer ${userToken}`)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const crypto = await import("crypto");
    const key = crypto.createHmac("sha256", env.jwtSecret).update("urubutopay-webhook-v1").digest();
    const expired = await new jose.SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("urubutopay-webhook")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key);
    expect(await verifyWebhookToken(`Bearer ${expired}`)).toBe(false);
  });
});

describe("webhookAuthRequired (fail closed)", () => {
  it("is off only for a pure mock setup", () => {
    Object.assign(env, { urubutopayApiKey: "", urubutopayWebhookUser: "", urubutopayWebhookPassword: "", urubutopayMode: "" });
    expect(webhookAuthRequired()).toBe(false);
  });
  it("is on once a real API key is configured, even with no credentials", () => {
    Object.assign(env, { urubutopayApiKey: "upg:test_x", urubutopayWebhookUser: "", urubutopayWebhookPassword: "", urubutopayMode: "" });
    expect(webhookAuthRequired()).toBe(true);
  });
  it("is on whenever credentials are configured", () => {
    Object.assign(env, { urubutopayApiKey: "", urubutopayWebhookUser: "u", urubutopayWebhookPassword: "p", urubutopayMode: "demo" });
    expect(webhookAuthRequired()).toBe(true);
  });
});
