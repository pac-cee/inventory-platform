import "server-only";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import fixtures from "./fixtures.json";

/**
 * Mock mode: the whole UI runs with no API, no database and no .env.
 *
 * On when API_URL is unset, or forced with MOCK_API=1. Reads replay responses
 * recorded from a real inventory-api run with demo data (fixtures.json, keyed
 * by request path). Items, locations and people live in memory, so
 * creating, editing and deleting them shows up straight away; stock actions
 * (take, return, transfer, ...) succeed but leave the counts as recorded.
 * Everything resets when the server restarts.
 */
export const MOCK = process.env.MOCK_API === "1" || (!process.env.API_URL && process.env.MOCK_API !== "0");

// Recorded JSON of every response shape the API has; typed at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Data = any;

// Recorded dates are moved forward by the time since recording, so due dates,
// "taken 2 days ago" and this month's budget stay where they were relative to now.
const shift = Date.now() - Date.parse(fixtures.capturedAt);
const ISO = /"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)"/g;
const recorded: Record<string, Data> = JSON.parse(
  JSON.stringify(fixtures.responses).replace(ISO, (_, d) => `"${new Date(Date.parse(d) + shift).toISOString()}"`),
);

const ME = recorded["/auth/me"];
const store = {
  items: [...(recorded["/items?limit=200&offset=0"] ?? [])] as Data[],
  locations: [...(recorded["/locations"] ?? [])] as Data[],
  profiles: [...(recorded["/profiles"] ?? [])] as Data[],
  // The floor's five zones, to start from; people rename, add and remove them.
  departments: [
    ["Stockroom", "#c9a15a"],
    ["Robotics", "#5b8fd6"],
    ["Hardware", "#d9774f"],
    ["Software", "#5fae8b"],
    ["Field", "#a07fd0"],
  ].map(([name, color], i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, name, color, created_at: fixtures.capturedAt })) as Data[],
  desks: [] as Data[],
};

// The floor plan is the one thing kept on disk, so a room someone has laid out
// by hand survives a restart. Tests and read-only hosts keep it in memory.
const PLAN_FILE = process.env.VITEST ? null : (process.env.FLOOR_PLAN_FILE ?? join(process.cwd(), "data", "floor-plan.json"));
let floorPlan: Data = null;
let planRead = false;
function readPlan(): Data {
  if (!planRead) {
    planRead = true;
    try {
      if (PLAN_FILE && existsSync(PLAN_FILE)) floorPlan = JSON.parse(readFileSync(PLAN_FILE, "utf8"));
    } catch {
      floorPlan = null;
    }
  }
  return floorPlan;
}
function writePlan(plan: Data) {
  floorPlan = plan;
  planRead = true;
  try {
    if (!PLAN_FILE) return;
    mkdirSync(dirname(PLAN_FILE), { recursive: true });
    writeFileSync(PLAN_FILE, `${JSON.stringify(plan, null, 2)}\n`);
  } catch {
    /* read-only host: the plan lasts until the server restarts */
  }
}

export class MockError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const template = (path: string) => path.split("?")[0].replace(UUID, ":id");

/** A recorded answer for a path we never recorded exactly: same route, any id. */
function closest(path: string): Data {
  const base = path.split("?")[0];
  const exact = Object.keys(recorded).find((k) => k.split("?")[0] === base);
  if (exact) return recorded[exact];
  const t = template(path);
  const same = Object.keys(recorded).find((k) => template(k) === t);
  if (same === undefined) return [];
  return Array.isArray(recorded[same]) ? [] : recorded[same];
}

function session() {
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const payload = Buffer.from(JSON.stringify({ sub: ME.user.id, email: ME.user.email, exp })).toString("base64url");
  return {
    access_token: `mock.${payload}.mock`,
    refresh_token: "mock-refresh",
    token_type: "bearer",
    expires_in: exp - Math.floor(Date.now() / 1000),
    expires_at: exp,
    user: ME.user,
  };
}

function read(path: string): Data {
  const [base, query = ""] = path.split("?");
  const q = new URLSearchParams(query);

  if (base === "/items") {
    const term = q.get("search")?.toLowerCase();
    if (!term) return store.items;
    return store.items.filter((i) =>
      [i.name, i.type, i.model, i.sku, i.category].some((v) => String(v ?? "").toLowerCase().includes(term)),
    );
  }
  if (base === "/locations") return store.locations;
  if (base === "/profiles") return store.profiles;
  if (base === "/departments") return store.departments;
  if (base === "/desks") return store.desks;
  if (base === "/floor-plan") return readPlan();

  const item = base.match(/^\/items\/([^/]+)$/);
  if (item && item[1] !== "categories" && item[1] !== "where") {
    const found = store.items.find((i) => i.id === item[1]);
    if (!found) throw new MockError(404, "Item not found.");
    return found;
  }
  const location = base.match(/^\/locations\/([0-9a-f-]{36})$/);
  if (location) {
    const found = store.locations.find((l) => l.id === location[1]);
    if (!found) throw new MockError(404, "Location not found.");
    return found;
  }

  if (path in recorded) return recorded[path];
  if (base.startsWith("/locations/by-token/")) throw new MockError(404, "No box has that code.");
  return closest(path);
}

function write(method: string, path: string, body: Data): Data {
  const base = path.split("?")[0];
  const now = new Date().toISOString();

  if (method === "POST" && base === "/items") {
    const item = { id: randomUUID(), sku: `vrlt-new-${store.items.length + 1}`, units_per_container: 1, package_label: null, category: null, photo_url: null, finishable: false, has_photo: false, created_at: now, ...body };
    delete item.photo_data;
    store.items.unshift(item);
    return item;
  }
  if (method === "POST" && base === "/locations") {
    const location = { id: randomUUID(), parent_id: null, archived_at: null, photo_url: null, kind: "area", label: null, qr_token: null, has_photo: false, created_at: now, ...body };
    delete location.photo_data;
    store.locations.push(location);
    return location;
  }
  if (method === "POST" && base === "/users") {
    const profile = { id: randomUUID(), full_name: body.full_name ?? body.email, role: body.role ?? "member", email: body.email, created_at: now, blocked: false, approval_status: "approved", has_payment_permission: false, can_manage_inventory: false, fallback_role: "none", daily_limit: 0, monthly_limit: 0, per_transaction_limit: 0, email_confirmed: !body.password ? false : true };
    store.profiles.push(profile);
    return { user: { id: profile.id, email: profile.email }, invited: !body.password };
  }

  if (method === "POST" && base === "/departments") {
    const name = String(body.name ?? "").trim();
    if (!name) throw new MockError(400, "A department needs a name.");
    if (store.departments.some((d) => d.name.toLowerCase() === name.toLowerCase()))
      throw new MockError(409, `There is already a department called ${name}.`);
    const department = { id: randomUUID(), name, color: body.color ?? "#8a9a92", created_at: now };
    store.departments.push(department);
    return department;
  }
  const department = base.match(/^\/departments\/([0-9a-f-]{36})$/);
  if (department) {
    const index = store.departments.findIndex((d) => d.id === department[1]);
    if (index === -1) throw new MockError(404, "Department not found.");
    if (method === "DELETE") {
      store.departments.splice(index, 1);
      let cleared = 0;
      store.items = store.items.map((i) => (i.department_id === department[1] ? (cleared++, { ...i, department_id: null }) : i));
      return { cleared };
    }
    const name = body.name === undefined ? undefined : String(body.name).trim();
    if (name === "") throw new MockError(400, "A department needs a name.");
    if (name && store.departments.some((d, i) => i !== index && d.name.toLowerCase() === name.toLowerCase()))
      throw new MockError(409, `There is already a department called ${name}.`);
    store.departments[index] = { ...store.departments[index], ...(name ? { name } : {}), ...(body.color ? { color: body.color } : {}) };
    return store.departments[index];
  }
  const desk = base.match(/^\/desks\/([\w-]{1,64})$/);
  if (desk && method === "PUT") {
    const saved = { id: desk[1], user_id: body.user_id ?? null };
    store.desks = [...store.desks.filter((d) => d.id !== desk[1]), saved];
    return saved;
  }
  if (base === "/floor-plan" && method === "PUT") {
    if (!body || !Array.isArray(body.pieces)) throw new MockError(400, "That is not a floor plan.");
    writePlan(body);
    return body;
  }
  if (base === "/floor-plan" && method === "DELETE") {
    writePlan(null);
    return null;
  }

  const one = base.match(/^\/(items|locations|users|profiles)\/([0-9a-f-]{36})(?:\/(role|block|payment-settings))?$/)
    ?? base.match(/^\/payments\/(profiles)\/([0-9a-f-]{36})\/(payment-settings)$/);
  if (one) {
    const [, kind, id] = one;
    const list = kind === "items" ? store.items : kind === "locations" ? store.locations : store.profiles;
    const index = list.findIndex((x) => x.id === id);
    if (index === -1) throw new MockError(404, "Not found.");
    if (method === "DELETE") {
      list.splice(index, 1);
      return kind === "locations" ? { archived: false } : undefined;
    }
    const patch = { ...body };
    delete patch.photo_data;
    list[index] = { ...list[index], ...patch };
    return list[index];
  }

  if (base === "/items/categories" || base.startsWith("/categories")) return { category: body?.name ?? "", cleared: 0 };
  if (base === "/payments/request") return { transactionId: randomUUID(), status: "pending" };
  if (base === "/payments/budgets") return { ...recorded["/payments/budgets"], ...body, remaining_amount: body?.allocated_amount };
  if (base === "/movements/transfer") return { moved: 1, failed: [] };
  return { ok: true, id: randomUUID(), message: "Done." };
}

/** Stand-in for one inventory-api call. Same contract as apiRequest. */
export async function mockRequest<T>(method: string, path: string, body?: Data): Promise<T> {
  if (path.startsWith("/auth/")) {
    if (path === "/auth/me") return ME as T;
    if (path === "/auth/login" || path === "/auth/refresh") return { user: ME.user, session: session() } as T;
    if (path === "/auth/signup") return { user: null, session: null } as T;
    return { ok: true } as T;
  }
  const result = method === "GET" ? read(path) : write(method, path, body ?? {});
  return structuredClone(result) as T;
}

/** The recorded payment ledger as CSV, for the export download. */
export function mockLedgerCsv(): string {
  const rows: Data[] = recorded["/payments/transactions?limit=100"] ?? [];
  const lines = rows.map((t) =>
    [t.created_at, t.profiles?.full_name ?? "", t.recipient_phone ?? "", t.amount, t.status].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
  );
  return ["date,requested_by,recipient,amount,status", ...lines].join("\n");
}
