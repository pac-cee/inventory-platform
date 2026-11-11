// Shared types mirroring the inventory-api responses.

export interface ApiUser {
  id: string;
  email?: string;
  [key: string]: unknown;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at?: number; // unix seconds
  expires_in?: number;
  token_type?: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  role: "member" | "admin" | "stock_manager";
  blocked: boolean;
  /** 0040: warehouse rights granted to an individual, without the role. */
  can_manage_inventory?: boolean;
  /** Accounts that registered themselves wait here until an admin unblocks them. */
  approval_status?: "pending" | "approved" | "rejected";
  /** Admin-only: whether the person has confirmed the address they signed up with. */
  email?: string;
  email_confirmed?: boolean;
  created_at: string;
  has_payment_permission?: boolean;
  /** 'cashier' lets a non-admin approve payments. */
  fallback_role?: string | null;
  daily_limit?: number;
  monthly_limit?: number;
  per_transaction_limit?: number;
}

export interface Item {
  id: string;
  /** Machine-assigned, `vrlt-<consonants of type>-<seq>`. Never editable. */
  sku: string;
  /** What kind of thing this is — "Cable". Drives the SKU prefix. */
  type: string;
  /** What this particular item is called. */
  name: string;
  /** Model designation. Required; older rows carry 'Unspecified'. */
  model: string;
  /** Free-text spec that further differentiates variants. */
  specification: string | null;
  /** Individual units packed in one container (box/pallet/crate); 1 = loose. */
  units_per_container: number;
  /** When set, stock is counted in whole packages (contents not tracked); the
   *  quantity is a package count and the UI shows "5 <package_label>s". */
  package_label: string | null;
  /** When true, users can permanently "finish" (consume) this item. */
  finishable: boolean;
  /** Grouping for the condition report — "Computer Laptop", "Cables". Free
   *  text; /reports/categories lists what's already in use. */
  category: string | null;
  /** The department this item belongs to (see Department); null = none. */
  department_id?: string | null;
  /** Link to a picture hosted elsewhere. */
  photo_url: string | null;
  /** True when an image was uploaded. The bytes come from /items/:id/photo —
   *  they are deliberately never inlined in a list response. */
  has_photo?: boolean;
  created_at: string;
}

/**
 * A change worth making to an item that is NOT damaged — an upgrade, a service.
 * Raising one moves no stock; it only appears in Recommendation.
 */
export interface Suggestion {
  id: string;
  item_id: string;
  location_id: string | null;
  note: string;
  kind: "upgrade" | "replace" | "maintenance" | "other";
  units: number | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  /** The item's identity, as the suggestions route joins it in. */
  item_type: string;
  item_name: string;
  item_model: string;
  item_sku: string;
  location_name: string;
}

/** One outstanding fault: why some units are damaged, and what to do about it. */
export interface Fault {
  id: string;
  note: string;
  recommendation: string | null;
  /** Units still affected — the fault's damage minus everything repaired against it. */
  units: number;
  created_at: string;
}

/**
 * One row of the condition report: an item at a location, with its state.
 *
 * `operational` counts checked-out units (they still work), so it is
 * `total - damaged` rather than anything derived from what's on the shelf.
 */
export interface ConditionRow {
  item_id: string;
  location_id: string;
  type: string;
  name: string;
  model: string;
  sku: string;
  specification: string | null;
  category: string | null;
  package_label: string | null;
  units_per_container: number;
  location_name: string;
  room_id: string;
  room_name: string;
  total: number;
  available: number;
  damaged: number;
  operational: number;
  in_use: number;
  faults: Omit<Fault, "id" | "created_at">[];
  /** Open suggestions for this row — work worth doing, not damage. */
  suggestions: { note: string; kind: string; units: number | null }[];
  /** Damaged units explained by a recorded fault. Below `damaged` when damage
   *  predates required reasons — the report shows the gap rather than hiding it. */
  accounted: number;
}

export type MovementReason =
  | "take"
  | "return"
  | "initial"
  | "finish"
  | "destroyed"
  | "lost"
  | "repair"
  | "adjust"
  | "undo";

export interface Location {
  id: string;
  name: string;
  /** Parent "category" location; null for a top-level location. */
  parent_id: string | null;
  created_at: string;
  /**
   * Set when the location was removed but had ledger history, so the row is
   * kept for historical movements. Archived locations never appear in
   * `GET /locations`; only a direct fetch by id can return one.
   */
  archived_at?: string | null;
  /** Link to a picture of this place (0036); null when there is none. */
  photo_url?: string | null;
  /** True when a file was uploaded — the bytes come from /locations/:id/photo. */
  has_photo?: boolean;
  /** area | shelf | level | box (0041). A box is a labelled container with a QR code. */
  kind?: "area" | "shelf" | "level" | "box";
  /** What a box is for ("USB-A to C cables"). */
  label?: string | null;
  /** The code on a box's QR sticker; set by the API, only for boxes. */
  qr_token?: string | null;
}

export interface StockLevel {
  item_id: string;
  location_id: string;
  quantity: number;
  /** Damaged units — present and part of the total, but not accessible. */
  damaged: number;
  /** The amount this (item, location) was first stocked with — its ceiling. */
  capacity: number;
  /**
   * The item's number within this location (0036) — what people point at on
   * the shelf. Counts from 1 per location, so the same item can be #2 here and
   * #7 elsewhere. Null only for a row written before the trigger existed.
   */
  slot_no?: number | null;
  updated_at: string;
  container_label?: string | null;
  items?: {
    type: string;
    name: string;
    model: string;
    sku: string;
    units_per_container?: number;
  } | null;
  locations?: { name: string } | null;
}

/** A person currently holding this item (net checked out). */
export interface Holder {
  user_id: string;
  full_name: string;
  quantity: number;
}

/** A hold on units of an item at a location for a window of dates (0043). */
export interface Reservation {
  id: string;
  item_id: string;
  item_name: string;
  location_id: string;
  location_name: string;
  user_id: string;
  user_name: string | null;
  requested_by: string;
  requested_by_name: string | null;
  quantity: number;
  starts_at: string;
  ends_at: string;
  status: "approved" | "cancelled" | "fulfilled";
  /** Derived from the dates: upcoming, active, expired — or the stored outcome. */
  state: "upcoming" | "active" | "expired" | "cancelled" | "fulfilled";
  note: string | null;
  created_at: string;
}

/** One outstanding loan from GET /movements/borrowed: units taken, and when they are due back. */
export interface Loan {
  take_id: string;
  item_id: string;
  item_name: string;
  user_id: string;
  user_name: string;
  location_id: string;
  location_name: string;
  quantity: number;
  taken_at: string;
  expected_return_at: string | null;
  status: "none" | "upcoming" | "due_today" | "overdue";
  days_overdue: number;
}

// ── Activity report ─────────────────────────────────────────────────────────

/** One enriched activity row from GET /movements/report. */
export interface ReportRow {
  id: string;
  created_at: string;
  reason: MovementReason;
  /** Human label, e.g. "Damaged 3", "Took 5". */
  label: string;
  /** The natural unit count for the action (used for summary totals). */
  units: number;
  delta: number;
  capacity_delta: number;
  damaged_delta: number;
  item: {
    id: string;
    type: string;
    name: string;
    model: string;
    sku: string;
    specification: string | null;
  };
  /** Full location path, e.g. "Room › Cupboard › Level". */
  location: { id: string; name: string };
  /** Person the activity is attributed to. */
  person: { id: string | null; name: string | null };
  /** Person who recorded it (an admin, when attributed to someone else). */
  actor: { id: string | null; name: string | null };
  note: string | null;
  /** True if this entry was later undone. */
  reversed: boolean;
}

/** A summary rollup bucket (per reason / person / item). */
export interface ReportBucket {
  key: string;
  name: string;
  count: number;
  units: number;
}

export interface ActivityReport {
  count: number;
  rows: ReportRow[];
  summary: {
    byReason: ReportBucket[];
    byPerson: ReportBucket[];
    byItem: ReportBucket[];
  };
}

export interface Movement {
  id: string;
  item_id: string;
  location_id: string;
  /** Who the movement is attributed to (for damage/loss, the holder). */
  user_id: string;
  /** Who physically recorded it (an admin, when attributed). Used to gate undo. */
  recorded_by: string | null;
  delta: number;
  /** Change to the ceiling (negative for finish/lost, positive for undo). */
  capacity_delta: number;
  /** Change to the damaged bucket (positive when damaged, negative on repair/undo). */
  damaged_delta: number;
  reason: MovementReason;
  /** For an undo movement, the id of the movement it reverses. */
  reversal_of: string | null;
  note: string | null;
  created_at: string;
  items?: {
    type: string;
    name: string;
    model: string;
    sku: string;
    specification?: string | null;
  } | null;
  locations?: { name: string } | null;
}

/** One row from `GET /payments/reports/detailed` — a purchase-time snapshot,
 *  not joined against `items` (there's no item_id FK on transaction_products). */
export interface DetailedPaymentReportRow {
  id: string;
  created_at: string;
  amount: number;
  status: "pending" | "processing" | "completed" | "failed";
  payment_method: string | null;
  recipient_phone: string | null;
  failure_reason: string | null;
  profiles: { full_name: string | null };
  locations: { name: string } | null;
  transaction_products: {
    id: string;
    name: string;
    /** Carried since 0039 so an approved purchase makes a proper item. */
    type: string | null;
    model: string | null;
    sku: string | null;
    specification: string | null;
    quantity: number;
    price: number;
  }[];
}

export interface DetailedPaymentReport {
  count: number;
  rows: DetailedPaymentReportRow[];
  summary: { totalAmount: number; byStatus: Record<string, number> };
}

/** A team that items can belong to. Admins and stock managers add, rename,
 *  recolour and remove them; removing one leaves its items with no department. */
export interface Department {
  id: string;
  name: string;
  /** Hex colour of its dot, e.g. "#5b8fd6". */
  color: string;
  created_at: string;
}

/** One desk on the office map: who sits there and where it stands. Desks the
 *  API has no row for stand at their place on the floor plan, unassigned. */
export interface Desk {
  /** The floor plan's id for the desk, e.g. "soft-workstation-3". */
  id: string;
  user_id: string | null;
  /** Metres from the hall's centre; null = the floor plan's place. */
  x: number | null;
  z: number | null;
  /** Degrees, in steps of 90. */
  rotation: number | null;
}
