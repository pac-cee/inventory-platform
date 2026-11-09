"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
export function EmbeddedLayout({
  children,
  full,
}: {
  children: React.ReactNode;
  full: React.ReactNode;
}) {
  const embedded = useSyncExternalStore(
    subscribe,
    () => window.self !== window.top,
    () => false,
  );
  return embedded ? (
    <main className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      {children}
    </main>
  ) : (
    full
  );
}
