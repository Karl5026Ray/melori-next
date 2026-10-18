"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FolderPlus, Plus, Settings, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";
import { isAdmin } from "@/lib/membership";
import UploadPanel from "@/app/studio/galleries/UploadPanel";
import type { ViewerFolder } from "./GalleryViewer";

// Owner-only editing on the public gallery page (Karl, 2026-10-18: "make my
// photography section more easily editable… control the uploads and
// downloads"). Visitors never see any of this; every action is re-checked on
// the server (owner or admin), so hiding the controls is only convenience.

/** True when the signed-in viewer owns this gallery (or is an admin). */
export function useGalleryOwner(ownerId: string): boolean {
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return;
      if (uid === ownerId) {
        if (alive) setIsOwner(true);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();
      if (alive && isAdmin(profile)) setIsOwner(true);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [ownerId]);
  return isOwner;
}

/**
 * Fetch a short-lived link to the full-resolution original and start the
 * download. Sends the owner's token when there is one, so the owner can always
 * pull their originals even with public downloads switched off.
 */
export async function downloadOriginal(
  slug: string,
  imageId: string,
): Promise<string | null> {
  try {
    const res = await authFetch(
      `/api/gallery/${encodeURIComponent(slug)}/original/${imageId}`,
      { method: "GET", credentials: "same-origin" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.url) return body?.error ?? "Download failed";
    // The signed link carries Content-Disposition: attachment, so navigating
    // to it saves the file and leaves this page where it is.
    window.location.assign(body.url as string);
    return null;
  } catch {
    return "Download failed";
  }
}

/** Delete one photo (owner/admin). Returns an error message or null. */
export async function deletePhoto(imageId: string): Promise<string | null> {
  try {
    const res = await authFetch(`/api/studio/gallery/image/${imageId}`, {
      method: "DELETE",
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body?.error ?? "Delete failed";
  } catch {
    return "Delete failed";
  }
}

const NEW_FOLDER = "__new__";

/**
 * The owner's toolbar under the gallery title: add photos (into a chosen
 * folder), the public-downloads switch, and a link to the full manager.
 * `uploadTarget` is lifted to the viewer so a folder's own "Add photos here"
 * button can open this panel pre-pointed at that folder.
 */
export function OwnerBar({
  galleryId,
  folders,
  allowDownloads,
  uploadTarget,
  setUploadTarget,
}: {
  galleryId: string;
  folders: ViewerFolder[];
  allowDownloads: boolean;
  /** undefined = panel closed; null = no folder; string = folder id. */
  uploadTarget: string | null | undefined;
  setUploadTarget: (target: string | null | undefined) => void;
}) {
  const router = useRouter();
  const [downloadsOn, setDownloadsOn] = useState(allowDownloads);
  const [savingDownloads, setSavingDownloads] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [pickerValue, setPickerValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDownloadsOn(allowDownloads), [allowDownloads]);
  useEffect(() => {
    if (uploadTarget !== undefined) setPickerValue(uploadTarget ?? "");
  }, [uploadTarget]);

  const open = uploadTarget !== undefined;

  async function toggleDownloads() {
    const next = !downloadsOn;
    setSavingDownloads(true);
    setError(null);
    try {
      const res = await authFetch(`/api/studio/gallery/${galleryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowDownloads: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Couldn't change downloads");
      }
      setDownloadsOn(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change downloads");
    } finally {
      setSavingDownloads(false);
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const res = await authFetch(`/api/studio/gallery/${galleryId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.folder?.id) {
        throw new Error(body?.error ?? "Couldn't create folder");
      }
      setNewFolderName("");
      setUploadTarget(body.folder.id as string);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create folder");
    } finally {
      setCreatingFolder(false);
    }
  }

  const targetName =
    uploadTarget == null
      ? null
      : (folders.find((f) => f.id === uploadTarget)?.name ?? null);

  return (
    <div className="mt-5 rounded-2xl border border-brand-border bg-brand-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Owner
        </span>
        <button
          type="button"
          onClick={() =>
            setUploadTarget(open ? undefined : (folders[0]?.id ?? null))
          }
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
        >
          {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {open ? "Close upload" : "Add photos"}
        </button>
        <button
          type="button"
          onClick={toggleDownloads}
          disabled={savingDownloads}
          aria-pressed={downloadsOn}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold disabled:opacity-50 ${
            downloadsOn
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-brand-border text-text-secondary"
          }`}
        >
          <Download className="h-4 w-4" />
          Public downloads: {downloadsOn ? "On" : "Off"}
        </button>
        <Link
          href="/studio/galleries"
          className="inline-flex items-center gap-1.5 rounded-full border border-brand-border px-3.5 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
        >
          <Settings className="h-4 w-4" /> Covers &amp; captions
        </Link>
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        {downloadsOn
          ? "Visitors download full-resolution copies with melorimusic.org in the corner. Yours stay clean."
          : "Visitors see watermarked previews only. You can still download any original."}
      </p>

      {open && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-text-primary">
            Put new photos in
            <select
              value={pickerValue}
              onChange={(e) => {
                const v = e.target.value;
                setPickerValue(v);
                if (v !== NEW_FOLDER) setUploadTarget(v || null);
              }}
              className="mt-1 block w-full rounded-lg border border-brand-border bg-brand-background px-3 py-2.5 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value="">No folder (top of the page)</option>
              <option value={NEW_FOLDER}>+ New folder…</option>
            </select>
          </label>

          {pickerValue === NEW_FOLDER && (
            <div className="flex gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createFolder();
                }}
                maxLength={60}
                placeholder="Folder name, e.g. Fashion"
                className="min-w-0 flex-1 rounded-lg border border-brand-border bg-brand-background px-3 py-2.5 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={createFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <FolderPlus className="h-4 w-4" />
                {creatingFolder ? "Adding…" : "Create"}
              </button>
            </div>
          )}

          {pickerValue !== NEW_FOLDER && (
            <>
              <UploadPanel
                // Remount per folder so a half-finished batch can't silently
                // switch folders mid-upload.
                key={uploadTarget ?? "none"}
                galleryId={galleryId}
                folderId={uploadTarget ?? null}
                onUploaded={() => router.refresh()}
                onDone={() => {
                  setUploadTarget(undefined);
                  router.refresh();
                }}
              />
              <p className="text-xs text-text-secondary">
                Uploading to{" "}
                <span className="font-semibold text-text-primary">
                  {targetName ?? "no folder"}
                </span>
                . Full resolution is kept; visitors see a watermarked preview.
              </p>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
