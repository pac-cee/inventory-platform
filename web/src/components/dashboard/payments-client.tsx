"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Camera, CheckCircle2, AlertCircle, Check } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Location, StockLevel } from "@/lib/api/types";

import { RequestForm } from "./payments/request-form";
import { ReportsPanel } from "./payments/reports-panel";
import { HistoryTable } from "./payments/history-table";
import { StatusBadge } from "./payments/status-badge";
import { formatRWF } from "./payments/format";
import type { Transaction, CartItem, Budget } from "./payments/types";
import type { Role } from "@/lib/roles";

interface PaymentsClientProps {
  currentUserName: string;
  role: Role;
  locations: Location[];
  items: { id?: string; name: string; description?: string | null; [key: string]: any }[];
  stock: StockLevel[];
  categories: string[];
}

export function PaymentsClient({ currentUserName, role, locations, items, stock, categories }: PaymentsClientProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // P1(perf): window the history table DOM — only mount `visibleCount` rows,
  // "Load more" appends. Keeps the DOM bounded as transactions grow.
  const [visibleCount, setVisibleCount] = useState(50);
  const [activeTab, setActiveTab] = useState<"request" | "reports" | "history">("request");

  // Form and Cart states
  const [cart, setCart] = useState<CartItem[]>([]);
  const [form, setForm] = useState({
    recipient: "",
    productName: "",
    // Which catalog item is selected, independent of the display text — see
    // request-form.tsx's FormState comment for why (duplicate item names).
    productId: "",
    type: "",
    model: "",
    specification: "",
    quantity: 1,
    price: "",
    locationId: "",
    paymentMethod: "momo" as "momo" | "bk",
    // BK covers two patterns: paying an employee's phone (default, uses
    // `recipient` above) or a vendor's bank account (this toggle reveals
    // the three fields below instead).
    bkPayToBankAccount: false,
    bankAccountNumber: "",
    bankAccountName: "",
    tinNumber: "",
    recipientName: "",
    // Catalog metadata for Quick Register on a not-in-catalog product.
    category: "",
    finishable: false,
    countMode: "units" as "units" | "container" | "package",
    unitsPerContainer: "1",
    containerLabel: "",
    packageLabel: "package",
  });

  const [localCatalog, setLocalCatalog] = useState<{ id?: string; name: string; description?: string | null; [key: string]: any }[]>(items || []);

  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [isCustomProduct, setIsCustomProduct] = useState(false);

  // Budget management states
  const [budget, setBudget] = useState<Budget | null>(null);
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const [newAllocation, setNewAllocation] = useState("0");

  const fetchBudget = async () => {
    try {
      const res = await fetch("/api/payments/budget");
      if (res.ok) {
        const data = await res.json();
        setBudget(data);
        setNewAllocation(String(data.allocated_amount));
      }
    } catch (error) {
      console.log("Failed to load monthly budget info", error);
    }
  };

  const handleSaveBudget = useCallback(async () => {
    setIsSavingBudget(true);
    try {
      const res = await fetch("/api/payments/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocated_amount: parseFloat(newAllocation) || 0 }),
      });
      if (res.ok) {
        const data = await res.json();
        setBudget(data);
        setIsEditingBudget(false);
        setStatusMsg({ type: "success", text: "Monthly budget allocation updated successfully!" });
      } else {
        setStatusMsg({ type: "error", text: "Failed to update allocated budget" });
      }
    } catch (error) {
      console.error(error);
      setStatusMsg({ type: "error", text: "Error saving budget" });
    } finally {
      setIsSavingBudget(false);
    }
  }, [newAllocation]);

  // Form webcam capture states
  const [currentItemPhoto, setCurrentItemPhoto] = useState<string | null>(null);
  const [formCameraStream, setFormCameraStream] = useState<MediaStream | null>(null);
  const formVideoRef = useRef<HTMLVideoElement | null>(null);

  // Zoomable Image viewer states
  const [viewingPhotoBase64, setViewingPhotoBase64] = useState<string | null>(null);
  const [viewingPhotoTx, setViewingPhotoTx] = useState<Transaction | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleUploadReceipt = useCallback(async (tx: Transaction, file: File) => {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/payments/transactions/${tx.id}/receipt`, {
        method: "PATCH",
        body: formData,
      });
      if (res.ok) {
        setTransactions((prev) =>
          prev.map((t) => (t.id === tx.id ? { ...t, receiptPhoto: "uploaded" } : t))
        );
        setStatusMsg({ type: "success", text: "Receipt successfully uploaded to Google Drive!" });
      } else {
        setStatusMsg({ type: "error", text: "Failed to upload receipt." });
      }
    } catch {
      setStatusMsg({ type: "error", text: "Connection error during receipt upload." });
    }
  }, []);



  // Clean up camera streams on unmount
  useEffect(() => {
    return () => {
      if (formCameraStream) formCameraStream.getTracks().forEach((track) => track.stop());
    };
  }, [formCameraStream]);

  // --- Form camera handlers (stable identity so RequestForm memo holds) ---
  const startFormCamera = useCallback(async () => {
    setCurrentItemPhoto(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setFormCameraStream(stream);
      setTimeout(() => {
        if (formVideoRef.current) formVideoRef.current.srcObject = stream;
      }, 100);
    } catch (err) {
      console.error("Form camera access error:", err);
      setStatusMsg({ type: "error", text: "Could not access the camera. Please allow camera permissions." });
    }
  }, []);

  const stopFormCamera = useCallback(() => {
    if (formCameraStream) {
      formCameraStream.getTracks().forEach((track) => track.stop());
      setFormCameraStream(null);
    }
  }, [formCameraStream]);

  const handleCaptureFormPhoto = useCallback(() => {
    if (formVideoRef.current) {
      const video = formVideoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        setCurrentItemPhoto(dataUrl);
        if (formCameraStream) {
          formCameraStream.getTracks().forEach((track) => track.stop());
          setFormCameraStream(null);
        }
      }
    }
  }, [formCameraStream]);

  const handleRetakeFormPhoto = useCallback(() => {
    setCurrentItemPhoto(null);
    startFormCamera();
  }, [startFormCamera]);

  // Fetch transactions and poll every 30 seconds for updates (guarded)
  useEffect(() => {
    let inFlight = false;
    const fetchTransactions = async () => {
      if (inFlight || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
      inFlight = true;
      try {
        const res = await fetch("/api/payments");
        if (res.ok) {
          const data = await res.json();
          setTransactions(data);
        }
      } catch (e) {
        console.error("Failed to load transactions", e);
      } finally {
        inFlight = false;
      }
    };

    // Same guard as the transactions fetch: a hidden tab or a request still in
    // flight must not stack up budget calls.
    let budgetInFlight = false;
    const fetchBudgetGuarded = async () => {
      if (budgetInFlight || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
      budgetInFlight = true;
      try {
        await fetchBudget();
      } finally {
        budgetInFlight = false;
      }
    };

    const tick = () => {
      fetchTransactions();
      if (role === "admin") fetchBudgetGuarded();
    };

    tick();
    const interval = setInterval(tick, 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchTransactions();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [role]);

  // Reports calculations — memoized (P1b)
  const userTxs = useMemo(
    () => transactions.filter((t) => t.createdBy === currentUserName),
    [transactions, currentUserName]
  );
  const reportTxs = role === "admin" ? transactions : userTxs;

  const todayStr = new Date().toDateString();
  const dailyCompleted = useMemo(
    () => reportTxs.filter((t) => t.status === "completed" && new Date(t.createdAt).toDateString() === todayStr),
    [reportTxs, todayStr]
  );
  const dailyTotal = dailyCompleted.reduce((sum, t) => sum + (t.price || 0), 0);

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthlyCompleted = useMemo(
    () =>
      reportTxs.filter((t) => {
        const d = new Date(t.createdAt);
        return t.status === "completed" && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      }),
    [reportTxs, currentMonth, currentYear]
  );
  const monthlyTotal = monthlyCompleted.reduce((sum, t) => sum + (t.price || 0), 0);

  // --- Stable callbacks for memoized children ---
  const onViewPhoto = useCallback((txOrUrl: Transaction | string, preferReceiptOrTitle?: boolean | string) => {
    if (typeof txOrUrl === "string") {
      setViewingPhotoBase64(txOrUrl);
      setViewingPhotoTx(null); // Just a generic image, not a full tx
    } else {
      if (preferReceiptOrTitle === true && txOrUrl.receiptPhoto) {
        setViewingPhotoBase64(txOrUrl.receiptPhoto);
      } else {
        const firstProductImage = txOrUrl.products?.find(p => p.image)?.image;
        setViewingPhotoBase64(txOrUrl.itemPhoto || firstProductImage || txOrUrl.receiptPhoto || null);
      }
      setViewingPhotoTx(txOrUrl);
    }
  }, []);

  const onLoadMore = useCallback(() => setVisibleCount((c) => c + 50), []);

  // Zoom controllers (Admin modal viewer)
  const handleZoomIn = () => setZoomScale((prev) => Math.min(prev + 0.25, 4));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(prev - 0.25, 0.5));
  const handleZoomReset = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomScale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPanOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };
  const handleMouseUpOrLeave = () => setIsDragging(false);

  return (
    <div className="space-y-6">
      {/* TAB Navigation */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("request")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-[2px] transition-colors cursor-pointer ${
            activeTab === "request" ? "border-highlight text-highlight" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Request Expense
        </button>
        <button
          onClick={() => setActiveTab("reports")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-[2px] transition-colors cursor-pointer ${
            activeTab === "reports" ? "border-highlight text-highlight" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {role === "admin" ? "Org Expense Reports" : "My Expense Reports"}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-[2px] transition-colors cursor-pointer ${
            activeTab === "history" ? "border-highlight text-highlight" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Transaction History ({transactions.length})
        </button>
      </div>

      <Dialog open={!!statusMsg} onOpenChange={(open) => !open && setStatusMsg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {statusMsg?.type === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive" />
              )}
              {statusMsg?.type === "success" ? "Success" : "Error"}
            </DialogTitle>
            <DialogDescription>{statusMsg?.text}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* TAB 1: Request Expense */}
      {activeTab === "request" && (
        <RequestForm
          form={form}
          setForm={setForm}
          cart={cart}
          setCart={setCart}
          isCustomProduct={isCustomProduct}
          setIsCustomProduct={setIsCustomProduct}
          currentItemPhoto={currentItemPhoto}
          setCurrentItemPhoto={setCurrentItemPhoto}
          formCameraStream={formCameraStream}
          formVideoRef={formVideoRef}
          localCatalog={localCatalog}
          locations={locations}
          stock={stock}
          categories={categories}
          role={role}
          currentUserName={currentUserName}
          setTransactions={setTransactions}
          setStatusMsg={setStatusMsg}
          setLocalCatalog={setLocalCatalog}
          onStartFormCamera={startFormCamera}
          onStopFormCamera={stopFormCamera}
          onCaptureFormPhoto={handleCaptureFormPhoto}
          onRetakeFormPhoto={handleRetakeFormPhoto}
          onViewPhoto={onViewPhoto}
        />
      )}

      {/* TAB 2: User Targeted Reports */}
      {activeTab === "reports" && (
        <ReportsPanel
          role={role}
          userTxs={userTxs}
          dailyCompleted={dailyCompleted}
          dailyTotal={dailyTotal}
          monthlyCompleted={monthlyCompleted}
          monthlyTotal={monthlyTotal}
          budget={budget}
          isEditingBudget={isEditingBudget}
          setIsEditingBudget={setIsEditingBudget}
          newAllocation={newAllocation}
          setNewAllocation={setNewAllocation}
          isSavingBudget={isSavingBudget}
          onSaveBudget={handleSaveBudget}
          localCatalog={localCatalog}
        />
      )}

      {/* TAB 3: Transaction History */}
      {activeTab === "history" && (
        <HistoryTable
          transactions={transactions}
          visibleCount={visibleCount}
          onLoadMore={onLoadMore}
          role={role}
          currentUserName={currentUserName}
          onViewPhoto={onViewPhoto}
          onUploadReceipt={handleUploadReceipt}
        />
      )}



      {/* Zoomable Purchased Item / Receipt Photo Viewer Modal (Admin) */}
      <Dialog
        open={!!viewingPhotoBase64}
        onOpenChange={(open) => {
          if (!open) {
            setViewingPhotoBase64(null);
            setViewingPhotoTx(null);
            handleZoomReset();
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-serif font-bold text-foreground">
              {viewingPhotoTx && viewingPhotoBase64 === viewingPhotoTx.receiptPhoto
                ? "Verify Receipt Photo"
                : "Verify Purchased Item Photo"}
            </DialogTitle>
            {viewingPhotoTx && (
              <DialogDescription className="text-[10px] text-muted-foreground font-mono">
                Tx: {viewingPhotoTx.id} | Buyer: {viewingPhotoTx.createdBy}
              </DialogDescription>
            )}
          </DialogHeader>

          {(() => {
            const isReceipt = viewingPhotoTx && viewingPhotoBase64 === viewingPhotoTx.receiptPhoto;
            const productsWithImages = (!isReceipt && viewingPhotoTx?.products?.filter((p) => !!p.image)) || [];
            return (
              <div className="flex flex-col gap-4 py-2">
                <div
                  className="relative flex items-center justify-center h-[380px] bg-black/95 overflow-hidden select-none cursor-grab active:cursor-grabbing rounded-lg border border-border"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUpOrLeave}
                  onMouseLeave={handleMouseUpOrLeave}
                >
                  <img
                    src={viewingPhotoBase64 || undefined}
                    alt="Transaction Attachment"
                    style={{
                      transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${panOffset.y / zoomScale}px)`,
                      transition: isDragging ? "none" : "transform 0.15s ease-out",
                    }}
                    className="max-h-full max-w-full object-contain pointer-events-none"
                  />
                </div>

                {productsWithImages.length > 1 && (
                  <div className="flex gap-2 justify-center overflow-x-auto py-1 border-t border-border/40 pt-3">
                    {productsWithImages.map((p, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          if (p.image) {
                            setViewingPhotoBase64(p.image);
                            handleZoomReset();
                          }
                        }}
                        className={`relative w-12 h-12 rounded border-2 overflow-hidden shrink-0 transition-colors cursor-pointer ${
                          viewingPhotoBase64 === p.image ? "border-highlight" : "border-border/40 hover:border-border"
                        }`}
                        title={p.name}
                      >
                        <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-border/60 pt-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleZoomOut}
                      className="px-2.5 py-1 text-xs bg-surface border border-border hover:bg-hover rounded font-semibold text-foreground cursor-pointer"
                    >
                      Zoom -
                    </button>
                    <button
                      type="button"
                      onClick={handleZoomIn}
                      className="px-2.5 py-1 text-xs bg-surface border border-border hover:bg-hover rounded font-semibold text-foreground cursor-pointer"
                    >
                      Zoom +
                    </button>
                    <button
                      type="button"
                      onClick={handleZoomReset}
                      className="px-2.5 py-1 text-xs bg-surface border border-border hover:bg-hover rounded font-semibold text-foreground cursor-pointer"
                    >
                      Reset Zoom
                    </button>
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground font-semibold">
                    Scale: {Math.round(zoomScale * 100)}%
                  </span>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
