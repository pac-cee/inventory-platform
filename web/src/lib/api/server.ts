import "server-only";
import { getAccessToken } from "@/lib/session";
import { MOCK, MockError, mockRequest } from "@/lib/api/mock";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: any;
  constructor(status: number, message: string, code?: string, details?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Json = Record<string, unknown> | unknown[];

interface RequestOptions {
  method?: string;
  body?: Json;
  token?: string | null;
  /** Data-cache TTL in seconds for read fetches. Omit => no-store (uncached). */
  revalidate?: number;
}

/** Low-level call to the inventory-api. Throws ApiError on non-2xx. */
export async function apiRequest<T = unknown>(
  path: string,
  { method = "GET", body, token, revalidate }: RequestOptions = {},
): Promise<T> {
  if (MOCK) {
    try {
      return await mockRequest<T>(method, path, body);
    } catch (err) {
      if (err instanceof MockError) throw new ApiError(err.status, err.message);
      throw err;
    }
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const fetchOpts: RequestInit & { next?: { revalidate: number } } = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // P4: reads can opt into the Next data cache; auth/mutations stay no-store.
    ...(revalidate !== undefined ? { next: { revalidate } } : { cache: "no-store" }),
  };

  const res = await fetch(`${API_URL}${path}`, fetchOpts);

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: any } } | null)?.error;
    throw new ApiError(res.status, err?.message ?? `Request failed (${res.status})`, err?.code, err?.details);
  }
  return data as T;
}

/**
 * An API client bound to the current request's session cookie. Use from server
 * components, server actions, and route handlers. Token refresh is handled in
 * proxy.ts before the request reaches these.
 */
export interface GetOptions {
  /** Data-cache TTL in seconds. Omit => no-store (uncached per request). */
  revalidate?: number;
}

export function serverApi() {
  const withToken = async <T>(path: string, opts: RequestOptions = {}) =>
    apiRequest<T>(path, { ...opts, token: await getAccessToken() });

  return {
    get: <T>(path: string, opts?: GetOptions) => withToken<T>(path, opts ?? {}),
    post: <T>(path: string, body?: Json) => withToken<T>(path, { method: "POST", body }),
    patch: <T>(path: string, body?: Json) => withToken<T>(path, { method: "PATCH", body }),
    put: <T>(path: string, body?: Json) => withToken<T>(path, { method: "PUT", body }),
    del: <T>(path: string) => withToken<T>(path, { method: "DELETE" }),
  };
}
