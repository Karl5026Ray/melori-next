import { Suspense } from "react";
import type { Metadata } from "next";
import BookClient from "./BookClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book a Photo Session | Melori Music",
  description:
    "Book a photography session with Karl Ray Photography — Melori Music. Pick a service, choose a time, and reserve your spot.",
};

export default function BookPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-brand-background" />}>
      <BookClient />
    </Suspense>
  );
}
