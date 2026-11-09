"use client";

import { useRef, useState } from "react";
import { Upload, Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resizeToDataUrl } from "@/lib/resize-image";

type Mode = "upload" | "link";

/**
 * Choose a photo: upload a file, or paste a link. Used for items and for
 * locations — both store a picture the same way.
 *
 * Emits plain hidden inputs (`photo_data`, `photo_url`) so it drops into the
 * existing add/edit forms without changing how they submit. Only one is ever
 * filled — picking a file clears the link and vice versa, because the API
 * prefers an upload and a stale link underneath it would be invisible.
 *
 * The file is resized in the browser first, so a camera photo never crosses the
 * wire at full size.
 */
export function PhotoField({
  idPrefix,
  initialUrl = null,
  initialHasPhoto = false,
}: {
  idPrefix: string;
  initialUrl?: string | null;
  initialHasPhoto?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(initialUrl && !initialHasPhoto ? "link" : "upload");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [dataUrl, setDataUrl] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  // An item can already have an uploaded photo, and an upload beats a link in
  // the API. Choosing a link therefore has to say "drop the upload" — without
  // this the old file kept winning and the new link was invisible.
  const [dropUpload, setDropUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File) {
    setError(null);
    setBusy(true);
    try {
      const resized = await resizeToDataUrl(file);
      setDataUrl(resized);
      setPreview(resized);
      setDropUpload(false);
      setUrl(""); // an upload wins, so don't leave a link hiding under it
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  function clearUpload() {
    setDataUrl("");
    setPreview(null);
    // Also tell the server to drop whatever is already stored.
    setDropUpload(true);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="space-y-2">
      <Label>Photo</Label>

      <div className="flex gap-1 rounded-lg border border-line p-1 text-sm">
        {(["upload", "link"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              if (m === "link" && initialHasPhoto) setDropUpload(true);
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 ${
              mode === m ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "upload" ? <Upload className="size-3.5" /> : <Link2 className="size-3.5" />}
            {m === "upload" ? "Upload a file" : "Paste a link"}
          </button>
        ))}
      </div>

      {mode === "upload" ? (
        <div className="space-y-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
              // Reset so re-picking the same file still fires a change.
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="size-4" aria-hidden />
              {busy ? "Reading…" : dataUrl ? "Choose another" : "Choose a file"}
            </Button>
            {dataUrl ? (
              <Button type="button" variant="outline" size="sm" onClick={clearUpload}>
                <X className="size-4" aria-hidden />
                Clear
              </Button>
            ) : null}
            {!dataUrl && initialHasPhoto ? (
              <span className="text-xs text-muted-foreground">
                Keeping the current photo unless you choose a file.
              </span>
            ) : null}
          </div>
          {preview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={preview} alt="Selected photo" className="h-32 rounded-lg object-cover" />
          ) : null}
          <p className="text-xs text-muted-foreground">Resized before upload.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            id={`${idPrefix}-photo-url`}
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (e.target.value) clearUpload();
            }}
            onFocus={() => {
              // Switching to a link means the stored upload should go.
              if (initialHasPhoto) setDropUpload(true);
            }}
            placeholder="https://…/photo.jpg"
          />
          <p className="text-xs text-muted-foreground">
            Must point straight at an image file (ending .jpg, .png, .webp), not
            at a web page. Right-click an image and &ldquo;Copy image
            address&rdquo;. Some hosts block hotlinking — upload the file if a
            link will not load. An uploaded file takes priority over this.
          </p>
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {/* What the form submits. `photo_data` empty means "clear the stored
          upload"; absent means "leave whatever is there alone". */}
      <input type="hidden" name="photo_data" value={dataUrl} />
      <input type="hidden" name="photo_data_clear" value={dropUpload ? "1" : ""} />
      <input type="hidden" name="photo_url" value={url} />
    </div>
  );
}
