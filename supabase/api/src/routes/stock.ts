import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http.js";
import { requireAuth } from "../middleware/auth.js";
import { rows } from "../db.js";
import { loadLocationPaths } from "../lib/locationPath.js";

export const stockRouter = Router();

stockRouter.use(requireAuth);

const stockQuery = z.object({
  item_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
});

/**
 * Current stock levels per (item, location), with the item and location
 * details joined in (as nested `items` / `locations` objects, matching the old
 * PostgREST embed shape). Optionally filter by item_id and/or location_id.
 */
stockRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { item_id, location_id } = stockQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (item_id) {
      params.push(item_id);
      where.push(`s.item_id = $${params.length}`);
    }
    if (location_id) {
      params.push(location_id);
      where.push(`s.location_id = $${params.length}`);
    }
    const levels = await rows<{ location_id: string; locations: { name: string } }>(
        `select s.item_id, s.location_id, s.quantity, s.damaged, s.capacity, s.slot_no,
                s.updated_at, s.container_label,
                json_build_object('type', i.type, 'name', i.name, 'model', i.model,
                                  'sku', i.sku, 'units_per_container', i.units_per_container) as items,
                json_build_object('name', l.name) as locations
           from item_stock s
           join items i on i.id = s.item_id
           join locations l on l.id = s.location_id
           ${where.length ? "where " + where.join(" and ") : ""}`,
      params,
    );
    // Full path, so a shelf is identifiable without opening the location.
    const pathOf = await loadLocationPaths();
    res.json(
      levels.map((r) => ({
        ...r,
        locations: { ...r.locations, name: pathOf(r.location_id) || r.locations?.name },
      })),
    );
  }),
);
