import type { Department, Item } from "@/lib/api/types";

/** The value in the address for "items with no department". Never a real id. */
export const NO_DEPARTMENT = "__none";

/** Colours offered for a new department; any hex colour can be picked after. */
export const DEPARTMENT_COLORS = [
  "#5b8fd6", "#5fae8b", "#d9774f", "#c9a15a", "#a07fd0", "#d46a8c", "#4fa9b3", "#8a9a92",
];

/** The next colour not yet in use, so new departments start out distinct. */
export function nextDepartmentColor(departments: Pick<Department, "color">[]): string {
  const used = new Set(departments.map((d) => d.color.toLowerCase()));
  return DEPARTMENT_COLORS.find((c) => !used.has(c)) ?? DEPARTMENT_COLORS[departments.length % DEPARTMENT_COLORS.length];
}

/** The department an item belongs to, or null when it has none (or the
 *  department was removed since). */
export function departmentOf<D extends Pick<Department, "id">>(
  item: Pick<Item, "department_id">,
  departments: D[],
): D | null {
  return departments.find((d) => d.id === item.department_id) ?? null;
}

/** Items in a department (by id), the ones with none for NO_DEPARTMENT; all when empty. */
export function filterByDepartment<T extends Pick<Item, "department_id">>(
  items: T[],
  department: string | undefined,
  departments: Pick<Department, "id">[],
): T[] {
  if (!department) return items;
  if (department === NO_DEPARTMENT) return items.filter((i) => !departmentOf(i, departments));
  return items.filter((i) => i.department_id === department);
}

/** How many items each department has, and how many have none. */
export function departmentCounts(
  items: Pick<Item, "department_id">[],
  departments: Pick<Department, "id">[],
): { byId: Record<string, number>; none: number } {
  const byId: Record<string, number> = Object.fromEntries(departments.map((d) => [d.id, 0]));
  let none = 0;
  for (const item of items) {
    if (item.department_id && item.department_id in byId) byId[item.department_id]++;
    else none++;
  }
  return { byId, none };
}

/** What a department name must be: trimmed, 1 to 40 characters. */
export function cleanDepartmentName(raw: unknown): string | null {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 40 ? name : null;
}

export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
