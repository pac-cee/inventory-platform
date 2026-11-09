import React, { useRef, useState } from "react";
import { Panel } from "@/components/dashboard/widgets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, Camera, Plus, X, Check, AlertTriangle } from "lucide-react";
import { formatRWF } from "./format";
import { resizeToDataUrl } from "@/lib/resize-image";
import type { CartItem, Transaction } from "./types";
import type { Location, StockLevel } from "@/lib/api/types";
import type { Role } from "@/lib/roles";

type FormState = {
  recipient: string;
  /** Who a BK phone payment is for (UrubutoPay needs a name with the number). */
  recipientName: string;
  productName: string;
  // Which catalog item is actually selected, independent of the display
  // text — two items can share a name (a different type or model is how
  // variants are modelled), so matching by name alone picks the wrong one
  // whenever a duplicate exists. Empty for a not-in-catalog custom product.
  productId: string;
  type: string;
  model: string;
  specification: string;
  quantity: number;
  price: string;
  locationId: string;
  paymentMethod: "momo" | "bk";
  bkPayToBankAccount: boolean;
  bankAccountNumber: string;
  bankAccountName: string;
  tinNumber: string;
  // Catalog metadata for a not-in-catalog product — only meaningful when
  // Quick Register creates a brand-new item, since transaction_products has
  // no columns to carry these on the payment record itself.
  category: string;
  finishable: boolean;
  countMode: "units" | "container" | "package";
  unitsPerContainer: string;
  containerLabel: string;
  packageLabel: string;
};

interface RequestFormProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  isCustomProduct: boolean;
  setIsCustomProduct: (v: boolean) => void;
  currentItemPhoto: string | null;
  setCurrentItemPhoto: (v: string | null) => void;
  formCameraStream: MediaStream | null;
  formVideoRef: React.RefObject<HTMLVideoElement | null>;
  localCatalog: { id?: string; name: string; description?: string | null; [key: string]: any }[];
  locations: Location[];
  stock: StockLevel[];
  categories: string[];
  role: Role;
  currentUserName: string;

  // parent-side side-effect setters / camera callbacks
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  setStatusMsg: (v: { type: "success" | "error"; text: string } | null) => void;
  setLocalCatalog: React.Dispatch<React.SetStateAction<{ id?: string; name: string; description?: string | null; [key: string]: any }[]>>;
  onStartFormCamera: () => void;
  onStopFormCamera: () => void;
  onCaptureFormPhoto: () => void;
  onRetakeFormPhoto: () => void;
  onViewPhoto?: (imageUrl: string, preferReceiptOrTitle?: boolean | string) => void;
}

// Memoized: a re-render of the parent (e.g. the 30s poll updating `transactions`)
// will NOT re-render this form unless `form`/`cart` actually change. This is the
// core P3 win — typing in the form only re-renders the form, never the ledger.
export const RequestForm = React.memo(function RequestForm({
  form,
  setForm,
  cart,
  setCart,
  isCustomProduct,
  setIsCustomProduct,
  currentItemPhoto,
  setCurrentItemPhoto,
  formCameraStream,
  formVideoRef,
  localCatalog,
  locations,
  stock,
  categories,
  role,
  currentUserName,

  setTransactions,
  setStatusMsg,
  setLocalCatalog,
  onStartFormCamera,
  onStopFormCamera,
  onCaptureFormPhoto,
  onRetakeFormPhoto,
  onViewPhoto,
}: RequestFormProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: name === "quantity" ? parseInt(value) || 0 : value }));
  };

  // Upload-from-disk alternative to the webcam capture below (Add Item
  // parity — same resize-in-browser helper, so a big phone photo never
  // crosses the wire at full size).
  const photoFileInput = useRef<HTMLInputElement>(null);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    setPhotoUploadError(null);
    try {
      const dataUrl = await resizeToDataUrl(file);
      setCurrentItemPhoto(dataUrl);
    } catch (err) {
      setPhotoUploadError(err instanceof Error ? err.message : "Could not read that file.");
    }
  };

  // Check if the currently entered product exists in catalog. A catalog
  // pick always has productId set (unambiguous); a custom-typed name that
  // happens to match an existing item's name is still worth flagging even
  // without an id, so the admin doesn't accidentally create a near-duplicate.
  const typedNameTrimmed = form.productName.trim().toLowerCase();
  const itemExistsInCatalog =
    !!form.productId || (!!typedNameTrimmed && localCatalog.some((c) => c.name.toLowerCase() === typedNameTrimmed));

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (form.paymentMethod === "momo" && !form.recipient.trim()) {
      setStatusMsg({ type: "error", text: "Recipient phone number is required before adding items." });
      return;
    }
    // BK covers two patterns: an employee's phone, or a vendor's bank
    // account (number, name and TIN together) — one of the two is required.
    if (form.paymentMethod === "bk") {
      const hasPhone = form.recipient.trim().length > 0;
      const hasBankAccount = form.bankAccountNumber.trim() && form.bankAccountName.trim() && form.tinNumber.trim();
      if (!hasPhone && !hasBankAccount) {
        setStatusMsg({ type: "error", text: "Enter a recipient phone, or a bank account number, account name and TIN, before adding items." });
        return;
      }
      if (hasPhone && !form.bkPayToBankAccount && !form.recipientName.trim()) {
        setStatusMsg({ type: "error", text: "Enter the recipient's name before adding items." });
        return;
      }
    }
    if (!form.productName.trim()) {
      setStatusMsg({ type: "error", text: "Product name is required." });
      return;
    }
    // A product that is not already in the catalog becomes a catalog item when
    // the purchase is approved, so it has to arrive with the same identity the
    // Add Item form demands: type + name + model. A catalog pick fills these in
    // for you. Specification stays optional here, as it is there.
    if (!itemExistsInCatalog) {
      if (!form.type.trim()) {
        setStatusMsg({ type: "error", text: "Item type is required for a product that is not in the catalog." });
        return;
      }
      if (!form.model.trim()) {
        setStatusMsg({ type: "error", text: "Model is required for a product that is not in the catalog." });
        return;
      }
    }
    if (!form.locationId) {
      setStatusMsg({ type: "error", text: "Please select a storage location for this item." });
      return;
    }
    const priceNum = parseFloat(form.price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setStatusMsg({ type: "error", text: "Please enter a valid price greater than 0." });
      return;
    }
    if (form.quantity <= 0) {
      setStatusMsg({ type: "error", text: "Quantity must be at least 1." });
      return;
    }
    if (!currentItemPhoto) {
      setStatusMsg({ type: "error", text: "Please capture a photo of the item you are buying." });
      return;
    }

    const newItem: CartItem = {
      name: form.productName.trim(),
      type: form.type.trim(),
      model: form.model.trim(),
      specification: form.specification.trim(),
      quantity: form.quantity,
      price: priceNum,
      locationId: form.locationId,
      image: currentItemPhoto,
    };

    setCart((prev) => [...prev, newItem]);
    setForm((prev) => ({
      ...prev,
      productName: "",
      productId: "",
      type: "",
      model: "",
      specification: "",
      quantity: 1,
      price: "",
      locationId: "",
      category: "",
      finishable: false,
      countMode: "units",
      unitsPerContainer: "1",
      containerLabel: "",
      packageLabel: "package",
      bankAccountNumber: prev.bankAccountNumber,
      bankAccountName: prev.bankAccountName,
      tinNumber: prev.tinNumber,
    }));
    setCurrentItemPhoto(null);
    onStopFormCamera();
    setStatusMsg({ type: "success", text: `"${newItem.name}" successfully added to cart request.` });
  };

  const handleQuickRegister = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!form.productName.trim()) return;
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.productName.trim(),
          type: form.type.trim() || form.productName.trim(),
          model: form.model.trim() || "Unspecified",
          specification: form.specification.trim() || null,
          category: form.category.trim() || null,
          finishable: form.finishable,
          units_per_container: form.countMode === "container" ? parseInt(form.unitsPerContainer) || 1 : undefined,
          package_label: form.countMode === "package" ? form.packageLabel.trim() || "package" : null,
        }),
      });
      if (res.ok) {
        const newItem = await res.json();
        setLocalCatalog((prev) => [...prev, newItem]);
        setStatusMsg({
          type: "success",
          text: `Item "${newItem.name}" has been registered in the catalog system.`,
        });
      } else {
        const errData = await res.json();
        setStatusMsg({ type: "error", text: errData.error || "Failed to register item in catalog." });
      }
    } catch {
      setStatusMsg({ type: "error", text: "Failed to connect to item registry." });
    }
  };

  const handleSubmitCart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) {
      setStatusMsg({ type: "error", text: "Your cart is empty. Add at least one item before submitting." });
      return;
    }
    if (form.paymentMethod === "momo" && !form.recipient.trim()) {
      setStatusMsg({ type: "error", text: "Recipient phone number is required." });
      return;
    }
    const hasPhone = form.recipient.trim().length > 0;
    const hasBankAccount = !!(form.bankAccountNumber.trim() && form.bankAccountName.trim() && form.tinNumber.trim());
    if (form.paymentMethod === "bk" && !hasPhone && !hasBankAccount) {
      setStatusMsg({ type: "error", text: "Enter a recipient phone, or a bank account number, account name and TIN." });
      return;
    }
    if (form.paymentMethod === "bk" && hasPhone && !hasBankAccount && !form.recipientName.trim()) {
      setStatusMsg({ type: "error", text: "Enter the recipient's name." });
      return;
    }
    const primaryLocationId = cart[0]?.locationId;
    if (!primaryLocationId) {
      setStatusMsg({ type: "error", text: "Each cart item must have a storage location." });
      return;
    }
    const selectedLoc = locations.find((l) => l.id === primaryLocationId);
    const locationName = selectedLoc ? selectedLoc.name : "";

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: hasPhone ? form.recipient.trim() : undefined,
          recipientName: form.paymentMethod === "bk" && hasPhone && form.recipientName.trim() ? form.recipientName.trim() : undefined,
          locationId: primaryLocationId,
          locationName,
          createdBy: currentUserName,
          products: cart,
          imageName: cart[0]?.image || null,
          paymentMethod: form.paymentMethod,
          payment_metadata: hasBankAccount ? {
            bankAccountNumber: form.bankAccountNumber.trim(),
            bankAccountName: form.bankAccountName.trim(),
            tinNumber: form.tinNumber.trim()
          } : undefined
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTransactions((prev) => [data.transaction, ...prev]);
        setCart([]);
        setForm({
          recipient: "",
          recipientName: "",
          productName: "",
          productId: "",
          type: "",
          model: "",
          specification: "",
          quantity: 1,
          price: "",
          locationId: "",
          paymentMethod: "momo",
          bkPayToBankAccount: false,
          bankAccountNumber: "",
          bankAccountName: "",
          tinNumber: "",
          category: "",
          finishable: false,
          countMode: "units",
          unitsPerContainer: "1",
          containerLabel: "",
          packageLabel: "package",
        });
        setStatusMsg({ type: "success", text: "Cart request submitted successfully for approval!" });
      } else {
        const errData = await res.json();
        let errorMsg = errData.error || "Failed to submit request.";
        if (errData.details && errData.details.fieldErrors) {
          errorMsg += " " + JSON.stringify(errData.details.fieldErrors);
        }
        setStatusMsg({ type: "error", text: errorMsg });
      }
    } catch {
      setStatusMsg({ type: "error", text: "Could not connect to the API server." });
    }
  };


  const [showProductSuggestions, setShowProductSuggestions] = useState(false);
  const productQuery = form.productName.trim().toLowerCase();
  const productSuggestions = productQuery
    ? localCatalog.filter(
        (c) =>
          c.name.toLowerCase().includes(productQuery) ||
          (c.type ?? "").toLowerCase().includes(productQuery) ||
          (c.model ?? "").toLowerCase().includes(productQuery) ||
          (c.sku ?? "").toLowerCase().includes(productQuery),
      )
    : localCatalog;

  function pickCatalogProduct(item: { id?: string; name: string; description?: string | null; [key: string]: any }) {
    let autoLocationId = "";
    if (item.id) {
      const stockEntries = stock.filter((s) => s.item_id === item.id);
      if (stockEntries.length > 0) {
        const best = stockEntries.reduce((a, b) => (a.quantity >= b.quantity ? a : b));
        autoLocationId = best.location_id;
      }
    }
    setForm((prev) => ({
      ...prev,
      productName: item.name,
      productId: item.id || "",
      locationId: autoLocationId,
    }));
    setShowProductSuggestions(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Add Item Form (Left Column) */}
      <div className="lg:col-span-2">
        <Panel title="Assemble Expense Request">
          <form onSubmit={handleSubmitCart} className="space-y-4 p-5">
            {/* Row 1: Destination (dynamic based on payment method) */}
            {form.paymentMethod === "momo" || !form.bkPayToBankAccount ? (
              <div className="space-y-2">
                <Label htmlFor="recipient">
                  {form.paymentMethod === "momo" ? "Recipient Phone / Code" : "Recipient Phone (Employee)"}
                  {cart.length > 0 && <span className="text-xs text-highlight ml-2">(Locked)</span>}
                </Label>
                <Input
                  id="recipient"
                  name="recipient"
                  required
                  disabled={cart.length > 0}
                  placeholder="e.g. +250 788 123 456"
                  value={form.recipient}
                  onChange={handleChange}
                />
                {form.paymentMethod === "bk" && (
                  <>
                    <Label htmlFor="recipientName" className="mt-2 block">
                      Recipient Name
                      {cart.length > 0 && <span className="text-xs text-highlight ml-2">(Locked)</span>}
                    </Label>
                    <Input
                      id="recipientName"
                      name="recipientName"
                      required
                      maxLength={100}
                      disabled={cart.length > 0}
                      placeholder="Name on the mobile-money account"
                      value={form.recipientName}
                      onChange={handleChange}
                    />
                  </>
                )}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 bg-card/40 p-4 rounded-lg border border-border/40">
                <div className="space-y-2">
                  <Label htmlFor="bankAccountNumber">Bank Account Number {cart.length > 0 && <span className="text-xs text-highlight">(Locked)</span>}</Label>
                  <Input id="bankAccountNumber" name="bankAccountNumber" required disabled={cart.length > 0} placeholder="e.g. 0004123456789" value={form.bankAccountNumber} onChange={handleChange} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bankAccountName">Account Name {cart.length > 0 && <span className="text-xs text-highlight">(Locked)</span>}</Label>
                  <Input id="bankAccountName" name="bankAccountName" required disabled={cart.length > 0} placeholder="e.g. John Doe" value={form.bankAccountName} onChange={handleChange} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tinNumber">TIN Number {cart.length > 0 && <span className="text-xs text-highlight">(Locked)</span>}</Label>
                  <Input id="tinNumber" name="tinNumber" required disabled={cart.length > 0} placeholder="e.g. 101234567" value={form.tinNumber} onChange={handleChange} />
                </div>
              </div>
            )}
            {/* BK covers both a common case (pay the employee's phone) and a
                rarer one (pay a vendor's own bank account) — this toggle
                switches which fields are shown, phone by default. */}
            {form.paymentMethod === "bk" && (
              <button
                type="button"
                disabled={cart.length > 0}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    bkPayToBankAccount: !prev.bkPayToBankAccount,
                    recipient: !prev.bkPayToBankAccount ? "" : prev.recipient,
                    recipientName: !prev.bkPayToBankAccount ? "" : prev.recipientName,
                    bankAccountNumber: !prev.bkPayToBankAccount ? prev.bankAccountNumber : "",
                    bankAccountName: !prev.bkPayToBankAccount ? prev.bankAccountName : "",
                    tinNumber: !prev.bkPayToBankAccount ? prev.tinNumber : "",
                  }))
                }
                className="text-xs text-highlight hover:underline cursor-pointer disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
              >
                {form.bkPayToBankAccount ? "Pay an employee's phone instead?" : "Paying a vendor's bank account instead?"}
              </button>
            )}

            {/* Payment Method */}
            <div className="space-y-2">
              <Label htmlFor="paymentMethod">
                Payment Method
                {cart.length > 0 && <span className="text-xs text-highlight ml-2">(Locked)</span>}
              </Label>
              <select
                id="paymentMethod"
                name="paymentMethod"
                required
                disabled={cart.length > 0}
                value={form.paymentMethod}
                onChange={handleChange}
                className="flex h-10 w-full rounded-md border border-input bg-card/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-highlight disabled:opacity-50"
              >
                <option value="momo">MTN Mobile Money</option>
                <option value="bk">Bank of Kigali</option>
              </select>
            </div>

            {/* Row 2: Product Name (with catalog dropdown/custom toggle) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="productName">Product Name</Label>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    id="isCustomProduct"
                    checked={isCustomProduct}
                    onChange={(e) => {
                      setIsCustomProduct(e.target.checked);
                      setForm((prev) => ({
                        ...prev,
                        productName: "",
                        productId: "",
                        locationId: "",
                        category: "",
                        finishable: false,
                        countMode: "units",
                      }));
                    }}
                    className="rounded border-border text-highlight focus:ring-highlight"
                  />
                  <Label htmlFor="isCustomProduct" className="cursor-pointer font-normal">
                    Not in catalog
                  </Label>
                </div>
              </div>
              {!isCustomProduct ? (
                <div className="relative">
                  <Input
                    id="productName"
                    name="productName"
                    placeholder="Search a registered product by name or SKU..."
                    autoComplete="off"
                    value={form.productName}
                    onChange={(e) => {
                      // Typing invalidates any previous exact selection —
                      // productId is only set again once a suggestion is
                      // clicked, so a stale id can never be submitted for
                      // text that no longer matches it.
                      setForm((prev) => ({ ...prev, productName: e.target.value, productId: "", locationId: "" }));
                      setShowProductSuggestions(true);
                    }}
                    onFocus={() => setShowProductSuggestions(true)}
                    // Delay so a click on a suggestion registers before the
                    // list unmounts (a plain blur would close it first).
                    onBlur={() => setTimeout(() => setShowProductSuggestions(false), 150)}
                  />
                  {showProductSuggestions && (
                    <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
                      {productSuggestions.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">No matching catalog items.</div>
                      ) : (
                        productSuggestions.map((item, idx) => (
                          <button
                            type="button"
                            key={item.id || idx}
                            onClick={() => pickCatalogProduct(item)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-hover cursor-pointer"
                          >
                            <span className="text-foreground">{item.type ?? item.name}</span>
                            {item.sku && <span className="text-xs text-muted-foreground font-mono">{item.sku}</span>}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                // Off-catalog: the name is entered with the rest of the item's
                // details below, so there is exactly one field for it.
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  {form.productName.trim()
                    ? `New item: ${form.productName.trim()}`
                    : "Enter the item's details under “New catalog item details” below."}
                </p>
              )}
            </div>

            <div className="border-t border-border/40 my-4 pt-4" />

            {/* Cart Item Input Section */}
            <div className="space-y-3 bg-surface/20 p-4 rounded-lg border border-border/40">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Item Details</h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="locationId">Storage Location</Label>
                  <select
                    id="locationId"
                    name="locationId"
                    required
                    value={form.locationId}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-card/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-highlight"
                  >
                    <option value="" disabled>Select a location...</option>
                    {locations
                      .filter((loc) => {
                        if (!form.productId || isCustomProduct) return true;
                        const itemStockEntries = stock.filter((s) => s.item_id === form.productId);
                        if (itemStockEntries.length === 0) return true;
                        return itemStockEntries.some((s) => s.location_id === loc.id);
                      })
                      .map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                  </select>
                  {!isCustomProduct && form.productId && (() => {
                    const itemStockEntries = stock.filter((s) => s.item_id === form.productId);
                    if (itemStockEntries.length === 0) {
                      return (
                        <p className="text-xs text-warning">No current stock recorded for this item — pick a location manually.</p>
                      );
                    }
                    if (form.locationId) {
                      const best = itemStockEntries.reduce((a, b) => (a.quantity >= b.quantity ? a : b));
                      const bestLoc = locations.find((l) => l.id === best.location_id);
                      if (bestLoc && best.location_id === form.locationId) {
                        return (
                          <p className="text-xs text-success">
                            Auto-selected: {bestLoc.name} — {best.quantity} in stock
                          </p>
                        );
                      }
                    }
                    return null;
                  })()}
                </div>
              </div>

              {/* Catalog Stock Warning / Registry Button */}
              {form.productName.trim() !== "" && (
                <div className="flex items-center justify-between text-xs p-2.5 rounded border bg-card/60">
                  {itemExistsInCatalog ? (
                    <span className="text-success flex items-center gap-1 font-medium">
                      <Check className="h-3.5 w-3.5" /> Item verified in catalog stock.
                    </span>
                  ) : (
                    <>
                      <span className="text-warning flex items-center gap-1 font-medium">
                        <AlertTriangle className="h-3.5 w-3.5" /> Not found in catalog registry.
                      </span>
                      {role === "admin" ? (
                        <button
                          type="button"
                          onClick={handleQuickRegister}
                          className="px-2 py-1 rounded bg-highlight text-highlight-foreground text-[10px] font-semibold hover:bg-highlight/95 transition-colors cursor-pointer"
                        >
                          Quick Register Item
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">
                          Will request registration on submission
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Catalog metadata for a genuinely new item — only relevant when
                  Quick Register will create one; an existing catalog item
                  already has this on file. */}
              {isCustomProduct && (
                <div className="space-y-3 bg-card/40 p-3 rounded-lg border border-border/40">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                    New catalog item details
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The same details Add Item asks for — this creates a real
                    catalog item when the purchase is approved.
                  </p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="type">Item type</Label>
                      <Input
                        id="type"
                        name="type"
                        placeholder="e.g. Cable"
                        value={form.type}
                        onChange={handleChange}
                      />
                      <p className="text-xs text-muted-foreground">
                        The kind of thing this is. The SKU is built from it.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="itemName">Name</Label>
                      {/* Bound to productName — the item's name and the name
                          carried on the purchase are the same thing. */}
                      <Input
                        id="itemName"
                        name="productName"
                        placeholder="e.g. Patch Lead 3m"
                        value={form.productName}
                        onChange={handleChange}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="model">Model</Label>
                      <Input
                        id="model"
                        name="model"
                        placeholder="e.g. CAT6-3M"
                        value={form.model}
                        onChange={handleChange}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>SKU</Label>
                      <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                        Assigned automatically
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="specification">Specification</Label>
                    <Input
                      id="specification"
                      name="specification"
                      placeholder="e.g. HP · 16GB RAM · 512GB SSD"
                      value={form.specification}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Input
                      id="category"
                      name="category"
                      list="request-category-options"
                      placeholder="e.g. Computer Laptop, Cables"
                      value={form.category}
                      onChange={handleChange}
                    />
                    <datalist id="request-category-options">
                      {categories.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>

                  <label htmlFor="finishable" className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      id="finishable"
                      type="checkbox"
                      className="h-4 w-4 rounded border-border accent-highlight"
                      checked={form.finishable}
                      onChange={(e) => setForm((prev) => ({ ...prev, finishable: e.target.checked }))}
                    />
                    Finishable — users can permanently use this item up
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="countMode">Counted as</Label>
                      <select
                        id="countMode"
                        name="countMode"
                        value={form.countMode}
                        onChange={handleChange}
                        className="flex h-10 w-full rounded-md border border-input bg-card/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-highlight"
                      >
                        <option value="units">Individual units</option>
                        <option value="container">Containers (track units inside)</option>
                        <option value="package">Packages (don&apos;t count contents)</option>
                      </select>
                    </div>
                    {form.countMode === "container" && (
                      <div className="space-y-2">
                        <Label htmlFor="unitsPerContainer">Units per container</Label>
                        <Input
                          id="unitsPerContainer"
                          name="unitsPerContainer"
                          type="number"
                          min={1}
                          value={form.unitsPerContainer}
                          onChange={handleChange}
                        />
                      </div>
                    )}
                    {form.countMode === "package" && (
                      <div className="space-y-2">
                        <Label htmlFor="packageLabel">Package label</Label>
                        <Input
                          id="packageLabel"
                          name="packageLabel"
                          placeholder="e.g. package, crate, reel"
                          value={form.packageLabel}
                          onChange={handleChange}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={handleChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Unit Price (RWF)</Label>
                  <Input
                    id="price"
                    name="price"
                    type="number"
                    min={1}
                    placeholder="e.g. 15000"
                    value={form.price}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {/* Item Photo Upfront Capture (webcam or upload-from-disk) */}
              <div className="space-y-2 pt-2">
                <Label className="flex items-center gap-1.5">
                  <Camera className="h-4 w-4 text-muted-foreground" />
                  Purchased Item Photo <span className="text-highlight">*</span>
                </Label>
                <input
                  ref={photoFileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoFileChange}
                />
                <div className="relative aspect-video w-full rounded-lg overflow-hidden border border-border bg-black/40 flex items-center justify-center">
                  {!currentItemPhoto ? (
                    !formCameraStream ? (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground p-6 text-center">
                        <Camera className="h-8 w-8 opacity-40 mb-1" />
                        <p className="text-xs">Take a photo of the item you bought before adding it to the cart.</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={onStartFormCamera}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-highlight text-highlight-foreground text-xs font-semibold hover:bg-highlight/95 transition-colors cursor-pointer"
                          >
                            Turn on Camera
                          </button>
                          <button
                            type="button"
                            onClick={() => photoFileInput.current?.click()}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-surface border border-border text-xs font-semibold hover:bg-hover transition-colors cursor-pointer"
                          >
                            Upload a file
                          </button>
                        </div>
                        {photoUploadError && (
                          <p className="text-xs text-destructive mt-1">{photoUploadError}</p>
                        )}
                      </div>
                    ) : (
                      <>
                        <video
                          ref={formVideoRef}
                          autoPlay
                          playsInline
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="border-2 border-dashed border-highlight/40 w-3/4 h-3/4 rounded-md" />
                        </div>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-2">
                          <button
                            type="button"
                            onClick={onCaptureFormPhoto}
                            className="px-3 py-1.5 rounded-md bg-highlight text-highlight-foreground text-xs font-bold hover:bg-highlight/90 shadow transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <Camera className="h-3.5 w-3.5" /> Capture Photo
                          </button>
                          <button
                            type="button"
                            onClick={onStopFormCamera}
                            className="px-3 py-1.5 rounded-md bg-surface border border-border text-xs font-semibold hover:bg-hover transition-colors text-foreground cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )
                  ) : (
                    <>
                      <img
                        src={currentItemPhoto}
                        alt="Captured item preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={onRetakeFormPhoto}
                        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-xs font-bold hover:bg-destructive/90 shadow transition-colors cursor-pointer"
                      >
                        Retake Photo
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleAddToCart}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-surface border border-border text-xs font-semibold text-foreground hover:bg-hover transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add to Request Cart
                </button>
              </div>
            </div>
          </form>
        </Panel>
      </div>

      {/* Request Cart Summary Pane (Right Column) */}
      <div className="lg:col-span-1">
        <Panel
          title="Request Cart"
          action={
            cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-destructive hover:underline cursor-pointer"
              >
                Clear All
              </button>
            )
          }
        >
          {cart.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Wallet className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Your request cart is empty.</p>
              <p className="text-xs mt-1">Fill out the form and click &quot;Add to Request Cart&quot; to assemble.</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="divide-y divide-border/40 max-h-[300px] overflow-y-auto pr-1">
                {cart.map((item, idx) => (
                  <div key={idx} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 pr-2 overflow-hidden">
                      {item.image && (
                        <button
                          type="button"
                          onClick={() => onViewPhoto && onViewPhoto(item.image!, item.name)}
                          className="w-10 h-10 object-cover rounded border border-border/80 shrink-0 cursor-pointer overflow-hidden hover:opacity-90 transition-opacity"
                        >
                          <img
                            src={item.image}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      )}
                      <div className="space-y-0.5 truncate">
                        <p className="font-semibold text-foreground truncate">{item.name}</p>
                        {/* The item's identity, so a cart line says which
                            variant was chosen rather than just its name. */}
                        {(item.type || item.model) && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {[item.type, item.model].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <p className="text-muted-foreground font-mono text-[10px]">
                          {item.quantity} × {formatRWF(item.price)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold font-mono text-foreground">
                        {formatRWF(item.price * item.quantity)}
                      </span>
                      <button
                        onClick={() => setCart((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-border/60 pt-3 flex flex-col gap-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Subtotal Items</span>
                  <span className="font-mono">{cart.length}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-foreground">
                  <span>Cumulative Total</span>
                  <span className="font-mono text-highlight">
                    {formatRWF(cart.reduce((sum, item) => sum + item.price * item.quantity, 0))}
                  </span>
                </div>
              </div>
              <div className="pt-4 mt-4 border-t border-border/40">
                <Button type="button" onClick={handleSubmitCart} className="w-full">
                  <Wallet className="h-4 w-4" />
                  Submit Expense Request ({cart.length} {cart.length === 1 ? "Item" : "Items"})
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
});
