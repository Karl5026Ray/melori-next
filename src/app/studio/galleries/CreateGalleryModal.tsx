"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { authFetch } from "@/lib/authClient";

interface Props {
  onClose: () => void;
  onCreated: (gallery: { id: string; slug: string }) => void;
}

// Modal to create a new gallery. Kept phone-friendly: single column, large
// tap targets, minimal required fields (only name is required).
export default function CreateGalleryModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Gallery name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/studio/gallery/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          clientName: clientName.trim() || undefined,
          allowDownloads,
          password: password.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create gallery.");
      onCreated({ id: body.id, slug: body.slug });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create gallery.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 px-0 sm:px-4">
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-brand-surface border border-brand-border p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">New gallery</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-text-secondary hover:text-text-primary hover:bg-brand-muted"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Gallery name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Smith Wedding"
              className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Client name (optional)
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Jane & John Smith"
              className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Password (optional)
            </label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank for no password"
              className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary"
            />
          </div>

          <label className="flex items-center gap-3 py-1">
            <input
              type="checkbox"
              checked={allowDownloads}
              onChange={(e) => setAllowDownloads(e.target.checked)}
              className="h-5 w-5 accent-[#ff5500]"
            />
            <span className="text-sm text-text-primary">Allow free downloads</span>
          </label>

          {error && (
            <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="w-full rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-3.5 text-base font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create gallery"}
          </button>
        </div>
      </div>
    </div>
  );
}
