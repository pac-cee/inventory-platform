"use client";

import { useState } from "react";

export type PanelTab = {
  id: string;
  label: string;
  /** Shown under the label — e.g. "2 open", so a shut tab still says something. */
  summary?: string;
  content: React.ReactNode;
};

/**
 * One centred row of buttons, with the chosen panel's content beneath them.
 *
 * The item page was a vertical stack of cards you had to scroll past. Side by
 * side, the whole set is visible at a glance and only what you asked for is
 * rendered. Clicking the open tab shuts it, so nothing is forced open.
 *
 * Every button is the same fixed size whatever its wording, and the row is
 * centred, so a member seeing three tabs gets the same balanced row an admin
 * sees with five instead of a short ragged line pinned to the left edge.
 */
export function PanelTabs({
  tabs,
  defaultTab,
}: {
  tabs: PanelTab[];
  /** Open on load. Omit to start with everything shut. */
  defaultTab?: string;
}) {
  const [active, setActive] = useState<string | null>(defaultTab ?? null);
  const open = tabs.find((t) => t.id === active) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const isOpen = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              aria-expanded={isOpen}
              onClick={() => setActive(isOpen ? null : t.id)}
              className={`flex min-h-11 flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors ${
                isOpen
                  ? "border-border bg-nav-current text-foreground"
                  : "border-border bg-card/50 text-muted-foreground hover:border-foreground/25 hover:text-foreground"
              }`}
            >
              <span className="text-[13px] font-medium leading-tight">
                {t.label}
              </span>
              {t.summary ? (
                <span className="text-xs leading-tight text-muted-foreground">
                  {t.summary}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {open ? (
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-serif text-base text-foreground">
              {open.label}
            </h2>
          </div>
          {open.content}
        </section>
      ) : null}
    </div>
  );
}
