"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import CalendarConnectCard from "../components/CalendarConnectCard";
import WeeklyAvailabilityEditor from "./WeeklyAvailabilityEditor";
import SettingsPanel from "./SettingsPanel";
import BookingsList from "./BookingsList";

// /studio/booking — Phase 4 availability + booking admin. Client component
// under StudioGuard, mirrors the /studio/services list page structure.
export default function BookingClient() {
  return (
    <div className="min-h-screen bg-brand-background text-text-primary px-4 sm:px-6 py-6 sm:py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Booking &amp; Calendar</h1>
              <p className="text-xs text-text-secondary">
                Set your hours, connect your calendar, and manage sessions.
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

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href="/book"
            target="_blank"
            className="text-sm text-text-secondary hover:text-brand-primary"
          >
            View public booking page →
          </Link>
        </div>

        <div className="mt-5 space-y-5">
          <CalendarConnectCard />
          <WeeklyAvailabilityEditor />
          <SettingsPanel />
          <BookingsList />
        </div>
      </div>
    </div>
  );
}
