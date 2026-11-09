-- 0020_units_per_container.sql
-- Add container-aware quantity tracking to items + item_stock.
-- Backward-compatible: defaults preserve legacy behavior (1 unit per container).

-- 1. items: how many individual units in one container (box/pallet/crate).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS units_per_container integer NOT NULL DEFAULT 1;

-- 2. item_stock: track container label
--    quantity remains in UNITS (for math and triggers).
--    container_label = optional display text: "box", "pallet", "crate".
--    API/UI computes containers = quantity / units_per_container.
ALTER TABLE item_stock
  ADD COLUMN IF NOT EXISTS container_label text;