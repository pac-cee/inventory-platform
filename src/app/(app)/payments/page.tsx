import React from "react";
import { serverApi, ApiError } from "@/lib/api/server";
import { fetchAllItems } from "@/lib/api/items";
import { redirect } from "next/navigation";
import { PaymentsClient } from "@/components/dashboard/payments-client";
import type { ApiUser, Profile, Location, Item, StockLevel } from "@/lib/api/types";
import { canUsePayments, type Role } from "@/lib/roles";

export default async function PaymentsPage() {
  const api = serverApi();
  let userName = "User";
  let userRole: Role = "member";
  let locations: Location[] = [];
  let items: Item[] = [];
  let stock: StockLevel[] = [];
  let categories: string[] = [];

  let profile: Profile | null = null;

  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>("/auth/me");
    profile = me.profile ?? null;
    userName = me.profile?.full_name || me.user.email || "User";
    // Payment approvals are admin-only: a manager is a plain member here.
    userRole = me.profile?.role === "admin" ? "admin" : "member";

    [locations, items, stock, categories] = await Promise.all([
      // P4: read-only lists — cache 60s (auth/me stays uncached above).
      api.get<Location[]>("/locations", { revalidate: 60 }),
      // Every page: a hard ?limit=200 would quietly hide the catalog past 200.
      fetchAllItems(api, { revalidate: 60 }),
      api.get<StockLevel[]>("/stock", { revalidate: 60 }),
      api.get<string[]>("/reports/categories", { revalidate: 60 }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      redirect("/session-ended");
    }
    console.error("Failed to retrieve data for payments page:", err);
  }

  // This page had no role guard at all: the sidebar merely hid the link, so
  // anyone who typed /payments could open it. The API still refused the calls,
  // but the page rendered. Gate it on the same rule the sidebar uses.
  if (!canUsePayments(profile)) redirect("/");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-serif text-[1.75rem] text-foreground">
          Payments & Expenses
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Initiate corporate mobile money (MoMo) payments and track request history.
        </p>
      </div>

      <PaymentsClient
        currentUserName={userName}
        role={userRole}
        locations={locations}
        items={items}
        stock={stock}
        categories={categories}
      />
    </div>
  );
}


