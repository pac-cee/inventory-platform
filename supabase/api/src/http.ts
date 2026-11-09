import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError } from "zod";
import {env} from "./env.js";

/** An error with an attached HTTP status code. */
export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** Wraps an async route handler so thrown/rejected errors reach the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    const startTime = Date.now();

    handler(req, res, next).catch(next).finally(() => {
      // Naive dev/prod discriminator: check if momo is api is a sandbox
      if (env.momoTargetEnv === "sandbox") {
        const endTime = Date.now();
        console.log(`[${new Date().toISOString()}] ${req.method.toUpperCase()} ${req.originalUrl} -------------------- (${res.statusCode}) -- ${(endTime - startTime).toFixed(4)}ms`)
      }
    });
  };
}

/** A duck-typed Postgres (node-pg) error: an Error carrying a 5-char SQLSTATE. */
type PgError = Error & { code?: string; constraint?: string; table?: string };

function isPgError(err: unknown): err is PgError {
  return (
    err instanceof Error &&
    typeof (err as PgError).code === "string" &&
    /^[0-9A-Z]{5}$/.test((err as PgError).code as string)
  );
}

/**
 * Translate a Postgres error into an HttpError with a sensible status, so
 * clients get 409/422 instead of a blanket 500. 23514 (check_violation) is how
 * the stock-movement trigger signals "not enough stock" etc. → 422, and those
 * messages are written for humans by the trigger, so they pass through.
 *
 * Constraint violations do NOT pass through: Postgres phrases them as
 * `duplicate key value violates unique constraint "locations_name_active_key"`,
 * which reached users verbatim. Routes are expected to pre-check and raise
 * their own message; this is the backstop for the ones that slip past, and it
 * says something a person can act on while keeping the real text in the logs.
 */
export function fromPgError(error: PgError): HttpError {
  switch (error.code) {
    case "23505": // unique_violation
      console.error("Unique violation:", error.message);
      return new HttpError(409, "That already exists. Use a different value.", error.code);
    case "23503": // foreign_key_violation
      console.error("Foreign-key violation:", error.constraint ?? "(no constraint name)", "on", error.table ?? "(unknown table)", "—", error.message);
      return new HttpError(
        409,
        "Something else still refers to this, so it can't be changed or removed.",
        error.code,
      );
    case "23514": // check_violation (e.g. quantity went negative)
      return new HttpError(422, error.message, error.code);
    default:
      console.error("Database error:", error.code, error.message);
      return new HttpError(400, "The database rejected that request.", error.code ?? undefined);
  }
}

/** Express error-handling middleware. Must keep all four arguments. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(422).json({
      error: { message: "Invalid request body.", code: "validation_error", details: err.flatten() },
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }

  // Postgres (node-pg) error carrying a SQLSTATE code.
  if (isPgError(err)) {
    const httpErr = fromPgError(err);
    res.status(httpErr.status).json({ error: { message: httpErr.message, code: httpErr.code } });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ error: { message: "Internal server error.", code: "internal_error" } });
}
