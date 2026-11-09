import React from "react";

const styles: Record<string, string> = {
  pending: "bg-warning-soft text-warning border-warning/10",
  processing: "bg-info-soft text-info border-info/10",
  completed: "bg-success-soft text-success border-success/10",
  failed: "bg-destructive-soft text-destructive border-destructive/10",
};

const labels: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Approved",
  failed: "Failed",
};

// Shared transaction status pill, extracted from the monolith so the split
// Reports/History panels render it without prop-drilling a closure.
export const StatusBadge = React.memo(function StatusBadge({
  status,
}: {
  status: "pending" | "processing" | "completed" | "failed";
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
});
