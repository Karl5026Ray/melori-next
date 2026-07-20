"use client";

import StudioGuard from "../StudioGuard";
import BookingClient from "./BookingClient";

// /studio/booking — Phase 4 availability + booking admin. Wrapped in
// StudioGuard like every other /studio page.
export default function StudioBookingPage() {
  return (
    <StudioGuard>
      <BookingClient />
    </StudioGuard>
  );
}
