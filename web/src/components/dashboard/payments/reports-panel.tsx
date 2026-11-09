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
import { Check, AlertTriangle, FileText } from "lucide-react";
import { formatRWF } from "./format";
import { StatusBadge } from "./status-badge";
import type { Transaction, CartItem, Budget } from "./types";
import type { Role } from "@/lib/roles";

interface ReportsPanelProps {
  role: Role;
  userTxs: Transaction[];
  dailyCompleted: Transaction[];
  dailyTotal: number;
  monthlyCompleted: Transaction[];
  monthlyTotal: number;
  budget: Budget | null;
  isEditingBudget: boolean;
  setIsEditingBudget: (v: boolean) => void;
  newAllocation: string;
  setNewAllocation: (v: string) => void;
  isSavingBudget: boolean;
  onSaveBudget: () => void;
  localCatalog: { id?: string; name: string; description?: string | null; [key: string]: any }[];
}

// Memoized: re-renders only when its data props change (transactions-derived
// lists, budget). A form keystroke in RequestForm will NOT re-render this.
export const ReportsPanel = React.memo(function ReportsPanel({
  role,
  userTxs,
  dailyCompleted,
  dailyTotal,
  monthlyCompleted,
  monthlyTotal,
  budget,
  isEditingBudget,
  setIsEditingBudget,
  newAllocation,
  setNewAllocation,
  isSavingBudget,
  onSaveBudget,
  localCatalog,
}: ReportsPanelProps) {
  return (
    <div className="space-y-6">
      {/* Analytics Cards */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Panel title="Daily Completed Expenses">
          <div className="p-5 flex flex-col justify-center">
            <span className="text-3xl font-extrabold font-mono text-highlight tracking-tight">
              {formatRWF(dailyTotal)}
            </span>
            <span className="text-xs text-muted-foreground mt-1.5">
              Today&apos;s total for {dailyCompleted.length} completed disbursement request(s).
            </span>
          </div>
        </Panel>

        <Panel title="Monthly Completed Expenses">
          <div className="p-5 flex flex-col justify-center">
            <span className="text-3xl font-extrabold font-mono text-foreground tracking-tight">
              {formatRWF(monthlyTotal)}
            </span>
            <span className="text-xs text-muted-foreground mt-1.5 mb-4">
              This month&apos;s total for {monthlyCompleted.length} completed disbursement request(s).
            </span>
            <div className="mt-2">
              <a
                href="/api/payments/reports/export"
                download="corporate_expense_report.csv"
                className="inline-flex items-center gap-2 rounded-md bg-highlight text-highlight-foreground px-4 py-2 text-sm font-semibold hover:bg-highlight/90 transition-colors"
              >
                <FileText className="h-4 w-4" />
                Download CSV Report
              </a>
            </div>
          </div>
        </Panel>
      </div>

      {role === "admin" && (
        <Panel title="Monthly Budget Allocation">
          <div className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="font-serif text-base text-foreground font-medium">
                  Active Budget ({budget ? `${budget.month}/${budget.year}` : "Current Month"})
                </h3>
                <p className="text-xs text-muted-foreground font-normal">
                  Track and limit total corporate spending disbursements for this month.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isEditingBudget ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={newAllocation}
                      onChange={(e) => setNewAllocation(e.target.value)}
                      className="w-36 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder="Allocation (RWF)"
                    />
                    <button
                      onClick={onSaveBudget}
                      disabled={isSavingBudget}
                      className="inline-flex h-8 items-center justify-center rounded-md bg-highlight text-highlight-foreground px-3 text-xs font-semibold hover:bg-highlight/90 disabled:opacity-50 transition-colors"
                    >
                      {isSavingBudget ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setIsEditingBudget(false);
                        setNewAllocation(budget ? String(budget.allocated_amount) : "0");
                      }}
                      className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-hover transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsEditingBudget(true)}
                    className="inline-flex h-8 items-center justify-center rounded-md bg-highlight text-highlight-foreground px-3 text-xs font-semibold hover:bg-highlight/90 transition-colors"
                  >
                    Set Allocation
                  </button>
                )}
              </div>
            </div>

            {budget && budget.allocated_amount > 0 && (
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block font-medium">Allocated Limit</span>
                    <span className="font-mono text-base font-semibold text-foreground">
                      {formatRWF(budget.allocated_amount)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground block font-medium">Remaining Balance</span>
                    <span className="font-mono text-base font-semibold text-highlight">
                      {formatRWF(budget.remaining_amount)}
                    </span>
                  </div>
                </div>

                <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2 border border-border">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      ((budget.allocated_amount - budget.remaining_amount) / budget.allocated_amount * 100) > 85
                        ? "bg-destructive"
                        : ((budget.allocated_amount - budget.remaining_amount) / budget.allocated_amount * 100) > 60
                          ? "bg-warning"
                          : "bg-success"
                    }`}
                    style={{
                      width: `${Math.min(100, ((budget.allocated_amount - budget.remaining_amount) / budget.allocated_amount * 100))}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                  <span>
                    {((budget.allocated_amount - budget.remaining_amount) / budget.allocated_amount * 100).toFixed(0)}% utilized
                  </span>
                  <span>{formatRWF(budget.allocated_amount - budget.remaining_amount)} spent</span>
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Stock Registry Verification Tracker */}
      <Panel title="My Request Stock Registry Checklist">
        <div className="p-2">
          {userTxs.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No transaction requests found to evaluate.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5">Product Name</TableHead>
                  <TableHead className="px-5">Tx Date</TableHead>
                  <TableHead className="px-5">Tx Status</TableHead>
                  <TableHead className="px-5 text-right">Stock Registry Verification</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userTxs.map((tx) => {
                  const subItems: CartItem[] = tx.products || [
                    { name: tx.productName, quantity: tx.quantity } as CartItem,
                  ];
                  return subItems.map((prod, pIdx) => {
                    const isInStockCatalog = localCatalog.some(
                      (c) => c.name.toLowerCase() === prod.name.toLowerCase()
                    );
                    return (
                      <TableRow key={`${tx.id}-${pIdx}`}>
                        <TableCell className="px-5 font-semibold text-foreground">
                          {prod.name}
                        </TableCell>
                        <TableCell className="px-5 text-xs text-muted-foreground">
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="px-5">
                          <StatusBadge status={tx.status} />
                        </TableCell>
                        <TableCell className="px-5 text-right">
                          {isInStockCatalog ? (
                            <span className="inline-flex items-center gap-1 text-xs text-success font-medium bg-success-soft border border-success/15 px-2.5 py-0.5 rounded-full">
                              <Check className="h-3 w-3" /> Recorded in Catalog Stock
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-warning font-medium bg-warning-soft border border-warning/15 px-2.5 py-0.5 rounded-full">
                              <AlertTriangle className="h-3 w-3" /> Pending Catalog Recording
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  });
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </Panel>
    </div>
  );
});
