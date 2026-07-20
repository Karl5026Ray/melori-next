"use client";

import { useRef, useState } from "react";
import { Camera, RotateCw, CheckCircle2, XCircle } from "lucide-react";
import { authFetch, authHeaders } from "@/lib/authClient";

interface FileStatus {
  file: File;
  key: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

interface Props {
  galleryId: string;
  onUploaded: () => void;
}

// Phone-first "Add photos" capture flow. A plain <input type=file accept=
// image/* multiple> surfaces the OS photo picker (and the phone camera roll
// populated by Canon Camera Connect) — no custom camera code needed. Files
// upload SEQUENTIALLY (one at a time) so a single request stays small and
// resilient on spotty mobile connections; failures are retried individually
// without losing the rest of the batch.
export default function UploadPanel({ galleryId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<FileStatus[]>([]);
  const [uploading, setUploading] = useState(false);
  const [forSale, setForSale] = useState(false);
  const [priceDollars, setPriceDollars] = useState("");

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: FileStatus[] = Array.from(files).map((file) => ({
      file,
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      status: "pending",
    }));
    setQueue((prev) => [...prev, ...next]);
    // Auto-start the upload as soon as photos are picked — one less tap.
    void runQueue(next);
  };

  async function uploadOne(item: FileStatus): Promise<boolean> {
    setQueue((prev) =>
      prev.map((q) => (q.key === item.key ? { ...q, status: "uploading", error: undefined } : q)),
    );

    try {
      const form = new FormData();
      form.append("files", item.file, item.file.name);
      const priceCents = Math.round(parseFloat(priceDollars || "0") * 100);
      if (forSale && Number.isFinite(priceCents) && priceCents > 0) {
        form.append("forSale", "true");
        form.append("priceCents", String(priceCents));
      }

      const headers = await authHeaders();
      const res = await fetch(`/api/studio/gallery/${galleryId}/images`, {
        method: "POST",
        headers,
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      const result = body?.results?.[0];
      const ok = res.ok && result?.success;

      setQueue((prev) =>
        prev.map((q) =>
          q.key === item.key
            ? {
                ...q,
                status: ok ? "done" : "error",
                error: ok ? undefined : result?.error ?? body?.error ?? "Upload failed",
              }
            : q,
        ),
      );
      return Boolean(ok);
    } catch (err) {
      setQueue((prev) =>
        prev.map((q) =>
          q.key === item.key
            ? {
                ...q,
                status: "error",
                error: err instanceof Error ? err.message : "Network error",
              }
            : q,
        ),
      );
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
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            e.target.value = "";
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
        </div>
      )}
    </div>
  );
}
