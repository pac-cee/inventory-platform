// Per-route loading skeletons that MIRROR each page's real structure (header,
// panels, forms, tables, tabs) so the skeleton -> content swap is visually
// invisible (no flash of a different shape, nothing floating mid-page).
// Next shows these the instant a tab is clicked (loading.tsx auto-wraps
// page.tsx in <Suspense>). Pure presentational — server components OK.

// Pulsing placeholder bar.
function Bar({ w = "w-40", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} rounded bg-canvas animate-pulse`} />;
}

// Page header (every real page has an <h1> + subtitle) — keep the skeleton top
// aligned like the destination so nothing sits "in the middle".
function HeaderSkel() {
  return (
    <div className="space-y-2">
      <Bar w="w-52" h="h-7" />
      <Bar w="w-80" h="h-4" />
    </div>
  );
}

// Mimics the real <Panel>: titled surface (border + header row) wrapping content.
function PanelSkel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <Bar w="w-32" h="h-5" />
      </div>
      {children}
    </section>
  );
}

// Mimics a form (Add item / Add user / Edit profile / Change password): a 2-col
// grid of label+input bars, then a submit button bar.
function FormSkel({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Bar w="w-24" h="h-3" />
            <Bar w="w-full" h="h-9" />
          </div>
        ))}
      </div>
      <Bar w="w-32" h="h-9" />
    </div>
  );
}

// Mimics a data table: rows of cells, divided, matching the catalog/team tables.
function TableSkel({ rows = 6, cells = 4 }: { rows?: number; cells?: number }) {
  return (
    <div className="px-2 py-2">
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-3 py-3">
            {Array.from({ length: cells }).map((_, c) => (
              <Bar key={c} w={c === 0 ? "w-44" : "w-20"} h="h-4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Mimics a StatCard (home: label + big mono value).
function StatCardSkel() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <Bar w="w-20" h="h-3" />
      <Bar w="w-16" h="h-7" />
    </div>
  );
}

// Mimics a location card (icon + name + meta).
function LocationCardSkel() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 rounded-lg bg-canvas animate-pulse" />
        <div className="flex-1 space-y-2">
          <Bar w="w-32" />
          <Bar w="w-20" h="h-3" />
        </div>
      </div>
    </div>
  );
}

// Container shell shared by every route. Deliberately does NOT draw a topbar —
// (app)/layout's real <Topbar> is persistent and already shows during the
// loading state. We mirror the <main> content area, fill the viewport height,
// and match the destination's content width (max) so the swap is invisible.
function Shell({ children, max = "max-w-6xl" }: { children: React.ReactNode; max?: string }) {
  return (
    <div className={`mx-auto ${max} flex min-h-[calc(100vh-3.5rem)] animate-pulse flex-col gap-6 px-4 py-6 pb-24 sm:px-6 lg:px-8 md:pb-6`}>
      {children}
      {/* spacer fills the rest of the viewport so short pages don't show white space */}
      <div className="flex-1 rounded-xl bg-canvas/30" />
    </div>
  );
}

// --- Variant skeletons, shaped exactly like each destination page. ---

export function OverviewSkeleton() {
  return (
    <Shell>
      <HeaderSkel />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkel key={i} />
        ))}
      </div>
      <PanelSkel>
        <div className="p-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Bar w="w-40" />
              <Bar w="w-16" h="h-3" />
            </div>
          ))}
        </div>
      </PanelSkel>
      <PanelSkel>
        <div className="p-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Bar w="w-32" />
              <Bar w="w-16" h="h-3" />
            </div>
          ))}
        </div>
      </PanelSkel>
      <PanelSkel>
        <TableSkel rows={6} cells={4} />
      </PanelSkel>
    </Shell>
  );
}

// Header with an action button at the right (Items, Locations, Users all have one now).
function HeaderWithActionSkel() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <HeaderSkel />
      <Bar w="w-28" h="h-9" />
    </div>
  );
}

// A row of filter chips (category chips on Items).
function ChipsSkel({ n = 4 }: { n?: number }) {
  return (
    <div className="flex flex-wrap gap-2 px-5 pt-4 pb-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-9 w-24 rounded-full bg-canvas animate-pulse" />
      ))}
    </div>
  );
}

export function ItemsSkeleton() {
  return (
    <Shell>
      <HeaderWithActionSkel />
      <PanelSkel>
        <ChipsSkel />
        <TableSkel rows={6} cells={4} />
      </PanelSkel>
    </Shell>
  );
}

export function LocationsSkeleton() {
  return (
    <Shell>
      <HeaderWithActionSkel />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <LocationCardSkel key={i} />
        ))}
      </div>
    </Shell>
  );
}

export function UsersSkeleton() {
  return (
    <Shell>
      <HeaderWithActionSkel />
      <PanelSkel>
        <TableSkel rows={6} cells={4} />
      </PanelSkel>
    </Shell>
  );
}

export function SettingsSkeleton() {
  return (
    <Shell max="max-w-3xl">
      <HeaderSkel />
      {/* TabsList — 4 triggers */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} w="w-24" h="h-9" />
        ))}
      </div>
      {/* default Profile tab: EditProfileForm */}
      <PanelSkel>
        <FormSkel rows={2} />
      </PanelSkel>
    </Shell>
  );
}

export function PaymentsSkeleton() {
  return (
    <Shell>
      <HeaderSkel />
      {/* tab nav (Request / Reports / History) */}
      <div className="flex gap-4 border-b border-border pb-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Bar key={i} w="w-28" h="h-8" />
        ))}
      </div>
      {/* default Request Expense tab: form panel (2-col) + cart panel (1-col) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PanelSkel>
            <FormSkel rows={3} />
          </PanelSkel>
        </div>
        <div className="lg:col-span-1">
          <PanelSkel>
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Bar w="w-28" />
                  <Bar w="w-16" h="h-3" />
                </div>
              ))}
              <Bar w="w-40" h="h-6" />
            </div>
          </PanelSkel>
        </div>
      </div>
    </Shell>
  );
}

/** Reports: tab strip, then the filter panel (forms), like the real page. */
export function ReportsSkeleton() {
  return (
    <Shell>
      <HeaderSkel />
      <div className="h-10 rounded-lg bg-canvas animate-pulse" />
      <PanelSkel>
        <FormSkel rows={4} />
      </PanelSkel>
    </Shell>
  );
}

/** Borrowed equipment: tabs, four stat tiles, a search row, then the list. */
export function EquipmentSkeleton() {
  return (
    <Shell>
      <HeaderWithActionSkel />
      <div className="h-10 w-56 rounded-lg bg-canvas animate-pulse" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkel key={i} />
        ))}
      </div>
      <Bar w="w-full" h="h-10" />
      <PanelSkel>
        <TableSkel rows={4} cells={4} />
      </PanelSkel>
    </Shell>
  );
}

/** An item or location detail page: title, then a couple of panels. */
export function DetailSkeleton() {
  return (
    <Shell max="max-w-5xl">
      <HeaderSkel />
      <PanelSkel>
        <FormSkel rows={2} />
      </PanelSkel>
      <PanelSkel>
        <TableSkel rows={4} cells={4} />
      </PanelSkel>
    </Shell>
  );
}

/** Box labels: heading, the selection bar, then label strips. */
export function LabelsSkeleton() {
  return (
    <Shell max="max-w-5xl">
      <HeaderWithActionSkel />
      <Bar w="w-72" h="h-8" />
      <div className="mx-auto w-full max-w-[190mm] space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[48mm] rounded-lg bg-canvas animate-pulse" />
        ))}
      </div>
    </Shell>
  );
}
