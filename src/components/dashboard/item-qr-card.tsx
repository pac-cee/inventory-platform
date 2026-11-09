"use client";

import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Item QR code with a download button — available to everyone (admins and
 * members). The encoded value matches the mobile app (`inventory:item:<id>`) so
 * a code printed from either client scans the same in both.
 */
export function ItemQrCard({
  itemId,
  sku,
  name,
}: {
  itemId: string;
  sku: string | null;
  name: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const value = `inventory:item:${itemId}`;

  function download() {
    const canvas = wrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    const safe = (sku || name || itemId).replace(/[^a-zA-Z0-9_-]+/g, "-");
    a.download = `qr-${safe}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="flex flex-col items-center gap-4 px-5 py-6">
      <div ref={wrapRef} className="rounded-lg bg-white p-3">
        <QRCodeCanvas value={value} size={180} marginSize={2} />
      </div>
      <p className="text-center text-xs text-muted-foreground">Scan to open this item in the app.</p>
      <Button type="button" variant="outline" onClick={download}>
        <Download className="h-4 w-4" />
        Download QR
      </Button>
    </div>
  );
}
