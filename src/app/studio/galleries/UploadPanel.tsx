"use client";

import { useRef, useState } from "react";
import { Camera, RotateCw, CheckCircle2, XCircle, Check } from "lucide-react";
import { authFetch } from "@/lib/authClient";

interface FileStatus {
  file: File;
  // An in-memory snapshot of the file's bytes, taken the instant the file is
  // picked. The raw <input> File is a *reference* to an OS file handle; once we
  // clear the input (`e.target.value = ""`, needed so re-picking the same file
  // re-fires onChange) Chromium can release that handle, and the later async
  // PUT then fails with `net::ERR_BLOB_REFERENCED_FILE_UNAVAILABLE` before any
  // bytes go over the wire. Reading the bytes into a detached Blob up front
  // makes the upload body self-contained and immune to the input reset.
  blob: Blob;
  contentType: string;
  filename: string;
  key: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

interface Props {
  galleryId: string;
  onUploaded: () => void;
  // Optional: called when the user taps "Done" to close out an upload session.
  onDone?: () => void;
}

// Phone-first "Add photos" capture flow. A plain <input type=file accept=
// image/* multiple> surfaces the OS photo picker (and the phone camera roll
// populated by Canon Camera Connect) — no custom camera code needed. Files
// upload SEQUENTIALLY (one at a time) so a single request stays small and
// resilient on spotty mobile connections; failures are retried individually
// without losing the rest of the batch.
export default function UploadPanel({ galleryId, onUploaded, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<FileStatus[]>([]);
  const [uploading, setUploading] = useState(false);
  const [forSale, setForSale] = useState(false);
  const [priceDollars, setPriceDollars] = useState("");

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Snapshot each picked file's bytes into a detached in-memory Blob BEFORE
    // the caller clears the <input> (which can invalidate the File's backing
    // OS handle mid-upload). arrayBuffer() forces the bytes to be read now,
    // while the handle is guaranteed live; the resulting Blob is what we PUT.
    const next: FileStatus[] = await Promise.all(
      Array.from(files).map(async (file) => {
        const bytes = await file.arrayBuffer();
        const contentType = file.type || "image/jpeg";
        return {
          file,
          blob: new Blob([bytes], { type: contentType }),
          contentType,
          filename: file.name || "photo.jpg",
          key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          status: "pending" as const,
        };
      }),
    );
    setQueue((prev) => [...prev, ...next]);
    // Auto-start the upload as soon as photos are picked — one less tap.
    void runQueue(next);
  };

  // Three-step upload:
  //   1. POST /signed-url         → { uploadUrl, imageId }
  //   2. PUT uploadUrl (direct)   → Supabase Storage (no Vercel 4.5 MB cap)
  //   3. POST /finalize           → kicks off sharp watermarking + DB row
  //
  // Previously step 2 was a POST straight to the Next.js route with the
  // file in a multipart FormData body — that hit Vercel's HARD 4.5 MB
  // serverless function body limit (not configurable), so any real phone
  // photo returned 413 before reaching the route.
  async function uploadOne(item: FileStatus): Promise<boolean> {
    const markError = (msg: string) =>
      setQueue((prev) =>
        prev.map((q) =>
          q.key === item.key ? { ...q, status: "error", error: msg } : q,
        ),
      );

    setQueue((prev) =>
      prev.map((q) =>
        q.key === item.key
          ? { ...q, status: "uploading", error: undefined }
          : q,
      ),
    );

    try {
      // Step 1 — mint a signed upload URL scoped to this gallery.
      const signedRes = await authFetch(
        `/api/studio/gallery/${galleryId}/images/signed-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: item.filename,
            contentType: item.contentType,
          }),
        },
      );
      const signedBody = await signedRes.json().catch(() => ({}));
      if (!signedRes.ok || !signedBody?.uploadUrl || !signedBody?.imageId) {
        markError(
          signedBody?.error ??
            `Couldn't prepare upload (HTTP ${signedRes.status})`,
        );
        return false;
      }

      // Step 2 — PUT the byte snapshot DIRECTLY to Supabase Storage. This
      // bypasses Vercel entirely so the 4.5 MB body limit doesn't apply.
      // The signed URL is a JWT that only permits an upload to the exact
      // path returned in step 1.
      //
      // We PUT `item.blob` (the in-memory snapshot), NOT the raw input File:
      // the File is a live OS-handle reference that Chromium can invalidate
      // once the <input> is cleared, which produced
      // net::ERR_BLOB_REFERENCED_FILE_UNAVAILABLE and silently killed every
      // upload before it reached the server. Headers mirror the app's other
      // working signed-URL uploaders (avatar, reels): just Content-Type, no
      // x-upsert (upsert is encoded in the signed token, not this header, and
      // the custom header only widened the CORS preflight surface for nothing).
      const putRes = await fetch(signedBody.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": item.contentType },
        body: item.blob,
      });
      if (!putRes.ok) {
        const txt = await putRes.text().catch(() => "");
        markError(`Upload to storage failed (HTTP ${putRes.status}) ${txt}`);
        return false;
      }

      // Step 3 — tell the server the raw file is up so it can watermark,
      // upload the preview/thumb, and insert the DB row. Tiny request
      // body, no size concerns.
      const priceCents = Math.round(parseFloat(priceDollars || "0") * 100);
      const finalizeRes = await authFetch(
        `/api/studio/gallery/${galleryId}/images/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageId: signedBody.imageId,
            filename: item.filename,
            forSale:
              forSale && Number.isFinite(priceCents) && priceCents > 0,
            priceCents:
              forSale && Number.isFinite(priceCents) && priceCents > 0
                ? priceCents
                : null,
          }),
        },
      );
      const finalizeBody = await finalizeRes.json().catch(() => ({}));
      const ok = finalizeRes.ok && finalizeBody?.success;

      setQueue((prev) =>
        prev.map((q) =>
          q.key === item.key
            ? {
                ...q,
                status: ok ? "done" : "error",
                error: ok
                  ? undefined
                  : finalizeBody?.error ??
                    `Finalize failed (HTTP ${finalizeRes.status})`,
              }
            : q,
        ),
      );
      return Boolean(ok);
    } catch (err) {
      markError(err instanceof Error ? err.message : "Network error");
      return false;
    }
  }

  async function runQueue(items: FileStatus[]) {
    setUploading(true);
    let anySuccess = false;
    for (const item of items) {
      const ok = await uploadOne(item);
      if (ok) anySuccess = true;
    }
    setUploading(false);
    if (anySuccess) onUploaded();
  }

  const retryFailed = () => {
    const failed = queue.filter((q) => q.status === "error");
    if (failed.length === 0) return;
    void runQueue(failed);
  };

  const clearDone = () => {
    setQueue((prev) => prev.filter((q) => q.status !== "done"));
  };

  const pendingCount = queue.filter((q) => q.status !== "done").length;
  const failedCount = queue.filter((q) => q.status === "error").length;
  const doneCount = queue.filter((q) => q.status === "done").length;
  // The batch is "finished" when nothing is in flight and there's at least one
  // uploaded photo. Failed items don't block finishing — the user can retry
  // them or walk away; the successful ones are already saved.
  const canFinish = !uploading && doneCount > 0 && pendingCount === failedCount;

  const finish = () => {
    // Refresh the gallery grid, clear the finished queue, and hand control back
    // to the parent (e.g. scroll to the gallery / navigate away).
    onUploaded();
    setQueue((prev) => prev.filter((q) => q.status === "error"));
    onDone?.();
  };

  return (
    <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-5">
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3 py-1">
          <input
            type="checkbox"
            checked={forSale}
            onChange={(e) => setForSale(e.target.checked)}
            className="h-5 w-5 accent-[#ff5500]"
          />
          <span className="text-sm text-text-primary">
            Put these on sale
          </span>
        </label>

        {forSale && (
          <div className="flex items-center gap-2">
            <span className="text-text-secondary text-sm">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              placeholder="15.00"
              className="w-28 rounded-xl bg-brand-background border border-brand-border px-3 py-2 text-base text-text-primary focus:outline-none focus:border-brand-primary"
            />
            <span className="text-text-secondary text-xs">
              per photo, applied to this batch
            </span>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={async (e) => {
            const input = e.currentTarget;
            // Await the byte snapshot BEFORE resetting the input, so the File's
            // backing OS handle is still valid while we read it. Resetting
            // first (the old bug) could invalidate the blob mid-upload.
            await handleFilesSelected(input.files);
            input.value = "";
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-4 text-base font-semibold text-white w-full"
        >
          <Camera className="h-5 w-5" />
          Add photos
        </button>
        <p className="text-center text-xs text-text-secondary">
          Opens your photo library — pick shots from your camera roll.
        </p>
      </div>

      {queue.length > 0 && (
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {uploading
                ? `Uploading… ${queue.length - pendingCount}/${queue.length}`
                : failedCount > 0
                  ? `${failedCount} failed`
                  : "All uploaded"}
            </p>
            <div className="flex gap-2">
              {failedCount > 0 && !uploading && (
                <button
                  type="button"
                  onClick={retryFailed}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-primary"
                >
                  <RotateCw className="h-3.5 w-3.5" /> Retry failed
                </button>
              )}
              {!uploading && queue.some((q) => q.status === "done") && (
                <button
                  type="button"
                  onClick={clearDone}
                  className="text-xs font-semibold text-text-secondary hover:text-text-primary"
                >
                  Clear done
                </button>
              )}
            </div>
          </div>

          <ul className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
            {queue.map((item) => (
              <li
                key={item.key}
                className="flex items-center gap-2 rounded-lg bg-brand-background px-3 py-2 text-sm"
              >
                {item.status === "done" && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                )}
                {item.status === "error" && (
                  <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                )}
                {(item.status === "pending" || item.status === "uploading") && (
                  <span className="h-4 w-4 shrink-0 rounded-full border-2 border-brand-muted border-t-brand-primary animate-spin" />
                )}
                <span className="truncate flex-1 text-text-primary">{item.file.name}</span>
                {item.status === "error" && (
                  <span className="text-xs text-red-400 shrink-0">{item.error}</span>
                )}
              </li>
            ))}
          </ul>

          {canFinish && (
            <button
              type="button"
              onClick={finish}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              <Check className="h-5 w-5" />
              Done — {doneCount} photo{doneCount === 1 ? "" : "s"} added
            </button>
          )}
        </div>
      )}
    </div>
  );
}
