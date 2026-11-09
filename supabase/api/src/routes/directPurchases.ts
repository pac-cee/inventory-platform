import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../http.js";
import { canManageInventory, requireAuth } from "../middleware/auth.js";
import { rows, maybeOne, one, tx } from "../db.js";
import { withAllocatedSku } from "../lib/skuAllocator.js";
import {
  PAYMENT_METHODS,
  checkPurchaseDate,
  csvRow,
  money,
  similarVendors,
  vendorKey,
} from "../lib/directPurchase.js";

/**
 * Direct purchases: spending made outside the payment flow (petty cash and the
 * like). A finished record, not a request: no budget check, no disbursement, and
 * nothing here may touch corporate_transactions. See migrations/0046.
 *
 * Who: inventory managers (they are the people who buy things), admins, and
 * cashiers (finance reads and exports them).
 */
export const directPurchasesRouter = Router();
directPurchasesRouter.use(requireAuth);
directPurchasesRouter.use((req, _res, next) => {
  const p = req.profile;
  if (canManageInventory(p) || p?.fallback_role === "cashier") return next();
  next(new HttpError(403, "Recording direct purchases needs inventory-manager or cashier access.", "not_purchase_recorder"));
});

// ── vendors ────────────────────────────────────────────────────────────────

type VendorRow = { id: string; name: string; name_key: string; purchases: number };

const loadVendors = () =>
  rows<VendorRow>(
    `select v.id, v.name, v.name_key,
            (select count(*)::int from direct_purchases p where p.vendor_id = v.id and p.voided_at is null) as purchases
       from vendors v order by lower(v.name)`,
  );

/** Every vendor (a few dozen at most): the form filters them as you type. */
directPurchasesRouter.get(
  "/vendors",
  asyncHandler(async (_req, res) => {
    res.json(await loadVendors());
  }),
);

/**
 * Before creating a vendor: is it already there (spelled the same once case,
 * spaces and "Ltd" are ignored), and does it look like one that is?
 */
directPurchasesRouter.get(
  "/vendors/suggest",
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.query);
    const all = await loadVendors();
    const key = vendorKey(name);
    res.json({
      exact: all.find((v) => v.name_key === key) ?? null,
      similar: similarVendors(name, all).slice(0, 5),
    });
  }),
);

const vendorBody = z.object({ name: z.string().trim().min(1).max(120) });

/** Create a vendor — or return the existing one when the name folds to the same key. */
directPurchasesRouter.post(
  "/vendors",
  asyncHandler(async (req, res) => {
    const { name } = vendorBody.parse(req.body);
    const key = vendorKey(name);
    if (!key) throw new HttpError(422, "That is not a usable vendor name.", "invalid_vendor");
    const existing = await maybeOne<VendorRow>("select id, name, name_key, 0 as purchases from vendors where name_key = $1", [key]);
    if (existing) return res.json({ ...existing, created: false });
    const all = await loadVendors();
    const created = await one<{ id: string }>(
      "insert into vendors (name, name_key) values ($1, $2) on conflict (name_key) do update set name = vendors.name returning id",
      [name, key],
    );
    res.status(201).json({ id: created.id, name, name_key: key, created: true, similar: similarVendors(name, all).slice(0, 5) });
  }),
);

// ── creating a purchase ─────────────────────────────────────────────────────

const lineBody = z
  .object({
    description: z.string().trim().min(1).max(200),
    quantity: z.number().int().positive().max(100_000),
    unit_cost: z.number().nonnegative().max(1_000_000_000),
    // true = becomes stock; false = a consumable, recorded but never stocked.
    stock_in: z.boolean().default(false),
    location_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional(),
    item_type: z.string().trim().min(1).max(100).optional(),
    item_name: z.string().trim().min(1).max(200).optional(),
    item_model: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((l, ctx) => {
    if (!l.stock_in) return;
    if (!l.location_id) ctx.addIssue({ code: "custom", path: ["location_id"], message: "Say where the stock goes." });
    if (!l.item_id && !l.item_type) {
      ctx.addIssue({ code: "custom", path: ["item_type"], message: "Pick the item, or give its type, so it can be stocked." });
    }
  });

const createBody = z.object({
  purchased_on: z.string(),
  vendor_id: z.string().uuid().optional(),
  vendor_name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(60),
  justification: z.string().trim().min(3, "Say why it was bought.").max(300),
  purchased_by_name: z.string().trim().min(1).max(100),
  purchased_by_id: z.string().uuid().optional(),
  paid_by_name: z.string().trim().min(1).max(100),
  payment_method: z.enum(PAYMENT_METHODS).default("petty_cash"),
  receipt_ref: z.string().trim().max(100).optional(),
  delivery_cost: z.number().nonnegative().max(1_000_000_000).default(0),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(lineBody).min(1).max(100),
});

/** The existing item for a stocked line, or a new one, found the way payments do it. */
async function resolveStockItem(l: z.infer<typeof lineBody>): Promise<string> {
  if (l.item_id) {
    const it = await maybeOne<{ id: string }>("select id from items where id = $1", [l.item_id]);
    if (!it) throw new HttpError(404, "That item does not exist.", "item_not_found");
    return it.id;
  }
  const type = l.item_type!;
  const name = l.item_name ?? type;
  const model = l.item_model ?? "Unspecified";
  const existing = await maybeOne<{ id: string }>(
    "select id from items where lower(type) = lower($1) and lower(name) = lower($2) and lower(model) = lower($3)",
    [type, name, model],
  );
  if (existing) return existing.id;
  const made = await withAllocatedSku(type, (sku) =>
    one<{ id: string }>("insert into items (sku, type, name, model) values ($1, $2, $3, $4) returning id", [sku, type, name, model]),
  );
  return made.id;
}

directPurchasesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const b = createBody.parse(req.body);
    const dateProblem = checkPurchaseDate(b.purchased_on);
    if (dateProblem) throw new HttpError(422, dateProblem, "invalid_date");
    if (!b.vendor_id && !b.vendor_name) throw new HttpError(422, "Say who it was bought from.", "vendor_required");

    // Items first, outside the transaction: finding-or-creating a catalog item is
    // idempotent, and a purchase that then fails leaves only a harmless catalog row.
    const itemIds: (string | null)[] = [];
    for (const l of b.lines) {
      if (!l.stock_in) {
        itemIds.push(null);
        continue;
      }
      const loc = await maybeOne("select id from locations where id = $1", [l.location_id]);
      if (!loc) throw new HttpError(404, "That storage location does not exist.", "location_not_found");
      itemIds.push(await resolveStockItem(l));
    }

    const id = await tx(async (c) => {
      let vendorId = b.vendor_id ?? null;
      if (vendorId) {
        const v = await c.query("select 1 from vendors where id = $1", [vendorId]);
        if (!v.rowCount) throw new HttpError(404, "That vendor does not exist.", "vendor_not_found");
      } else {
        const key = vendorKey(b.vendor_name!);
        if (!key) throw new HttpError(422, "That is not a usable vendor name.", "invalid_vendor");
        const v = await c.query(
          "insert into vendors (name, name_key) values ($1, $2) on conflict (name_key) do update set name = vendors.name returning id",
          [b.vendor_name, key],
        );
        vendorId = v.rows[0].id as string;
      }

      const p = await c.query(
        `insert into direct_purchases
           (purchased_on, vendor_id, category, justification, purchased_by_name, purchased_by_id,
            paid_by_name, payment_method, receipt_ref, delivery_cost, notes, recorded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [
          b.purchased_on, vendorId, b.category, b.justification, b.purchased_by_name, b.purchased_by_id ?? null,
          b.paid_by_name, b.payment_method, b.receipt_ref ?? null, money(b.delivery_cost), b.notes ?? null, req.user.id,
        ],
      );
      const purchaseId = p.rows[0].id as string;

      for (let i = 0; i < b.lines.length; i++) {
        const l = b.lines[i];
        await c.query(
          `insert into direct_purchase_lines (purchase_id, position, description, quantity, unit_cost, stock_in, item_id, location_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [purchaseId, i + 1, l.description, l.quantity, money(l.unit_cost), l.stock_in, itemIds[i], l.stock_in ? l.location_id : null],
        );
        if (l.stock_in) {
          await c.query(
            `insert into stock_movements (item_id, location_id, user_id, delta, capacity_delta, reason, note)
             values ($1,$2,$3,$4,$5,'initial',$6)`,
            [itemIds[i], l.location_id, req.user.id, l.quantity, l.quantity, `Direct purchase ${purchaseId}`],
          );
        }
      }
      return purchaseId;
    });

    res.status(201).json(await loadPurchase(id));
  }),
);

// ── reading ────────────────────────────────────────────────────────────────

const SELECT = `
  select p.id, to_char(p.purchased_on, 'YYYY-MM-DD') as purchased_on,
         p.vendor_id, v.name as vendor_name, p.category, p.justification,
         p.purchased_by_name, p.purchased_by_id, p.paid_by_name, p.payment_method, p.receipt_ref,
         p.delivery_cost::float8 as delivery_cost, p.notes, p.recorded_by, rp.full_name as recorded_by_name,
         p.source, p.created_at, p.voided_at, p.void_reason,
         coalesce((select sum(l.quantity * l.unit_cost) from direct_purchase_lines l where l.purchase_id = p.id), 0)::float8 as subtotal,
         (select coalesce(json_agg(json_build_object(
                   'id', l.id, 'position', l.position, 'description', l.description,
                   'quantity', l.quantity, 'unit_cost', l.unit_cost::float8,
                   'total', (l.quantity * l.unit_cost)::float8, 'stock_in', l.stock_in,
                   'item_id', l.item_id, 'location_id', l.location_id, 'location_name', loc.name
                 ) order by l.position), '[]'::json)
            from direct_purchase_lines l left join locations loc on loc.id = l.location_id
           where l.purchase_id = p.id) as lines
    from direct_purchases p
    left join vendors v on v.id = p.vendor_id
    left join profiles rp on rp.id = p.recorded_by`;

type PurchaseRow = {
  subtotal: number;
  delivery_cost: number;
  lines: { total: number; stock_in: boolean; item_id: string | null }[];
  voided_at: string | null;
} & Record<string, unknown>;

/** Adds the computed total — it is never stored. */
const withTotal = <T extends PurchaseRow>(r: T) => ({ ...r, total: money(r.subtotal + r.delivery_cost) });

async function loadPurchase(id: string) {
  const r = await maybeOne<PurchaseRow>(`${SELECT} where p.id = $1`, [id]);
  return r ? withTotal(r) : null;
}

const filterQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vendor_id: z.string().uuid().optional(),
  category: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  include_voided: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().positive().max(1000).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});

function filters(q: z.infer<typeof filterQuery>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: string) => string, v: unknown) => {
    params.push(v);
    where.push(sql(`$${params.length}`));
  };
  if (!q.include_voided) where.push("p.voided_at is null");
  if (q.from) add((n) => `p.purchased_on >= ${n}::date`, q.from);
  if (q.to) add((n) => `p.purchased_on <= ${n}::date`, q.to);
  if (q.vendor_id) add((n) => `p.vendor_id = ${n}`, q.vendor_id);
  if (q.category) add((n) => `lower(p.category) = lower(${n})`, q.category);
  if (q.q) {
    add(
      (n) =>
        `(v.name ilike '%' || ${n} || '%' or p.receipt_ref ilike '%' || ${n} || '%' or p.justification ilike '%' || ${n} || '%'
          or exists (select 1 from direct_purchase_lines l where l.purchase_id = p.id and l.description ilike '%' || ${n} || '%'))`,
      q.q,
    );
  }
  return { sql: where.length ? `where ${where.join(" and ")}` : "", params };
}

directPurchasesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = filterQuery.parse(req.query);
    const f = filters(q);
    f.params.push(q.limit, q.offset);
    const list = await rows<PurchaseRow>(
      `${SELECT} ${f.sql} order by p.purchased_on desc, p.created_at desc limit $${f.params.length - 1} offset $${f.params.length}`,
      f.params,
    );
    res.json(list.map(withTotal));
  }),
);

/** Totals for the finance view: by category, by vendor and by month, and stock vs consumable. */
directPurchasesRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const q = filterQuery.parse(req.query);
    const f = filters({ ...q, include_voided: false });
    const from = `from direct_purchases p left join vendors v on v.id = p.vendor_id ${f.sql}`;
    const total = `(coalesce((select sum(l.quantity * l.unit_cost) from direct_purchase_lines l where l.purchase_id = p.id), 0) + p.delivery_cost)`;
    const [byCategory, byVendor, byMonth, split] = await Promise.all([
      rows(`select p.category as name, count(*)::int as purchases, sum(${total})::float8 as total ${from} group by p.category order by total desc`, f.params),
      rows(`select coalesce(v.name, '—') as name, count(*)::int as purchases, sum(${total})::float8 as total ${from} group by v.name order by total desc`, f.params),
      rows(`select to_char(date_trunc('month', p.purchased_on), 'YYYY-MM') as month, count(*)::int as purchases, sum(${total})::float8 as total ${from} group by 1 order by 1`, f.params),
      rows<{ stock: number; consumable: number }>(
        `select coalesce(sum(case when l.stock_in then l.quantity * l.unit_cost end), 0)::float8 as stock,
                coalesce(sum(case when not l.stock_in then l.quantity * l.unit_cost end), 0)::float8 as consumable
           from direct_purchase_lines l join direct_purchases p on p.id = l.purchase_id left join vendors v on v.id = p.vendor_id ${f.sql}`,
        f.params,
      ),
    ]);
    const grand = byCategory.reduce((s, r: any) => s + r.total, 0);
    res.json({
      purchases: byCategory.reduce((s, r: any) => s + r.purchases, 0),
      total: money(grand),
      stock_lines_total: money(split[0]?.stock ?? 0),
      consumable_lines_total: money(split[0]?.consumable ?? 0),
      by_category: byCategory,
      by_vendor: byVendor,
      by_month: byMonth,
    });
  }),
);

/**
 * CSV in the finance spreadsheet's own column order, one row per line, so the
 * team can keep using the layout they know. Delivery appears once per purchase
 * (on its first line) so a column total is not inflated.
 */
directPurchasesRouter.get(
  "/export",
  asyncHandler(async (req, res) => {
    const q = filterQuery.parse(req.query);
    const f = filters({ ...q, limit: 1000, offset: 0 });
    const list = await rows<PurchaseRow>(`${SELECT} ${f.sql} order by p.purchased_on, p.created_at`, f.params);
    const out = [
      csvRow([
        "Purchase Date", "Item Description", "Category", "Justification / Purpose", "Purchased By", "Vendor / Source",
        "Quantity", "Unit Cost (RWF)", "Total Cost (RWF)", "Delivery Cost", "Who Paid", "Payment Method",
        "Receipt / Invoice Reference", "Status / Notes", "Stock",
      ]),
    ];
    for (const p of list as any[]) {
      p.lines.forEach((l: any, i: number) => {
        out.push(
          csvRow([
            p.purchased_on, l.description, p.category, p.justification, p.purchased_by_name, p.vendor_name,
            l.quantity, l.unit_cost, money(l.quantity * l.unit_cost), i === 0 ? p.delivery_cost : "", p.paid_by_name,
            p.payment_method, p.receipt_ref, p.voided_at ? `Void: ${p.void_reason ?? ""}` : "Complete",
            l.stock_in ? `Stocked${l.location_name ? ` — ${l.location_name}` : ""}` : "Consumable (not stocked)",
          ]),
        );
      });
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="direct-purchases-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send("﻿" + out.join("\r\n") + "\r\n"); // BOM so Excel reads UTF-8 names correctly
  }),
);

directPurchasesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const p = await loadPurchase(id);
    if (!p) throw new HttpError(404, "Purchase not found.", "not_found");
    res.json(p);
  }),
);

/** A mistaken purchase is voided with a reason — never deleted. */
directPurchasesRouter.post(
  "/:id/void",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    const p = await loadPurchase(id);
    if (!p) throw new HttpError(404, "Purchase not found.", "not_found");
    if (p.voided_at) throw new HttpError(409, "That purchase is already void.", "already_void");
    if (p.lines.some((l) => l.stock_in && l.item_id)) {
      throw new HttpError(
        409,
        "This purchase added stock. Undo those stock movements first (Items → the item → Activity → Undo), then void it.",
        "has_stock",
      );
    }
    await rows("update direct_purchases set voided_at = now(), voided_by = $2, void_reason = $3 where id = $1", [id, req.user.id, reason]);
    res.json(await loadPurchase(id));
  }),
);
