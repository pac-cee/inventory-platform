"use client";

import React, { useState, useEffect } from "react";
import { BarChart3, Calendar, CheckCircle2, AlertCircle, ShoppingBag, X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/api/types";

interface Transaction {
  id: string;
  recipient: string;
  productName: string;
  description: string;
  quantity: number;
  price: number;
  status: "pending" | "processing" | "completed" | "failed";
  imageName?: string;
  receiptImage?: string;
  isStocked: boolean;
  createdBy: string;
  createdAt: string;
}

interface UserReportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  profile: Profile;
}

export function UserReportDialog({ isOpen, onClose, profile }: UserReportDialogProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const fetchUserTransactions = async () => {
        setIsLoading(true);
        try {
          const res = await fetch(`/api/payments?userId=${profile.id}`);
          if (res.ok) {
            const data = await res.json();
            setTransactions(data);
          }
        } catch (e) {
          console.error("Failed to load user transactions", e);
        } finally {
          setIsLoading(false);
        }
      };

      fetchUserTransactions();
    }
  }, [isOpen, profile.id]);

  const formatRWF = (amount: number) => {
    return new Intl.NumberFormat("en-RW", {
      style: "currency",
      currency: "RWF",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const completedTxs = transactions.filter((t) => t.status === "completed");

  // Daily spend calculation
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dailySpent = completedTxs
    .filter((t) => new Date(t.createdAt) >= startOfToday)
    .reduce((sum, t) => sum + t.price, 0);

  // Monthly spend calculation
  const startOfThisMonth = new Date();
  startOfThisMonth.setDate(1);
  startOfThisMonth.setHours(0, 0, 0, 0);
  const monthlySpent = completedTxs
    .filter((t) => new Date(t.createdAt) >= startOfThisMonth)
    .reduce((sum, t) => sum + t.price, 0);

  // Lifetime spend
  const lifetimeSpent = completedTxs.reduce((sum, t) => sum + t.price, 0);

  // Percentages
  const dailyPercent = (profile.daily_limit ?? 0) > 0 ? (dailySpent / profile.daily_limit!) * 100 : 0;
  const monthlyPercent = (profile.monthly_limit ?? 0) > 0 ? (monthlySpent / profile.monthly_limit!) * 100 : 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-6">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-highlight-soft text-highlight">
              <BarChart3 className="h-4.5 w-4.5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-serif font-semibold text-foreground">
                Spending Report: {profile.full_name || "Employee"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Audit individual spending limits and inventory reception status.
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Overview & Limit Gauges */}
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          {/* Daily Limit Gauge */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground uppercase tracking-wider">Daily Spending</span>
              <span className="font-mono font-medium text-foreground">
                {formatRWF(dailySpent)} / {(profile.daily_limit ?? 0) > 0 ? formatRWF(profile.daily_limit!) : "No Limit"}
              </span>
            </div>
            {(profile.daily_limit ?? 0) > 0 ? (
              <>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2 border border-border">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      dailyPercent > 85
                        ? "bg-destructive"
                        : dailyPercent > 60
                        ? "bg-warning"
                        : "bg-success"
                    }`}
                    style={{ width: `${Math.min(100, dailyPercent)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{dailyPercent.toFixed(0)}% utilized</span>
                  <span>{formatRWF(Math.max(0, profile.daily_limit! - dailySpent))} remaining</span>
                </div>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground italic">No daily limit cap is set for this user.</p>
            )}
          </div>

          {/* Monthly Limit Gauge */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground uppercase tracking-wider">Monthly Spending</span>
              <span className="font-mono font-medium text-foreground">
                {formatRWF(monthlySpent)} / {(profile.monthly_limit ?? 0) > 0 ? formatRWF(profile.monthly_limit!) : "No Limit"}
              </span>
            </div>
            {(profile.monthly_limit ?? 0) > 0 ? (
              <>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2 border border-border">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      monthlyPercent > 85
                        ? "bg-destructive"
                        : monthlyPercent > 60
                        ? "bg-warning"
                        : "bg-success"
                    }`}
                    style={{ width: `${Math.min(100, monthlyPercent)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{monthlyPercent.toFixed(0)}% utilized</span>
                  <span>{formatRWF(Math.max(0, profile.monthly_limit! - monthlySpent))} remaining</span>
                </div>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground italic">No monthly limit cap is set for this user.</p>
            )}
          </div>
        </div>

        {/* Personal limits overview */}
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-surface/30 p-3.5 text-xs text-muted-foreground border border-border/40 mt-2">
          <div>
            Single-Tx Limit: <span className="font-mono font-semibold text-foreground">{(profile.per_transaction_limit ?? 0) > 0 ? formatRWF(profile.per_transaction_limit!) : "No Cap"}</span>
          </div>
          <div className="text-right">
            Lifetime Spending: <span className="font-mono font-semibold text-highlight">{formatRWF(lifetimeSpent)}</span>
          </div>
        </div>

        {/* Transaction History & Stock Checklist */}
        <div className="mt-5 space-y-3">
          <h3 className="font-serif text-sm font-semibold text-foreground flex items-center gap-1.5 border-b border-border/60 pb-1.5">
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
            Stock Reception Checklist
          </h3>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-highlight" />
              <span className="text-xs">Loading transaction logs...</span>
            </div>
          ) : completedTxs.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8 italic border border-dashed border-border rounded-lg bg-surface/5">
              No completed transactions recorded for this employee.
            </p>
          ) : (
            <div className="space-y-2.5">
              {completedTxs.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-card/40 p-3 hover:bg-card/75 transition-colors text-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground truncate">{t.productName}</span>
                      <span className="font-mono text-muted-foreground">x{t.quantity}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      To: {t.recipient} · On: {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono font-semibold text-foreground">
                      {formatRWF(t.price)}
                    </span>
                    
                    {t.isStocked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft text-emerald-700 dark:text-success border border-success/20 px-2 py-0.5 text-[10px] font-semibold">
                        <CheckCircle2 className="h-3 w-3" />
                        In Stock
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft text-amber-700 dark:text-warning border border-warning/20 px-2 py-0.5 text-[10px] font-semibold animate-pulse">
                        <AlertCircle className="h-3 w-3" />
                        Pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>
            Close Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
