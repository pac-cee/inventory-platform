import React from "react";
import { Panel } from "@/components/dashboard/widgets";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, AlertCircle, FileText, Camera, Upload } from "lucide-react";
import { formatRWF } from "./format";
import { StatusBadge } from "./status-badge";
import type { Transaction } from "./types";
import type { Role } from "@/lib/roles";

interface HistoryTableProps {
  transactions: Transaction[];
  visibleCount: number;
  onLoadMore: () => void;
  role: Role;
  currentUserName: string;
  onViewPhoto: (tx: Transaction) => void;
  onUploadReceipt: (tx: Transaction, file: File) => void;
}

// Memoized so a form keystroke / unrelated parent re-render does NOT re-render
// the (potentially large) transaction ledger. Only re-renders when its props
// actually change (transactions, visibleCount, role, callbacks).
export const HistoryTable = React.memo(function HistoryTable({
  transactions,
  visibleCount,
  onLoadMore,
  role,
  currentUserName,
  onViewPhoto,
  onUploadReceipt,
}: HistoryTableProps) {
  return (
    <Panel
      title="Corporate Request Ledger"
      action={
        <span className="text-xs text-muted-foreground">
          {transactions.length} total entries
        </span>
      }
    >
      {transactions.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-muted-foreground">
          No expense transactions submitted yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">Destination / Account</TableHead>
                <TableHead className="px-5">Product Details</TableHead>
                <TableHead className="px-5">Requested By</TableHead>
                <TableHead className="px-5">Location</TableHead>
                <TableHead className="px-5 text-right">Total Price</TableHead>
                <TableHead className="px-5 text-right">Status</TableHead>
                <TableHead className="px-5 text-right">Stock</TableHead>
                <TableHead className="px-5 text-right">Item Photo</TableHead>
                <TableHead className="px-5 text-right">Receipt Photo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.slice(0, visibleCount).map((tx) => {
                const totalAmt = tx.price;
                const hasReceipt = !!tx.receiptPhoto;

                return (
                  <TableRow key={tx.id}>
                    <TableCell className="px-5 font-semibold text-foreground">
                      {tx.paymentMethod === "bk" && tx.paymentMetadata ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm">{tx.paymentMetadata.bankAccountNumber}</span>
                          <span className="text-xs text-muted-foreground font-normal">{tx.paymentMetadata.bankAccountName} (TIN: {tx.paymentMetadata.tinNumber})</span>
                        </div>
                      ) : (
                        tx.recipient || "—"
                      )}
                    </TableCell>
                    <TableCell className="px-5 text-muted-foreground max-w-xs">
                      {tx.products && tx.products.length > 0 ? (
                        <div className="space-y-1">
                          <div className="font-semibold text-xs text-foreground">
                            {tx.productName}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {tx.products.map((p) => `${p.name} (×${p.quantity})`).join(", ")}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="font-semibold text-xs text-foreground">
                            {tx.productName}
                          </div>
                          {tx.description && (
                            <div className="text-[10px] text-muted-foreground">{tx.description}</div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-5 text-muted-foreground font-medium text-xs">
                      {tx.createdBy}
                    </TableCell>
                    <TableCell className="px-5 text-muted-foreground text-xs">
                      {tx.locationName || "—"}
                    </TableCell>
                    <TableCell className="px-5 text-right font-mono tabular-nums text-foreground font-bold">
                      {formatRWF(totalAmt)}
                    </TableCell>
                    <TableCell className="px-5 text-right">
                      <StatusBadge status={tx.status} />
                    </TableCell>
                    <TableCell className="px-5 text-right">
                      {tx.status === "completed" ? (
                        tx.isStocked ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft text-emerald-700 dark:text-success border border-success/20 px-2 py-0.5 text-[10px] font-semibold">
                            <CheckCircle2 className="h-3 w-3" />
                            In Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft text-amber-700 dark:text-warning border border-warning/20 px-2 py-0.5 text-[10px] font-semibold animate-pulse">
                            <AlertCircle className="h-3 w-3" />
                            Pending
                          </span>
                        )
                      ) : tx.status === "failed" && tx.statusMessage ? (
                        <span
                          className="text-[10px] text-destructive italic font-medium max-w-[120px] inline-block truncate"
                          title={tx.statusMessage}
                        >
                          {tx.statusMessage}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 text-right">
                      {tx.itemPhoto || (tx.products && tx.products.some(p => !!p.image)) ? (
                        <button
                          onClick={() => onViewPhoto(tx)}
                          className="inline-flex h-7 px-2.5 items-center gap-1 rounded bg-success-soft text-success text-xs font-semibold hover:bg-success/20 transition-colors cursor-pointer"
                        >
                          <FileText className="h-3.5 w-3.5" /> View Photo
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground italic">No Photo</span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 text-right">
                      {tx.receiptPhoto === "uploaded" ? (
                        <span className="inline-flex h-7 px-2.5 items-center gap-1 rounded bg-success-soft text-success text-xs font-semibold cursor-default">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Stored in Drive
                        </span>
                      ) : tx.receiptPhoto ? (
                        <button
                          onClick={() => onViewPhoto(tx)}
                          className="inline-flex h-7 px-2.5 items-center gap-1 rounded bg-success-soft text-success text-xs font-semibold hover:bg-success/20 transition-colors cursor-pointer"
                        >
                          <FileText className="h-3.5 w-3.5" /> View Receipt
                        </button>
                      ) : tx.status === "completed" ? (
                        role === "member" || tx.createdBy === currentUserName ? (
                          <label className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-md bg-highlight-soft text-highlight text-xs font-bold hover:bg-highlight/25 transition-colors cursor-pointer border border-highlight/20">
                            <Upload className="h-3 w-3" /> Upload Receipt
                            <input
                              type="file"
                              accept=".pdf,image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) onUploadReceipt(tx, file);
                              }}
                            />
                          </label>
                        ) : (
                          <span className="text-[11px] text-warning italic font-medium">Missing Receipt</span>
                        )
                      ) : (
                        <span className="text-[11px] text-muted-foreground italic">Pending Approval</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {visibleCount < transactions.length && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={onLoadMore}
                className="rounded-md border border-default-200 px-4 py-2 text-sm font-medium text-foreground hover:bg-default-100"
              >
                Load more ({transactions.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
});
