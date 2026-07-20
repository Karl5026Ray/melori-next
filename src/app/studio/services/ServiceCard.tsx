"use client";

import { useRef, useState } from "react";
import { FileText, Pencil, Trash2, Upload } from "lucide-react";
import { authFetch, authHeaders } from "@/lib/authClient";
import type { ServiceItem } from "./types";

interface Props {
  service: ServiceItem;
  onEdit: () => void;
  onDeleted: (id: string) => void;
  onServiceUpdated: (service: ServiceItem) => void;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
}

// Card for one service in the /studio/services list — shows price/duration/
// deposit summary, contract upload/download, edit, and delete.
export default function ServiceCard({
  service,
  onEdit,
  onDeleted,
  onServiceUpdated,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingContract, setUploadingContract] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleContractSelected = async (file: File | null) => {
    if (!file) return;
    setUploadingContract(true);
    setContractError(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const headers = await authHeaders();
      const res = await fetch(`/api/studio/services/${service.id}/contract`, {
        method: "POST",
        headers,
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Contract upload failed.");
      onServiceUpdated({ ...service, hasContract: true });
    } catch (err) {
      setContractError(
        err instanceof Error ? err.message : "Contract upload failed.",
      );
    } finally {
      setUploadingContract(false);
    }
  };

  const handleDownloadContract = async () => {
    setDownloading(true);
    setContractError(null);
    try {
      const res = await authFetch(`/api/studio/services/${service.id}/contract`, {
        method: "GET",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not get contract link.");
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setContractError(
        err instanceof Error ? err.message : "Could not get contract link.",
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${service.name}"? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    try {
      const res = await authFetch(`/api/studio/services/${service.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not delete service.");
      }
      onDeleted(service.id);
    } catch (err) {
      setContractError(
        err instanceof Error ? err.message : "Could not delete service.",
      );
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-border bg-brand-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-text-primary truncate">{service.name}</p>
            {!service.is_active && (
              <span className="shrink-0 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                Inactive
              </span>
            )}
          </div>
          {service.description && (
            <p className="mt-1 text-sm text-text-secondary line-clamp-2">
              {service.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
            <span>{formatDuration(service.duration_minutes)}</span>
            <span className="font-semibold text-brand-primary">
              {formatPrice(service.price_cents)}
            </span>
            {service.deposit_percent ? (
              <span>{service.deposit_percent}% deposit</span>
            ) : service.deposit_cents > 0 ? (
              <span>{formatPrice(service.deposit_cents)} deposit</span>
            ) : (
              <span>No deposit</span>
            )}
            <span>Sort {service.sort_order}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-full p-2 text-text-secondary hover:text-text-primary hover:bg-brand-muted"
            aria-label="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-full p-2 text-text-secondary hover:text-red-400 hover:bg-brand-muted disabled:opacity-50"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-brand-border pt-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            void handleContractSelected(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        {service.hasContract ? (
          <button
            type="button"
            onClick={handleDownloadContract}
            disabled={downloading}
            className="flex items-center gap-1.5 rounded-full bg-brand-muted px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-brand-border disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            {downloading ? "Opening…" : "View contract"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingContract}
          className="flex items-center gap-1.5 rounded-full border border-brand-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-brand-primary disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {uploadingContract
            ? "Uploading…"
            : service.hasContract
              ? "Replace contract"
              : "Upload contract (PDF)"}
        </button>
      </div>
      {contractError && (
        <p className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-xs text-red-400">
          {contractError}
        </p>
      )}
    </div>
  );
}
