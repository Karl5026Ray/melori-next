"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, Clock, Loader2, CalendarDays, FileText } from "lucide-react";
import { authFetch } from "@/lib/authClient";

// Opens the service's contract PDF (short-lived signed URL) in a new tab so a
// client can review terms before booking. Public endpoint, no auth needed.
function ContractReviewLink({ serviceId }: { serviceId: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/booking/service-contract/${encodeURIComponent(serviceId)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error ?? "Contract unavailable.");
      window.open(body.url as string, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Contract unavailable.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-medium text-brand-primary hover:underline disabled:opacity-50"
      >
        <FileText className="h-3.5 w-3.5" />
        {loading ? "Opening\u2026" : "Review the contract for this session (PDF)"}
      </button>
      {err && <p className="mt-1 text-[11px] text-red-400">{err}</p>}
    </>
  );
}

interface ServiceOption {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  deposit_cents: number;
  deposit_percent: number | null;
  hasContract?: boolean;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
}

function todayLocalDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function maxLocalDateStr(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function BookClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedServiceId = searchParams.get("serviceId");

  const [services, setServices] = useState<ServiceOption[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    preselectedServiceId,
  );
  const [dateStr, setDateStr] = useState(todayLocalDateStr());
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setServicesLoading(true);
      setServicesError(null);
      try {
        const res = await fetch("/api/booking/public-services", { method: "GET" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not load services.");
        if (cancelled) return;
        const list: ServiceOption[] = body.services ?? [];
        setServices(list);
        if (!selectedServiceId && list.length > 0) {
          setSelectedServiceId(list[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setServicesError(
            err instanceof Error ? err.message : "Could not load services.",
          );
        }
      } finally {
        if (!cancelled) setServicesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedService = useMemo(
    () => services.find((s) => s.id === selectedServiceId) ?? null,
    [services, selectedServiceId],
  );

  const loadSlots = useCallback(async () => {
    if (!selectedServiceId || !dateStr) return;
    setSlotsLoading(true);
    setSlotsError(null);
    setSelectedSlot(null);
    try {
      const res = await fetch(
        `/api/booking/slots?serviceId=${encodeURIComponent(selectedServiceId)}&date=${encodeURIComponent(dateStr)}`,
        { method: "GET" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load available times.");
      setSlots(body.slots ?? []);
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : "Could not load available times.");
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedServiceId, dateStr]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!selectedServiceId || !selectedSlot) {
      setSubmitError("Please choose a service and an available time.");
      return;
    }
    if (!clientName.trim()) {
      setSubmitError("Please enter your name.");
      return;
    }
    if (!clientEmail.trim()) {
      setSubmitError("Please enter your email.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch("/api/booking/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: selectedServiceId,
          startsAt: selectedSlot,
          clientName: clientName.trim(),
          clientEmail: clientEmail.trim(),
          clientPhone: clientPhone.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create booking.");

      if (body.checkoutUrl) {
        window.location.href = body.checkoutUrl;
        return;
      }
      router.push(`/book/success?bookingId=${body.bookingId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not create booking.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-brand-background text-text-primary">
      <section className="mx-auto max-w-lg px-4 py-8 sm:py-12">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-muted text-brand-primary shrink-0">
            <Camera className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Book a Session</h1>
            <p className="text-xs text-text-secondary">Karl Ray Photography</p>
          </div>
        </div>

        {servicesError && (
          <p className="mt-6 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {servicesError}
          </p>
        )}

        {servicesLoading ? (
          <p className="mt-8 text-sm text-text-secondary">Loading services…</p>
        ) : services.length === 0 ? (
          <div className="mt-8 rounded-xl border border-brand-border bg-brand-surface p-6 text-center">
            <p className="text-sm text-text-secondary">
              No bookable services are available right now. Check back soon.
            </p>
          </div>
        ) : (
          <>
            {/* Step 1: choose service */}
            <div className="mt-6">
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                1. Choose a service
              </label>
              <div className="space-y-2">
                {services.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedServiceId(s.id)}
                    className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                      selectedServiceId === s.id
                        ? "border-brand-primary bg-brand-primary/10"
                        : "border-brand-border bg-brand-surface"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-sm">{s.name}</p>
                      <span className="text-sm font-bold text-brand-primary shrink-0">
                        {formatPrice(s.price_cents)}
                      </span>
                    </div>
                    {s.description && (
                      <p className="mt-1 text-xs text-text-secondary line-clamp-2">
                        {s.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-text-secondary">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDuration(s.duration_minutes)}
                      {(s.deposit_cents > 0 || s.deposit_percent) && (
                        <span>
                          ·{" "}
                          {s.deposit_percent
                            ? `${s.deposit_percent}% deposit`
                            : `${formatPrice(s.deposit_cents)} deposit`}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {selectedService?.hasContract && (
                <div className="mt-2">
                  <ContractReviewLink serviceId={selectedService.id} />
                </div>
              )}
            </div>

            {/* Step 2: pick date */}
            <div className="mt-6">
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                2. Choose a date
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-brand-border bg-brand-surface p-3">
                <CalendarDays className="h-4 w-4 text-brand-primary shrink-0" />
                <input
                  type="date"
                  value={dateStr}
                  min={todayLocalDateStr()}
                  max={maxLocalDateStr(365)}
                  onChange={(e) => setDateStr(e.target.value)}
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>
            </div>

            {/* Step 3: pick a slot */}
            <div className="mt-6">
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                3. Choose a time
              </label>
              {slotsLoading ? (
                <p className="text-sm text-text-secondary flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking availability…
                </p>
              ) : slotsError ? (
                <p className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                  {slotsError}
                </p>
              ) : slots.length === 0 ? (
                <p className="rounded-xl border border-brand-border bg-brand-surface p-4 text-sm text-text-secondary">
                  No open times on this date. Try another day.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((slot) => {
                    const label = new Date(slot).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    });
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                          selectedSlot === slot
                            ? "border-brand-primary bg-brand-primary text-white"
                            : "border-brand-border bg-brand-surface text-text-primary"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Step 4: contact info */}
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary">
                4. Your details
              </label>
              <input
                type="text"
                placeholder="Full name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full rounded-xl border border-input-border bg-black/40 px-4 py-3 text-sm outline-none focus:border-brand-primary"
              />
              <input
                type="email"
                placeholder="Email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full rounded-xl border border-input-border bg-black/40 px-4 py-3 text-sm outline-none focus:border-brand-primary"
              />
              <input
                type="tel"
                placeholder="Phone (optional)"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className="w-full rounded-xl border border-input-border bg-black/40 px-4 py-3 text-sm outline-none focus:border-brand-primary"
              />
              <textarea
                placeholder="Notes for Karl (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-input-border bg-black/40 px-4 py-3 text-sm outline-none focus:border-brand-primary resize-none"
              />
            </div>

            {submitError && (
              <p className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                {submitError}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !selectedSlot}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-3.5 text-base font-semibold text-white disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {selectedService && selectedService.deposit_cents > 0
                ? "Continue to deposit"
                : "Confirm booking"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
