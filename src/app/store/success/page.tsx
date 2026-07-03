import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import ClearCart from "./ClearCart";

export default function StoreSuccessPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-20 text-center">
      <ClearCart />
      <CheckCircle2 className="mx-auto h-16 w-16 text-brand-primary" />
      <h1 className="mt-6 text-3xl font-bold">Thank you for your order!</h1>
      <p className="mt-3 text-text-secondary">
        Your payment was successful. A confirmation email with your order
        details is on its way.
      </p>
      <Link
        href="/store"
        className="mt-8 inline-block rounded-md bg-brand-primary px-6 py-3 font-semibold text-black hover:opacity-90"
      >
        Continue shopping
      </Link>
    </main>
  );
}
