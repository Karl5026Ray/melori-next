"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

// Landing page after /book completes — either straight from a $0-deposit
// booking, or after returning from Stripe's success_url on a paid deposit.
// Either way, the booking already exists server-side by the time a client
// reaches this page (created in /api/booking/create before any redirect).
export default function SuccessClient() {
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("bookingId");
  const isBalance = searchParams.get("balance") === "1";

  return (
    <main className="min-h-screen bg-brand-background text-text-primary flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
          <CheckCircle2 className="h-9 w-9" />
        </span>
        <h1 className="mt-5 text-2xl font-bold">
          {isBalance ? "Payment received!" : "Booking received!"}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {isBalance
            ? "Thanks — your balance payment to Karl Ray Photography is complete. You'll receive a receipt by email. Reply to that email with any questions."
            : "Thanks for booking with Karl Ray Photography. You'll receive a confirmation email shortly with your session details. Reply to that email with any questions."}
        </p>
        {bookingId && (
          <p className="mt-3 text-xs text-text-secondary">
            Booking reference: <span className="font-mono">{bookingId}</span>
          </p>
        )}
        <Link
          href="/"
          className="mt-8 inline-flex items-center justify-center rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-3 px-8 text-sm font-semibold text-white"
        >
          Back to Melori
        </Link>
      </div>
    </main>
  );
}
