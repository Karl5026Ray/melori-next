"use client";

import { useState } from "react";
import { Star, Trash2, Tag, Check } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import type { GalleryImageItem } from "./types";

interface Props {
  image: GalleryImageItem;
  isCover: boolean;
  onSetCover: (imageId: string) => void;
  onDeleted: (imageId: string) => void;
  onUpdated: (image: GalleryImageItem) => void;
}

// One tile in the gallery manager grid: thumbnail + inline caption, for-sale
// toggle + price, set-cover star, delete. Kept compact for a 2-column mobile
// grid at 390px wide.
export default function ImageCard({
  image,
  isCover,
  onSetCover,
  onDeleted,
  onUpdated,
}: Props) {
  const [caption, setCaption] = useState(image.caption ?? "");
  const [forSale, setForSale] = useState(image.forSale);
  const [priceDollars, setPriceDollars] = useState(
    image.priceCents ? (image.priceCents / 100).toFixed(2) : "",
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`/api/studio/gallery/image/${image.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Update failed");
      onUpdated({
        ...image,
        caption: body.image?.caption ?? image.caption,
        forSale: body.image?.for_sale ?? image.forSale,
        priceCents: body.image?.price_cents ?? image.priceCents,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCaption = () => save({ caption: caption.trim() || null });

  const handleToggleForSale = () => {
    const next = !forSale;
    setForSale(next);
    if (next) {
      const cents = Math.round(parseFloat(priceDollars || "0") * 100);
      if (!Number.isFinite(cents) || cents <= 0) {
        setError("Enter a price before enabling for-sale.");
        setForSale(false);
        return;
      }
      save({ forSale: true, priceCents: cents });
    } else {
      save({ forSale: false });
    }
  };

  const handleSavePrice = () => {
    const cents = Math.round(parseFloat(priceDollars || "0") * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a valid price.");
      return;
    }
    save({ forSale: true, priceCents: cents });
    setForSale(true);
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this photo? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/studio/gallery/image/${image.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Delete failed");
      }
      onDeleted(image.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <div className="relative rounded-xl overflow-hidden border border-brand-border bg-brand-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative block w-full aspect-square bg-brand-muted"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl}
          alt={image.caption ?? image.filename ?? "Gallery photo"}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        {isCover && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-brand-background/85 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            <Star className="h-3 w-3 fill-amber-300" /> Cover
          </span>
        )}
        {forSale && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
            <Tag className="h-3 w-3" />
            {image.priceCents ? `$${(image.priceCents / 100).toFixed(2)}` : "For sale"}
          </span>
        )}
      </button>

      {expanded && (
        <div className="p-2.5 space-y-2 border-t border-brand-border">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={handleSaveCaption}
            placeholder="Caption (optional)"
            className="w-full rounded-lg bg-brand-background border border-brand-border px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand-primary"
          />

          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1.5 text-xs text-text-primary">
              <input
                type="checkbox"
                checked={forSale}
                onChange={handleToggleForSale}
                className="h-4 w-4 accent-[#ff5500]"
              />
              For sale
            </label>
            {forSale && (
              <div className="flex items-center gap-1 flex-1">
                <span className="text-text-secondary text-xs">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  onBlur={handleSavePrice}
                  className="w-16 rounded-lg bg-brand-background border border-brand-border px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-brand-primary"
                />
              </div>
            )}
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => onSetCover(image.id)}
              disabled={isCover}
              className="flex items-center gap-1 text-xs font-medium text-amber-300 disabled:opacity-40"
            >
              {isCover ? <Check className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
              {isCover ? "Cover" : "Set cover"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1 text-xs font-medium text-red-400 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
          {saving && <p className="text-[11px] text-text-secondary">Saving…</p>}
        </div>
      )}
    </div>
  );
}
