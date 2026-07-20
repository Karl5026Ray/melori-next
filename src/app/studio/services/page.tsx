"use client";

import StudioGuard from "../StudioGuard";
import ServicesClient from "./ServicesClient";

// /studio/services — Phase 2 services & pricing admin. Wrapped in
// StudioGuard like every other /studio page.
export default function StudioServicesPage() {
  return (
    <StudioGuard>
      <ServicesClient />
    </StudioGuard>
  );
}
