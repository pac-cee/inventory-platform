import Link from "next/link";
import { ItemThumb } from "@/components/dashboard/item-photo";
import { redirect } from "next/navigation";
import { serverApi, ApiError } from "@/lib/api/server";
import { Panel } from "@/components/dashboard/widgets";
import { AddItemDialog } from "@/components/dashboard/add-item-dialog";
import { CategoryChips } from "@/components/dashboard/category-chips";
import {
  CategoryManager,
  type CategoryUsage,
} from "@/components/dashboard/category-manager";
import { RemoveItemButton } from "@/components/dashboard/remove-item-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { matchesItem } from "@/lib/search";
import {
  UNCATEGORIZED,
  filterByCategory,
  uncategorizedCount,
} from "@/lib/category-filter";
import { Pager } from "@/components/dashboard/pager";
import { fetchAllItems } from "@/lib/api/items";
import { PAGE_SIZE, pageOf } from "@/lib/paginate";
import type { ApiUser, Profile, Item, Location } from "@/lib/api/types";
import { canManageInventory } from "@/lib/roles";

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; category?: string }>;
}) {
  const api = serverApi();
  const sp = await searchParams;
  // The topbar search narrows this catalog rather than leaving the page.
  const query = sp.q?.trim() ?? "";
  // Chosen by clicking a category above the table; exact name, or UNCATEGORIZED.
  const category = sp.category?.trim() ?? "";

  // Admins only.
  let profile: Profile | null = null;
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>(
      "/auth/me",
    );
    profile = me.profile;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401)
      redirect("/session-ended");
    throw err;
  }
  // Warehouse screen: a stock manager belongs here too, not just an admin.
  if (!canManageInventory(profile)) redirect("/");

  let items: Item[] = [];
  let locations: Location[] = [];
  let categories: string[] = [];
  let categoryUsage: CategoryUsage[] = [];
  let loadError: string | null = null;
  try {
    [items, locations, categories, categoryUsage] = await Promise.all([
      // P4: read-only catalog lists — cache 60s. Every page of items, since
      // the search below runs over the catalog, not over one visible page.
      fetchAllItems(api, { revalidate: 60 }),
      api.get<Location[]>("/locations", { revalidate: 60 }),
      api.get<string[]>("/reports/categories", { revalidate: 60 }),
      // Counts, so the × can say how many items a removal would touch.
      api.get<CategoryUsage[]>("/items/categories", { revalidate: 60 }),
    ]);
  } catch (err) {
    loadError = err instanceof ApiError ? err.message : "Could not load items.";
  }

  const inCategory = filterByCategory(items, category);
  const matched = query
    ? inCategory.filter((item) => matchesItem(item, query))
    : inCategory;
  const categoryName = category === UNCATEGORIZED ? "Uncategorized" : category;
  // The table shows one page at a time; the search still sees all of them.
  const shown = pageOf(matched, sp.page);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[1.75rem] text-foreground">Items</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse the catalog, add items and manage categories.
          </p>
        </div>
        <AddItemDialog locations={locations} categories={categories} />
      </div>

      {loadError ? (
        <Alert variant="warning">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <div id="catalog" className="scroll-mt-20">
        <Panel
          title={categoryName ? `Catalog · ${categoryName}` : "Catalog"}
          action={
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {query || category
                  ? `${matched.length} of ${items.length}${query ? ` · “${query}”` : ""}`
                  : `${items.length} items`}
              </span>
              <CategoryManager categories={categoryUsage} />
            </div>
          }
        >
          <div className="pt-4">
            <CategoryChips
              categories={categoryUsage}
              active={category}
              total={items.length}
              uncategorized={uncategorizedCount(items)}
              query={query || undefined}
            />
          </div>
          {matched.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              {query
                ? `No item matches “${query}”${categoryName ? ` in ${categoryName}` : ""}.`
                : category
                  ? `No items in ${categoryName}.`
                  : "No items yet."}
            </p>
          ) : (
            <Table className="px-2">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5">Item type</TableHead>
                  <TableHead className="px-5">Name</TableHead>
                  <TableHead className="px-5">Model</TableHead>
                  <TableHead className="px-5">SKU</TableHead>
                  <TableHead className="px-5">Specification</TableHead>
                  <TableHead className="px-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-5 font-medium">
                      {/* Photo first, then the name — one reading order everywhere. */}
                      <Link
                        href={`/items/${item.id}`}
                        className="inline-flex items-center gap-3 text-foreground hover:text-highlight"
                      >
                        <ItemThumb
                          size={40}
                          url={item.photo_url}
                          alt=""
                          itemId={item.id}
                          hasPhoto={item.has_photo}
                        />
                        {item.type}
                      </Link>
                    </TableCell>
                    <TableCell className="px-5 text-muted-foreground">
                      {item.name}
                    </TableCell>
                    <TableCell className="px-5 text-muted-foreground">
                      {item.model}
                    </TableCell>
                    <TableCell className="px-5 font-mono text-xs text-muted-foreground">
                      {item.sku}
                    </TableCell>
                    <TableCell className="px-5 text-muted-foreground">
                      <span className="line-clamp-1 max-w-xs">
                        {item.specification ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="px-5 text-right">
                      <div className="flex justify-end">
                        <RemoveItemButton id={item.id} name={item.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Next/Previous, so the catalog past the first page is reachable. */}
          {matched.length > 0 ? (
            <Pager
              page={sp.page}
              total={matched.length}
              size={PAGE_SIZE}
              basePath="/items"
              params={{
                q: query || undefined,
                category: category || undefined,
              }}
              label="items"
            />
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
