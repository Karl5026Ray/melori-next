import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account",
};

export default function AccountInfoPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold">Account settings</h1>
      <p className="text-text-secondary">
        The Melori Music app is for listening, discovering and taking part in the
        community.
      </p>
      <p className="text-text-secondary">
        Account and plan settings are handled outside the app. Any benefits
        already on your account are available here as soon as you sign in.
      </p>
      <Link
        href="/"
        className="mx-auto mt-2 rounded-md border border-brand-border px-5 py-2.5 font-semibold text-text-primary transition-colors hover:text-brand-primary"
      >
        Back to Melori
      </Link>
    </main>
  );
}
