"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UndoMovementButton } from "@/components/dashboard/undo-movement-button";
import type { Movement } from "@/lib/api/types";

/** Never more than this on screen — the log is for glancing at, not reading. */
const PAGE = 5;

/** Human-readable label + tone for an activity row. */
function movementLabel(m: Movement): { text: string; tone: string } {
  const n = Math.abs(m.delta);
  switch (m.reason) {
    case "return":
      return { text: `Returned ${n}`, tone: "text-success" };
    case "initial":
      return { text: `Stocked ${n}`, tone: "text-success" };
    case "finish":
      return { text: `Finished ${n}`, tone: "text-warning" };
    case "destroyed":
      return { text: `Damaged ${Math.abs(m.damaged_delta) || n}`, tone: "text-warning" };
    case "lost":
      return { text: `Lost ${Math.abs(m.capacity_delta) || n}`, tone: "text-destructive" };
    case "repair":
      return { text: `Repaired ${n}`, tone: "text-success" };
    case "undo":
      return { text: "Undid", tone: "text-muted-foreground" };
    case "adjust": {
      const parts: string[] = [];
      if (m.delta !== 0) parts.push(`qty ${m.delta > 0 ? "+" : ""}${m.delta}`);
      if (m.capacity_delta !== 0)
        parts.push(`total ${m.capacity_delta > 0 ? "+" : ""}${m.capacity_delta}`);
      return {
        text: `Adjusted${parts.length ? ` (${parts.join(", ")})` : ""}`,
        tone: "text-foreground",
      };
    }
    case "take":
    default:
      return m.delta < 0
        ? { text: `Took ${n}`, tone: "text-warning" }
        : { text: `Added ${n}`, tone: "text-success" };
  }
}

/**
 * The movement log, five at a time.
 *
 * Every movement used to render at once, so an item with a long history pushed
 * everything below it off the screen. Paging keeps the page a fixed height
 * whatever the history looks like.
 */
export function ActivityLog({
  movements,
  itemId,
  userId,
  isAdmin,
  nameById,
  reversedIds,
}: {
  movements: Movement[];
  itemId: string;
  userId: string;
  isAdmin: boolean;
  /** user_id -> display name, resolved on the server. */
  nameById: Record<string, string>;
  /** Movements already reversed, so they can't be undone twice. */
  reversedIds: string[];
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(movements.length / PAGE));
  const slice = movements.slice(page * PAGE, page * PAGE + PAGE);
  const reversed = new Set(reversedIds);

  if (movements.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-5">Person</TableHead>
            <TableHead className="px-5">Action</TableHead>
            <TableHead className="px-5">Location</TableHead>
            <TableHead className="px-5">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {slice.map((m) => {
            const label = movementLabel(m);
            // Only whoever recorded it (or an admin) can undo — so an
            // admin-attributed damage/loss isn't undoable by the holder.
            const canUndo =
              (m.reason === "finish" || m.reason === "destroyed" || m.reason === "lost") &&
              !reversed.has(m.id) &&
              ((m.recorded_by ?? m.user_id) === userId || isAdmin);
            return (
              <TableRow key={m.id}>
                <TableCell className="px-5 text-foreground">
                  {nameById[m.user_id] || "Unknown"}
                  {/* Recorded by someone else (a manager on their behalf, or an admin attributing damage). */}
                  {m.recorded_by && m.recorded_by !== m.user_id ? (
                    <span className="block text-xs text-muted-foreground">
                      recorded by {nameById[m.recorded_by] || "someone else"}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="px-5">
                  <span className={`font-medium ${label.tone}`}>{label.text}</span>
                  {m.note ? <span className="text-muted-foreground"> · {m.note}</span> : null}
                  {canUndo ? (
                    <span className="ml-2">
                      <UndoMovementButton movementId={m.id} itemId={itemId} />
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="px-5 text-muted-foreground">
                  {m.locations?.name ?? "—"}
                </TableCell>
                <TableCell className="px-5 text-muted-foreground">
                  {new Date(m.created_at).toLocaleString()}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {pages > 1 ? (
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {page * PAGE + 1}–{page * PAGE + slice.length} of {movements.length}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden />
              Back
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              See more
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
