"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import type { ServiceItem } from "./types";

interface Props {
  service: ServiceItem | null; // null = creating new
  onClose: () => void;
  onSaved: (service: ServiceItem) => void;
}

// Create/edit modal for a photo_services row. Mirrors CreateGalleryModal's
// phone-friendly single-column layout with large tap targets.
export default function ServiceEditorModal({ service, onClose, onSaved }: Props) {
  const isEdit = Boolean(service);
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [durationMinutes, setDurationMinutes] = useState(
    String(service?.duration_minutes ?? 60),
  );
  const [priceDollars, setPriceDollars] = useState(
    service ? (service.price_cents / 100).toFixed(2) : "",
  );
  const [depositMode, setDepositMode] = useState<"none" | "fixed" | "percent">(
    service?.deposit_percent
      ? "percent"
      : service && service.deposit_cents > 0
        ? "fixed"
        : "none",
  );
  const [depositDollars, setDepositDollars] = useState(
    service && service.deposit_cents > 0 ? (service.deposit_cents / 100).toFixed(2) : "",
  );
  const [depositPercent, setDepositPercent] = useState(
    service?.deposit_percent ? String(service.deposit_percent) : "",
  );
  const [isActive, setIsActive] = useState(service?.is_active ?? true);
  const [sortOrder, setSortOrder] = useState(String(service?.sort_order ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Service name is required.");
      return;
    }
    const priceCents = Math.round(parseFloat(priceDollars || "0") * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError("Price must be a valid amount.");
      return;
    }
    const durationVal = parseInt(durationMinutes, 10);
    if (!Number.isInteger(durationVal) || durationVal <= 0) {
      setError("Duration must be a positive number of minutes.");
      return;
    }

    let depositCents = 0;
    let depositPercentVal: number | null = null;
    if (depositMode === "fixed") {
      depositCents = Math.round(parseFloat(depositDollars || "0") * 100);
      if (!Number.isFinite(depositCents) || depositCents < 0) {
        setError("Deposit amount must be a valid amount.");
        return;
      }
    } else if (depositMode === "percent") {
      depositPercentVal = parseInt(depositPercent, 10);
      if (
        !Number.isInteger(depositPercentVal) ||
        depositPercentVal < 0 ||
        depositPercentVal > 100
      ) {
        setError("Deposit percent must be between 0 and 100.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        durationMinutes: durationVal,
        priceCents,
        depositCents,
        depositPercent: depositPercentVal,
        isActive,
        sortOrder: Number.isInteger(parseInt(sortOrder, 10))
          ? parseInt(sortOrder, 10)
          : 0,
      };
      const res = await authFetch(
        isEdit ? `/api/studio/services/${service!.id}` : "/api/studio/services",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save service.");
      onSaved(body.service);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save service.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 px-0 sm:px-4">
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-brand-surface border border-brand-border p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">
            {isEdit ? "Edit service" : "New service"}
          </h2>
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
              Service name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wedding Photography — Full Day"
              className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What's included in this session…"
              className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
                Duration (minutes)
              </label>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
                Price ($)
              </label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
                placeholder="250.00"
                className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Deposit
            </label>
            <div className="flex gap-2 mb-2">
              {(["none", "fixed", "percent"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDepositMode(mode)}
                  className={`flex-1 rounded-full py-2 text-xs font-semibold transition-colors ${
                    depositMode === mode
                      ? "bg-brand-primary text-white"
                      : "bg-brand-background border border-brand-border text-text-secondary"
                  }`}
                >
                  {mode === "none" ? "None" : mode === "fixed" ? "Fixed $" : "Percent %"}
                </button>
              ))}
            </div>
            {depositMode === "fixed" && (
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={depositDollars}
                onChange={(e) => setDepositDollars(e.target.value)}
                placeholder="50.00"
                className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary"
              />
            )}
            {depositMode === "percent" && (
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                value={depositPercent}
                onChange={(e) => setDepositPercent(e.target.value)}
                placeholder="20"
                className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary"
              />
            )}
            <p className="mt-1 text-xs text-text-secondary">
              Deposits are scaffolding for now — booking/checkout comes later.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Sort order
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-full rounded-xl bg-brand-background border border-brand-border px-4 py-3 text-base text-text-primary focus:outline-none focus:border-brand-primary"
            />
          </div>

          <label className="flex items-center gap-3 py-1">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-5 w-5 accent-[#ff5500]"
            />
            <span className="text-sm text-text-primary">
              Active (visible on public pricing page)
            </span>
          </label>

          {error && (
            <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-3.5 text-base font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create service"}
          </button>
        </div>
      </div>
    </div>
  );
}
