"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  FolderPlus,
  RotateCw,
  CheckCircle2,
  XCircle,
  UploadCloud,
} from "lucide-react";
import { authFetch } from "@/lib/authClient";

interface FileStatus {
  file: File;
  key: string;
  /**
   * Folder path root-first for this file. e.g. Shoot/Bride/Prep/img.jpg
   * would be ["Bride", "Prep"] (the top-level folder the user dropped is
   * elided as the batch container; see extractFolderPath below).
   * Empty array = top-level in the gallery.
   */
  folderPath: string[];
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

interface Props {
  galleryId: string;
  onUploaded: () => void;
}

// Studio upload panel. Accepts three input modes:
//
//   1. "Add photos" button   → flat photo picker (unchanged, phone-first).
//   2. "Add folder" button   → OS folder picker (webkitdirectory).
//      Every File carries webkitRelativePath = "Shoot/Bride/Prep/img.jpg"
//      which we split to derive the folderPath.
//   3. Drag-and-drop         → both files and folders. Folder drops walk
//      the DataTransfer items tree via webkitGetAsEntry to preserve depth.
//
// All modes converge on the same queue of FileStatus rows, each carrying
// its own folderPath. The three-step signed-URL upload happens once per
// file and the server creates missing folder rows on the fly.
export default function UploadPanel({ galleryId, onUploaded }: Props) {
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<FileStatus[]>([]);
  const [uploading, setUploading] = useState(false);
  const [forSale, setForSale] = useState(false);
  const [priceDollars, setPriceDollars] = useState("");
  const [dragActive, setDragActive] = useState(false);

  // Attach webkitdirectory to the folder <input> imperatively — React
  // doesn't recognize the attribute as a first-class prop and typing it
  // in JSX triggers TS errors. useEffect runs once on mount.
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  function enqueue(items: Omit<FileStatus, "key" | "status">[]) {
    if (items.length === 0) return;
    const next: FileStatus[] = items.map((it) => ({
      ...it,
      key: `${it.file.name}-${it.file.size}-${it.file.lastModified}-${Math.random().toString(36).slice(2)}`,
      status: "pending",
    }));
    setQueue((prev) => [...prev, ...next]);
    void runQueue(next);
  }

  // Split webkitRelativePath into a folder path array. We drop the top-most
  // segment because the user picked ONE folder as the batch — treating
  // that outer wrapper as a gallery folder would create an extra parent
  // level no one asked for. Example: "Shoot/Bride/Prep/img.jpg" with
  // top-level "Shoot" → path ["Bride", "Prep"].
  function extractFolderPath(relativePath: string): string[] {
    if (!relativePath) return [];
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length <= 2) return []; // "Shoot/img.jpg" → root
    return parts.slice(1, -1); // drop wrapper + filename
  }

  const handleFilePickerFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items = Array.from(files).map((file) => ({
      file,
      folderPath: [],
    }));
    enqueue(items);
  };

  const handleFolderPickerFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items = Array.from(files)
      .filter((f) => (f.type || "").startsWith("image/") ||
                     /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(f.name))
      .map((file) => ({
        file,
        folderPath: extractFolderPath(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (file as any).webkitRelativePath ?? "",
        ),
      }));
    enqueue(items);
  };

  // ---- Drag & drop ---------------------------------------------------
  // For folder drops we need webkitGetAsEntry, which is not standardized
  // as a full API on DataTransferItem yet — TS types are loose. Recursive
  // walk collects every file with its path relative to the outermost
  // drop entry. Files dropped directly (not inside a folder) end up as
  // top-level.
  interface DroppedFile {
    file: File;
    folderPath: string[];
  }

  async function collectFromEntry(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry: any,
    pathPrefix: string[],
    out: DroppedFile[],
  ): Promise<void> {
    if (!entry) return;
    if (entry.isFile) {
      const file: File = await new Promise((resolve, reject) => {
        entry.file(resolve, reject);
      });
      if (
        (file.type || "").startsWith("image/") ||
        /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(file.name)
      ) {
        out.push({ file, folderPath: pathPrefix });
      }
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries only returns a chunk per call — loop until empty.
      const readAll = async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batch: any[] = await new Promise((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
        if (batch.length === 0) return;
        for (const child of batch) {
          await collectFromEntry(child, [...pathPrefix, entry.name], out);
        }
        await readAll();
      };
      await readAll();
    }
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const dt = e.dataTransfer;
    if (!dt) return;

    // If the browser supports items + webkitGetAsEntry, use it — that's
    // the only way to preserve folder structure from a drop. Safari and
    // Chrome/Firefox all support it in modern versions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = dt.items as any;
    const collected: DroppedFile[] = [];

    if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
      const entries: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      // For folder drops we want to preserve depth STARTING from the
      // outer folder as a root gallery folder — the outer wrapper here
      // IS the batch grouping the user chose (unlike webkitdirectory,
      // where the OS wraps everything in one bogus parent). So we call
      // collectFromEntry with an EMPTY prefix and it adds each entry
      // name naturally.
      for (const entry of entries) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e2 = entry as any;
        if (e2.isFile) {
          const file: File = await new Promise((resolve, reject) => {
            e2.file(resolve, reject);
          });
          if (
            (file.type || "").startsWith("image/") ||
            /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(file.name)
          ) {
            collected.push({ file, folderPath: [] });
          }
        } else if (e2.isDirectory) {
          // The outer folder itself becomes the top-level gallery folder;
          // its immediate children start under it. We pass [e2.name] as
          // the prefix so a drop of Shoot/{Bride/Prep, Solo} yields
          // paths ["Shoot", "Bride", "Prep"] and ["Shoot", "Solo"].
          const reader = e2.createReader();
          const readAll = async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const batch: any[] = await new Promise((resolve, reject) => {
              reader.readEntries(resolve, reject);
            });
            if (batch.length === 0) return;
            for (const child of batch) {
              await collectFromEntry(child, [e2.name], collected);
            }
            await readAll();
          };
          await readAll();
        }
      }
    } else if (dt.files && dt.files.length > 0) {
      for (const file of Array.from(dt.files)) {
        collected.push({ file, folderPath: [] });
      }
    }

    if (collected.length === 0) return;
    enqueue(collected);
  }

  // ---- Upload pipeline ----------------------------------------------
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
      // Step 1 — mint a signed upload URL. Server resolves/creates the
      // folderPath tree and returns a folderId (or null for top-level).
      const signedRes = await authFetch(
        `/api/studio/gallery/${galleryId}/images/signed-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: item.file.name,
            contentType: item.file.type || "image/jpeg",
            folderPath: item.folderPath,
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

      // Step 2 — direct PUT to Supabase Storage (bypasses Vercel 4.5 MB).
      const putRes = await fetch(signedBody.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": item.file.type || "application/octet-stream",
          "x-upsert": "true",
        },
        body: item.file,
      });
      if (!putRes.ok) {
        const txt = await putRes.text().catch(() => "");
        markError(`Upload to storage failed (HTTP ${putRes.status}) ${txt}`);
        return false;
      }

      // Step 3 �� finalize: sharp watermarking + DB row insert. Stamp the
      // folderId returned by /signed-url onto the photo_gallery_images row.
      const priceCents = Math.round(parseFloat(priceDollars || "0") * 100);
      const finalizeRes = await authFetch(
        `/api/studio/gallery/${galleryId}/images/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageId: signedBody.imageId,
            filename: item.file.name,
            folderId: signedBody.folderId ?? null,
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

  // Batch summary shown before/during upload so a folder drop gives some
  // reassuring signal ("42 photos across 5 folders") instead of just a
  // silently growing queue list.
  const uniqueFolderPaths = new Set(
    queue.map((q) => q.folderPath.join("/") || "(root)"),
  );

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

        {/* Hidden inputs — clicked programmatically by the two buttons */}
        <input
          ref={filesInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            handleFilePickerFiles(e.target.files);
            e.target.value = "";
          }}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          onChange={(e) => {
            handleFolderPickerFiles(e.target.files);
            e.target.value = "";
          }}
          className="hidden"
        />

        {/* Drop zone wraps both buttons so the user can drop files/folders
            anywhere on this card. Desktop-friendly; on touch it's just a
            neutral container. */}
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            // Only clear if we're leaving the outer container, not
            // hopping between children.
            if (e.currentTarget === e.target) setDragActive(false);
          }}
          onDrop={handleDrop}
          className={`rounded-2xl border-2 border-dashed p-3 transition-colors ${
            dragActive
              ? "border-brand-primary bg-brand-primary/10"
              : "border-brand-border"
          }`}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => filesInputRef.current?.click()}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-4 text-base font-semibold text-white"
            >
              <Camera className="h-5 w-5" />
              Add photos
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="flex flex-1 items-center justify-center gap-2 rounded-full border border-brand-primary bg-transparent hover:bg-brand-primary/10 transition-colors py-4 text-base font-semibold text-brand-primary"
            >
              <FolderPlus className="h-5 w-5" />
              Add folder
            </button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-text-secondary">
            <UploadCloud className="h-3.5 w-3.5" />
            {dragActive
              ? "Drop to upload — folder structure will be preserved"
              : "or drag photos or a folder here"}
          </p>
        </div>
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
              {" · "}
              {queue.length} photo{queue.length === 1 ? "" : "s"} across{" "}
              {uniqueFolderPaths.size} folder
              {uniqueFolderPaths.size === 1 ? "" : "s"}
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
                <div className="flex-1 min-w-0">
                  <p className="truncate text-text-primary">
                    {item.file.name}
                  </p>
                  {item.folderPath.length > 0 && (
                    <p className="truncate text-[10px] text-text-secondary">
                      {item.folderPath.join(" / ")}
                    </p>
                  )}
                </div>
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
