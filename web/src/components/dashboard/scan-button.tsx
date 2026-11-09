"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";
import type { Html5Qrcode } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { parseBoxQr } from "@/lib/box-qr";

const PREFIX = "inventory:item:";

/** Accept our prefixed payload or a bare item id; null for anything else. */
function parseItemQr(raw: string): string | null {
  const v = raw.trim();
  if (v.startsWith(PREFIX)) {
    const id = v.slice(PREFIX.length).trim();
    return id || null;
  }
  if (/^[0-9a-fA-F-]{32,40}$/.test(v)) return v;
  return null;
}

/**
 * QR scanner for the web app (mirrors the mobile scanner). Reads an item QR and
 * opens that item. Available to everyone — admins and members.
 */
export function ScanButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    handledRef.current = false;
    setError(null);

    let scanner: Html5Qrcode | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        scanner = new Html5Qrcode("qr-reader");
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (handledRef.current) return;
            const id = parseItemQr(decodedText);
            if (id) {
              handledRef.current = true;
              setOpen(false);
              router.push(`/items/${id}`);
              return;
            }
            // A box sticker: look the code up and open the box.
            const token = parseBoxQr(decodedText);
            if (token) {
              handledRef.current = true;
              fetch(`/api/boxes/${token}`)
                .then(async (res) => {
                  const body = await res.json().catch(() => null);
                  if (!res.ok) throw new Error(body?.error ?? "Could not look up that box.");
                  setOpen(false);
                  router.push(`/locations/${body.location.id}`);
                })
                .catch((e: Error) => {
                  // Say what happened and let them scan again.
                  setError(e.message);
                  handledRef.current = false;
                });
            }
          },
          () => {
            /* per-frame decode misses are normal; ignore */
          },
        );
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't start the camera.");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (scanner?.isScanning) {
        scanner
          .stop()
          .then(() => scanner?.clear())
          .catch(() => {});
      }
    };
  }, [open, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Scan item QR"
        title="Scan item QR"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <QrCode className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan item QR</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            <div id="qr-reader" className="overflow-hidden rounded-lg [&_video]:rounded-lg" />
            {error ? (
              <p className="mt-3 rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">
                {error} Allow camera access, or use a device that has a camera.
              </p>
            ) : (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Point your camera at an item&apos;s QR code.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
