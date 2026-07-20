"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DollarSign, Plus } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import ServiceEditorModal from "./ServiceEditorModal";
import ServiceCard from "./ServiceCard";
import CalendarConnectCard from "../components/CalendarConnectCard";
import type { ServiceItem } from "./types";

// /studio/services — Phase 2 services & pricing admin. Client component
// under StudioGuard, mirrors the /studio/galleries list page structure.
export default function ServicesClient() {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const loadServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/studio/services", { method: "GET" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load services.");
      setServices(body.services ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load services.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const openCreate = () => {
    setEditing(null);
    setShowEditor(true);
  };

  const openEdit = (service: ServiceItem) => {
    setEditing(service);
    setShowEditor(true);
  };

  const handleSaved = (service: ServiceItem) => {
    setServices((prev) => {
      const exists = prev.some((s) => s.id === service.id);
      const next = exists
        ? prev.map((s) => (s.id === service.id ? service : s))
        : [...prev, service];
      return next.sort((a, b) => a.sort_order - b.sort_order);
    });
    setShowEditor(false);
  };

  const handleDeleted = (id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
  };

  const handleServiceUpdated = (service: ServiceItem) => {
    setServices((prev) => prev.map((s) => (s.id === service.id ? service : s)));
  };

  return (
    <div className="min-h-screen bg-brand-background text-text-primary px-4 sm:px-6 py-6 sm:py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
              <DollarSign className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Services &amp; Pricing</h1>
              <p className="text-xs text-text-secondary">
                Manage the sessions clients can see on your public pricing page.
              </p>
            </div>
          </div>
          <Link
            href="/studio"
            className="text-xs text-text-secondary hover:text-brand-primary shrink-0"
          >
            ← Studio
          </Link>
        </div>

        {/* Phase 3: Google Calendar connect card. Mounted here on
            /studio/services since /studio/booking doesn't exist yet
            (Phase 4) — this is the only Studio surface this phase touches. */}
        <div className="mt-5">
          <CalendarConnectCard />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center justify-center gap-2 rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-3.5 px-6 text-base font-semibold text-white"
          >
            <Plus className="h-5 w-5" /> New service
          </button>
          <Link
            href="/pricing"
            target="_blank"
            className="text-sm text-text-secondary hover:text-brand-primary"
          >
            View public pricing page →
          </Link>
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </p>
        )}

        {loading ? (
          <p className="mt-8 text-sm text-text-secondary">Loading services…</p>
        ) : services.length === 0 ? (
          <div className="mt-8 rounded-xl border border-brand-border bg-brand-surface p-8 text-center">
            <DollarSign className="mx-auto h-10 w-10 text-brand-primary" />
            <p className="mt-3 font-semibold">No services yet</p>
            <p className="mt-1 text-sm text-text-secondary">
              Add your first service to start showing pricing publicly.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                onEdit={() => openEdit(service)}
                onDeleted={handleDeleted}
                onServiceUpdated={handleServiceUpdated}
              />
            ))}
          </div>
        )}
      </div>

      {showEditor && (
        <ServiceEditorModal
          service={editing}
          onClose={() => setShowEditor(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
