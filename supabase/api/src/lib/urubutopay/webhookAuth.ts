// Authentication for UrubutoPay's callbacks to us (spec: "Authentication
// Webhook"). Two halves:
//   1. UrubutoPay POSTs {user_name, password} to our auth endpoint and gets a
//      Bearer JWT back (must live >= 2h; we issue 24h).
//   2. Every callback then carries `Authorization: Bearer <token>`, which
//      requireWebhookAuth verifies.
// The signing key is derived from JWT_SECRET but distinct from it, and tokens
// carry their own audience, so a user's login JWT is never accepted here (and
// vice versa).
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import * as jose from "jose";
import { env } from "../../env.js";

const AUDIENCE = "urubutopay-webhook";
const TOKEN_TTL = "24h";

function signingKey(): Uint8Array {
  return crypto.createHmac("sha256", env.jwtSecret).update("urubutopay-webhook-v1").digest();
}

function sha256(s: string): Buffer {
  return crypto.createHash("sha256").update(s).digest();
}

// Constant-time on both fields (hashing first makes lengths equal).
export function credentialsMatch(user: unknown, password: unknown): boolean {
  if (!env.urubutopayWebhookUser || !env.urubutopayWebhookPassword) return false;
  if (typeof user !== "string" || typeof password !== "string") return false;
  const userOk = crypto.timingSafeEqual(sha256(user), sha256(env.urubutopayWebhookUser));
  const passOk = crypto.timingSafeEqual(sha256(password), sha256(env.urubutopayWebhookPassword));
  return userOk && passOk;
}

export async function issueWebhookToken(): Promise<string> {
  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(signingKey());
  // The spec's example response carries the "Bearer " prefix inside `token`.
  return `Bearer ${jwt}`;
}

export async function verifyWebhookToken(header: string | undefined): Promise<boolean> {
  if (!header) return false;
  // Tolerate "Bearer Bearer x": the spec's example token already has the prefix.
  const token = header.replace(/^(Bearer\s+)+/i, "").trim();
  if (!token) return false;
  try {
    await jose.jwtVerify(token, signingKey(), { audience: AUDIENCE, algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

// Fail closed: auth is mandatory whenever credentials are configured OR the
// app talks to the real UrubutoPay API. Only a pure mock/dev setup (no key, no
// credentials) leaves the endpoint open, so local development and the test
// suite keep working.
export function webhookAuthRequired(): boolean {
  if (env.urubutopayWebhookUser || env.urubutopayWebhookPassword) return true;
  return Boolean(env.urubutopayApiKey) && env.urubutopayMode !== "demo";
}

export async function requireWebhookAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!webhookAuthRequired()) {
    console.warn("[UrubutoPay Webhook] auth NOT enforced (mock/dev setup: no API key or webhook credentials configured)");
    return next();
  }
  if (!env.urubutopayWebhookUser || !env.urubutopayWebhookPassword) {
    console.error("[UrubutoPay Webhook] rejecting callback: real UrubutoPay mode but URUBUTOPAY_WEBHOOK_USER/PASSWORD are not set");
    res.status(401).json({ timestamp: now(), status: 401, message: "unauthorized" });
    return;
  }
  if (!(await verifyWebhookToken(req.headers.authorization))) {
    console.warn(`[UrubutoPay Webhook] rejecting callback from ${req.ip}: missing or invalid Bearer token`);
    res.status(401).json({ timestamp: now(), status: 401, message: "unauthorized" });
    return;
  }
  next();
}

export function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
