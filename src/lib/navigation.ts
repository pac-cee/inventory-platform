import { canManageInventory, type Role } from "./roles";

export interface NavItem {
  href: string;
  label: string;
  icon:
    | "home"
    | "map"
    | "inventory"
    | "locations"
    | "borrowed"
    | "reports"
    | "payments"
    | "users"
    | "settings";
}
export function navigationFor(
  role: Role,
  hasPaymentPermission: boolean,
): { primary: NavItem[]; more: NavItem[] } {
  const manager = canManageInventory({ role });
  return {
    primary: [
      { href: "/", label: "Home", icon: "home" },
      { href: "/space", label: "Office map", icon: "map" },
      {
        href: manager ? "/items" : "/search",
        label: "Inventory",
        icon: "inventory",
      },
    ],
    more: [
      { href: "/locations", label: "Locations", icon: "locations" },
      ...(manager
        ? [
            {
              href: "/equipment",
              label: "Borrowed",
              icon: "borrowed" as const,
            },
            { href: "/reports", label: "Reports", icon: "reports" as const },
          ]
        : []),
      ...(role === "admin" || hasPaymentPermission
        ? [{ href: "/payments", label: "Payments", icon: "payments" as const }]
        : []),
      ...(role === "admin"
        ? [{ href: "/users", label: "People", icon: "users" as const }]
        : []),
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  };
}
