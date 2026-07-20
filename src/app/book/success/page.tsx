import { Suspense } from "react";
import type { Metadata } from "next";
import SuccessClient from "./SuccessClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Booking Confirmed | Melori Music",
  description: "Your photography session booking was received.",
  robots: { index: false, follow: false },
};

export default function BookSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-brand-background" />}>
      <SuccessClient />
    </Suspense>
  );
}
