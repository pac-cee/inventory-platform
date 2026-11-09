"use client";

import React, { useState, useEffect, useRef } from "react";
import { Bell, FileText, CheckCircle2, XCircle, AlertCircle, Camera, X, Upload, Check } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/roles";

interface CartItem {
    name: string;
    description: string;
    quantity: number;
    price: number;
    image?: string;
}

interface Transaction {
    id: string;
    recipient: string;
    recipientName?: string;
    products?: CartItem[];
    productName: string;
    description: string;
    quantity: number;
    price: number;
    status: "pending" | "processing" | "completed" | "failed";
    imageName?: string;
    itemPhoto?: string;
    receiptPhoto?: string;
    createdBy: string;
    createdAt: string;
    paymentMethod?: "momo" | "bk";
    paymentMetadata?: any;
}

interface AdminNotificationsProps {
    role: Role;
    currentUserName: string;
}

/**
 * Fetch JSON, or null when the answer is not JSON.
 *
 * These poll on a timer. When the session expires the route redirects to
 * /login, and `fetch` follows it — so the login PAGE arrives as 200 with HTML,
 * `res.ok` is true, and `res.json()` throws `Unexpected token '<'` into the
 * console every 30 seconds. Checking the content type turns that into a quiet
 * "not signed in" instead of a parse error that hides the real cause.
 */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(url, init);
  if (!res.ok) return null;
  if (!res.headers.get("content-type")?.includes("application/json")) return null;
  return (await res.json()) as T;
}

export function AdminNotifications({ role, currentUserName }: AdminNotificationsProps) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
    const [balance, setBalance] = useState<{ availableBalance: string; currency: string } | null>(null);

    // Zoom controllers for admin photo viewer
    const [viewingPhotoBase64, setViewingPhotoBase64] = useState<string | null>(null);
    const [zoomScale, setZoomScale] = useState(1);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

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

    // When selecting a transaction, initialize the default viewing photo
    const handleSelectTx = (tx: Transaction) => {
        setSelectedTx(tx);
        const productsWithImages = tx.products?.filter(p => !!p.image) || [];
        if (productsWithImages.length > 0) {
            setViewingPhotoBase64(productsWithImages[0].image!);
        } else if (tx.imageName) {
            setViewingPhotoBase64(tx.imageName);
        } else {
            setViewingPhotoBase64(null);
        }
        handleZoomReset();
    };

    // States for inline receipt camera snap (for members)
    const [capturingReceiptTx, setCapturingReceiptTx] = useState<Transaction | null>(null);
    const [receiptPhotoBase64, setReceiptPhotoBase64] = useState<string | null>(null);
    const [receiptCameraStream, setReceiptCameraStream] = useState<MediaStream | null>(null);
    const receiptVideoRef = useRef<HTMLVideoElement | null>(null);

    // Fetch transactions from server and poll (guarded: skip if in-flight or tab hidden)
    useEffect(() => {
        let inFlight = false;
        const fetchTransactions = async () => {
            if (inFlight || typeof document !== "undefined" && document.visibilityState !== "visible") return;
            inFlight = true;
            try {
                const data = await fetchJson<typeof transactions>("/api/payments");
                if (data) setTransactions(data);
            } catch (e) {
                console.error("Failed to load transactions for notifications", e);
            } finally {
                inFlight = false;
                setLoading(false);
            }
        };

        fetchTransactions();
        const interval = setInterval(fetchTransactions, 30000);
        const onVisible = () => {
            if (document.visibilityState === "visible") fetchTransactions();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    // Fetch budget from server and poll every 30 seconds (admin only, guarded)
    useEffect(() => {
        if (role !== "admin") return;
        let inFlight = false;
        const fetchBalance = async () => {
            if (inFlight || typeof document !== "undefined" && document.visibilityState !== "visible") return;
            inFlight = true;
            try {
                const data = await fetchJson<{ remaining_amount?: number }>(
                    "/api/payments/budget",
                );
                if (data) {
                    setBalance({
                        availableBalance: String(data.remaining_amount || 0),
                        currency: "RWF",
                    });
                }
            } catch (e) {
                console.error("Failed to load budget for admin notifications", e);
            } finally {
                inFlight = false;
            }
        };

        fetchBalance();
        const interval = setInterval(fetchBalance, 30000);
        const onVisible = () => {
            if (document.visibilityState === "visible") fetchBalance();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [role]);

    // Start Camera for Receipt snap
    const startReceiptCamera = (tx: Transaction) => {
        setCapturingReceiptTx(tx);
        setReceiptPhotoBase64(null);
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
        }).then((stream) => {
            setReceiptCameraStream(stream);
            setTimeout(() => {
                if (receiptVideoRef.current) {
                    receiptVideoRef.current.srcObject = stream;
                }
            }, 100);
        }).catch((err) => {
            console.error("Camera access error:", err);
            alert("Could not access the camera. Please allow camera permissions.");
            setCapturingReceiptTx(null);
        });
    };

    // Close capture camera stream and reset states
    const closeReceiptCapture = () => {
        if (receiptCameraStream) {
            receiptCameraStream.getTracks().forEach((track) => track.stop());
            setReceiptCameraStream(null);
        }
        setCapturingReceiptTx(null);
        setReceiptPhotoBase64(null);
    };

    // Snap a photo of the receipt
    const handleCaptureReceipt = () => {
        if (receiptVideoRef.current) {
            const video = receiptVideoRef.current;
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
                setReceiptPhotoBase64(dataUrl);
                
                // Stop camera stream tracks while previewing
                if (receiptCameraStream) {
                    receiptCameraStream.getTracks().forEach((track) => track.stop());
                }
            }
        }
    };

    // Retake receipt photo
    const handleRetakeReceipt = () => {
        setReceiptPhotoBase64(null);
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
        }).then((stream) => {
            setReceiptCameraStream(stream);
            setTimeout(() => {
                if (receiptVideoRef.current) {
                    receiptVideoRef.current.srcObject = stream;
                }
            }, 100);
        }).catch((err) => {
            console.error("Camera access error on retake:", err);
            alert("Could not reactivate the camera.");
            closeReceiptCapture();
        });
    };

    // Submit Receipt Photo
    const handleSubmitReceipt = async () => {
        if (!capturingReceiptTx || !receiptPhotoBase64) return;

        try {
            // The endpoint is multer-based (multipart/form-data), not JSON —
            // convert the captured data URL to a file the same way the main
            // payments page's upload does.
            const blob = await (await fetch(receiptPhotoBase64)).blob();
            const formData = new FormData();
            formData.append("file", blob, "receipt.jpg");

            const res = await fetch(`/api/payments/transactions/${capturingReceiptTx.id}/receipt`, {
                method: "PATCH",
                body: formData,
            });

            if (res.ok) {
                // Update transaction state locally
                setTransactions((prev) =>
                    prev.map((t) => (t.id === capturingReceiptTx.id ? { ...t, receiptPhoto: receiptPhotoBase64 } : t))
                );
                alert("Receipt photo successfully uploaded!");
            } else {
                alert("Failed to upload receipt photo.");
            }
        } catch {
            alert("Connection error during receipt photo upload.");
        } finally {
            closeReceiptCapture();
        }
    };

    // Clean up camera stream on unmount
    useEffect(() => {
        return () => {
            if (receiptCameraStream) {
                receiptCameraStream.getTracks().forEach((track) => track.stop());
            }
        };
    }, [receiptCameraStream]);

    const pendingApproval = role === "admin"
        ? transactions.filter((tx) => tx.status === "pending")
        : [];

    const pendingReceipts = transactions.filter(
        (tx) => tx.status === "completed" && !tx.receiptPhoto && tx.createdBy === currentUserName
    );

    const notificationsCount = pendingApproval.length + pendingReceipts.length;

    const formatRWF = (amount: number) => {
        return new Intl.NumberFormat("en-RW", {
            style: "currency",
            currency: "RWF",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const handleResolve = async (txId: string, status: "approved" | "rejected") => {
        try {
            const res = await fetch("/api/payments/resolve", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    id: txId,
                    status,
                }),
            });

            if (res.ok) {
                // Show what the backend actually did. An approved BK transfer
                // may still be "processing" while the provider confirms it;
                // marking it completed here would misreport money in flight.
                const data = await res.json().catch(() => null);
                const outcome = data?.transaction?.outcome;
                const next: Transaction["status"] =
                    status === "rejected" ? "failed" : outcome === "processing" ? "processing" : "completed";
                setTransactions((prev) => prev.map((tx) => (tx.id === txId ? { ...tx, status: next } : tx)));
                setSelectedTx(null);
            } else {
                const data = await res.json().catch(() => null);
                console.error("Failed to resolve payment on server:", data);
                alert(data?.error || "Failed to resolve payment.");
                // Keep the dialog open on failure so the admin can see what they
                // were acting on and retry once the underlying issue is fixed
                // (e.g. allocate a monthly budget) instead of it silently vanishing.
            }
        } catch (e) {
            console.error("Failed to update transaction status", e);
            alert("Connection error while resolving payment.");
        }
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button className="relative flex h-9 w-9 items-center justify-center rounded-lg hover:bg-hover transition-colors outline-none text-muted-foreground hover:text-foreground focus-visible:ring-highlight/25 focus-visible:ring-[3px]">
                        <Bell className="h-5 w-5" />
                        {notificationsCount > 0 && (
                            <span className="absolute top-1.5 right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-highlight text-[9px] font-bold text-highlight-foreground">
                                {notificationsCount}
                            </span>
                        )}
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 max-h-[400px] overflow-y-auto p-2">
                    <DropdownMenuLabel className="px-2 py-1.5 font-serif text-[13px] text-foreground flex items-center justify-between">
                        <span>Payment Notifications</span>
                        {balance && (
                            <span className="text-[11px] font-mono text-highlight bg-highlight-soft px-2 py-0.5 rounded border border-highlight/15 font-semibold">
                                Bal: {formatRWF(parseFloat(balance.availableBalance))}
                            </span>
                        )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {loading && transactions.length === 0 ? (
                        <div className="flex flex-col gap-2 p-2">
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="flex items-center justify-between gap-2 rounded-lg p-2.5">
                                    <div className="h-3 w-32 animate-pulse rounded bg-hover" />
                                    <div className="h-3 w-10 animate-pulse rounded bg-hover" />
                                </div>
                            ))}
                        </div>
                    ) : notificationsCount === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                            <CheckCircle2 className="h-8 w-8 text-success-foreground/30 mb-2" />
                            <p className="text-[12px]">All payment requests resolved</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/20">
                            {/* Render Admin Pending Approvals */}
                            {pendingApproval.slice(0, 20).map((tx) => (
                                <DropdownMenuItem
                                    key={`approve-${tx.id}`}
                                    onSelect={() => handleSelectTx(tx)}
                                    className="flex flex-col items-start gap-1 p-2.5 cursor-pointer rounded-lg hover:bg-hover focus:bg-hover"
                                >
                                    <div className="flex w-full items-center justify-between">
                                        <span className="font-semibold text-foreground text-[12px] truncate max-w-[150px]">
                                            Approve: {tx.productName}
                                        </span>
                                        <span className="font-mono text-highlight text-[11px] font-medium">
                                            {formatRWF(tx.price)}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground truncate w-full">
                                        To: {tx.recipient} · {tx.products && tx.products.length > 0 ? `${tx.products.length} items` : `Qty: ${tx.quantity}`}
                                    </p>
                                    <span className="text-[10px] text-muted-foreground mt-0.5">
                                        {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </DropdownMenuItem>
                            ))}

                            {/* Render Member Pending Receipts */}
                            {pendingReceipts.slice(0, 20).map((tx) => (
                                <DropdownMenuItem
                                    key={`receipt-${tx.id}`}
                                    onSelect={() => startReceiptCamera(tx)}
                                    className="flex flex-col items-start gap-1 p-2.5 cursor-pointer rounded-lg hover:bg-hover focus:bg-hover border-l-2 border-highlight bg-highlight-soft/5"
                                >
                                    <div className="flex w-full items-center justify-between">
                                        <span className="font-semibold text-foreground text-[12px] truncate max-w-[150px]">
                                            Upload Receipt: {tx.productName}
                                        </span>
                                        <span className="font-mono text-highlight text-[11px] font-medium">
                                            {formatRWF(tx.price)}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground w-full whitespace-normal leading-normal">
                                        Approved for RWF {formatRWF(tx.price)}. Capture receipt photo to finalize transaction.
                                    </p>
                                    <span className="text-[10px] text-muted-foreground mt-0.5">
                                        {new Date(tx.createdAt).toLocaleDateString()}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </div>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Approval Details Modal Pop-up */}
            {selectedTx && (
                <Dialog open={!!selectedTx} onOpenChange={(open) => {
                    if (!open) {
                        setSelectedTx(null);
                        setViewingPhotoBase64(null);
                    }
                }}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <div className="flex items-center gap-2 mb-1">
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-highlight-soft text-highlight">
                                    <AlertCircle className="h-4 w-4" />
                                </div>
                                <DialogTitle className="text-lg font-semibold font-serif">
                                    Review Payment Request
                                </DialogTitle>
                            </div>
                            <DialogDescription className="text-xs">
                                A pending payment request has been submitted. Review details and approve {selectedTx.paymentMethod === "bk" ? "bank transfer" : "disbursement"}.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="mt-4 space-y-3.5 border-y border-border py-4 text-[13px]">
                            <div className="grid grid-cols-3 gap-2">
                                <span className="text-muted-foreground font-medium">Requested By:</span>
                                <span className="col-span-2 text-foreground font-semibold">
                                    {selectedTx.createdBy}
                                </span>
                            </div>
                            {selectedTx.paymentMethod === "bk" && selectedTx.paymentMetadata ? (
                                <div className="grid grid-cols-3 gap-2">
                                    <span className="text-muted-foreground font-medium flex items-center">Bank Details:</span>
                                    <span className="col-span-2 text-foreground font-mono flex flex-col gap-0.5 bg-surface/50 p-2 rounded">
                                        <span className="font-semibold text-[11px] uppercase">{selectedTx.paymentMetadata?.bankAccountName}</span>
                                        <span>ACC: {selectedTx.paymentMetadata?.bankAccountNumber}</span>
                                        <span className="text-muted-foreground">TIN: {selectedTx.paymentMetadata?.tinNumber}</span>
                                    </span>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-2">
                                    {selectedTx.recipientName ? (
                                        <>
                                            <span className="text-muted-foreground font-medium">Name:</span>
                                            <span className="col-span-2 text-foreground break-words">{selectedTx.recipientName}</span>
                                        </>
                                    ) : null}
                                    <span className="text-muted-foreground font-medium">Recipient:</span>
                                    <span className="col-span-2 text-foreground break-all select-all font-mono">
                                        {selectedTx.recipient}
                                    </span>
                                </div>
                            )}

                            {selectedTx.products && selectedTx.products.length > 0 ? (
                                <div className="col-span-3 mt-2 border border-border/60 rounded overflow-hidden">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-surface/50 text-muted-foreground font-medium">
                                            <tr>
                                                <th className="p-2">Item</th>
                                                <th className="p-2 text-right">Qty</th>
                                                <th className="p-2 text-right">Unit Price</th>
                                                <th className="p-2 text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/40">
                                            {selectedTx.products.map((p, idx) => (
                                                <tr key={idx}>
                                                    <td className="p-2 font-medium text-foreground">
                                                        {p.name}
                                                        {p.description && (
                                                            <div className="text-[10px] text-muted-foreground font-normal">
                                                                {p.description}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-2 text-right font-mono">{p.quantity}</td>
                                                    <td className="p-2 text-right font-mono">{formatRWF(p.price)}</td>
                                                    <td className="p-2 text-right font-mono font-medium text-foreground">{formatRWF(p.price * p.quantity)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-3 gap-2">
                                        <span className="text-muted-foreground font-medium">Product Name:</span>
                                        <span className="col-span-2 text-foreground font-semibold">
                                            {selectedTx.productName}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <span className="text-muted-foreground font-medium">Description:</span>
                                        <span className="col-span-2 text-foreground">
                                            {selectedTx.description || "—"}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <span className="text-muted-foreground font-medium">Quantity:</span>
                                        <span className="col-span-2 text-foreground font-mono">
                                            {selectedTx.quantity}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <span className="text-muted-foreground font-medium">Price (RWF):</span>
                                        <span className="col-span-2 text-foreground font-mono">
                                            {formatRWF(selectedTx.price)}
                                        </span>
                                    </div>
                                </>
                            )}

                            <div className="grid grid-cols-3 gap-2 border-t border-border/40 pt-3">
                                <span className="text-muted-foreground font-semibold">Total Amount:</span>
                                <span className="col-span-2 text-highlight font-mono font-bold text-[14px]">
                                    {formatRWF(selectedTx.price)}
                                </span>
                            </div>
                            {viewingPhotoBase64 && (
                                <div className="border-t border-border/40 pt-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground font-semibold text-xs">
                                            Purchased Item Photo:
                                        </span>
                                        <div className="flex gap-2">
                                            <Button type="button" variant="outline" size="sm" onClick={handleZoomOut} disabled={zoomScale <= 0.5} className="h-6 w-6 p-0 border-border bg-card/60 hover:bg-card">
                                                -
                                            </Button>
                                            <Button type="button" variant="outline" size="sm" onClick={handleZoomReset} className="h-6 px-2 text-[10px] border-border bg-card/60 hover:bg-card text-muted-foreground font-semibold">
                                                RESET
                                            </Button>
                                            <Button type="button" variant="outline" size="sm" onClick={handleZoomIn} disabled={zoomScale >= 4} className="h-6 w-6 p-0 border-border bg-card/60 hover:bg-card">
                                                +
                                            </Button>
                                        </div>
                                    </div>
                                    <div
                                        className="relative flex items-center justify-center h-[380px] bg-black/95 overflow-hidden select-none cursor-grab active:cursor-grabbing rounded-lg border border-border"
                                        onMouseDown={handleMouseDown}
                                        onMouseMove={handleMouseMove}
                                        onMouseUp={handleMouseUpOrLeave}
                                        onMouseLeave={handleMouseUpOrLeave}
                                    >
                                        <img
                                            src={viewingPhotoBase64}
                                            alt="Purchased Item"
                                            style={{
                                                transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${panOffset.y / zoomScale}px)`,
                                                transition: isDragging ? "none" : "transform 0.15s ease-out",
                                            }}
                                            className="max-h-full max-w-full object-contain pointer-events-none"
                                        />
                                    </div>

                                    {/* Thumbnails if multiple images exist */}
                                    {(() => {
                                        const productsWithImages = selectedTx.products?.filter(p => !!p.image) || [];
                                        if (productsWithImages.length > 1) {
                                            return (
                                                <div className="flex gap-2 justify-center overflow-x-auto py-1 pt-2">
                                                    {productsWithImages.map((p, idx) => (
                                                        <button
                                                            key={idx}
                                                            className={`w-16 h-16 rounded overflow-hidden border-2 transition-all ${
                                                                viewingPhotoBase64 === p.image ? 'border-primary ring-2 ring-primary/50 opacity-100' : 'border-transparent opacity-60 hover:opacity-100'
                                                            }`}
                                                            onClick={() => {
                                                                setViewingPhotoBase64(p.image!);
                                                                handleZoomReset();
                                                            }}
                                                        >
                                                            <img
                                                                src={p.image}
                                                                alt={p.name}
                                                                className="w-full h-full object-cover pointer-events-none bg-black"
                                                            />
                                                        </button>
                                                    ))}
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            )}
                        </div>

                        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-2">
                            <Button
                                variant="outline"
                                className="w-full sm:w-36 border-destructive/30 hover:bg-destructive/10 text-destructive transition-colors"
                                onClick={() => handleResolve(selectedTx.id, "rejected")}
                            >
                                <XCircle className="h-4 w-4" />
                                Reject
                            </Button>
                            <Button
                                className="w-full sm:w-36 transition-colors"
                                onClick={() => handleResolve(selectedTx.id, "approved")}
                            >
                                <CheckCircle2 className="h-4 w-4" />
                                Approve Payment
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
            {/* Member Receipt Webcam Capture Modal */}
            <Dialog open={!!capturingReceiptTx} onOpenChange={(open) => !open && closeReceiptCapture()}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-serif font-bold text-foreground">
                            Capture Purchase Receipt
                        </DialogTitle>
                        <DialogDescription className="text-[10px] text-muted-foreground">
                            Approved amount: <span className="font-semibold text-highlight font-mono">{capturingReceiptTx && formatRWF(capturingReceiptTx.price)}</span>
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="flex flex-col gap-4 py-2">
                        {/* Live Video Feed or Captured Preview */}
                        <div className="relative aspect-video rounded-lg overflow-hidden border border-border bg-black flex items-center justify-center">
                            {!receiptPhotoBase64 ? (
                                <>
                                    <video
                                        ref={receiptVideoRef}
                                        autoPlay
                                        playsInline
                                        className="w-full h-full object-cover"
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <div className="border-2 border-dashed border-highlight/40 w-3/4 h-3/4 rounded-md" />
                                    </div>
                                </>
                            ) : (
                                <img
                                    src={receiptPhotoBase64}
                                    alt="Receipt Preview"
                                    className="w-full h-full object-cover"
                                />
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 pt-2">
                            {!receiptPhotoBase64 ? (
                                <>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex-1"
                                        onClick={closeReceiptCapture}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="button"
                                        className="flex-1 bg-highlight hover:bg-highlight/90 text-highlight-foreground"
                                        onClick={handleCaptureReceipt}
                                    >
                                        <Camera className="h-4 w-4" /> Capture Photo
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex-1 border-destructive/20 hover:bg-destructive/10 text-destructive"
                                        onClick={handleRetakeReceipt}
                                    >
                                        Retake Photo
                                    </Button>
                                    <Button
                                        type="button"
                                        className="flex-1 bg-success hover:bg-success/90 text-success-foreground"
                                        onClick={handleSubmitReceipt}
                                    >
                                        <Check className="h-4 w-4" /> Submit Receipt
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
