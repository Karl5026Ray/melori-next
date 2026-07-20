"use client";

import StudioGuard from "../StudioGuard";
import GalleriesClient from "./GalleriesClient";

// /studio/galleries — Phase 1 gallery admin + phone-first capture upload.
// Wrapped in StudioGuard like every other /studio page.
export default function StudioGalleriesPage() {
  return (
    <StudioGuard>
      <GalleriesClient />
    </StudioGuard>
  );
}
