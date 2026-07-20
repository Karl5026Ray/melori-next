import type { Metadata } from "next";
import DeleteAccountClient from "./DeleteAccountClient";

export const metadata: Metadata = {
  title: "Delete Your Account",
  description:
    "Request permanent deletion of your Melori Music account and associated data.",
  // Google Play requires this URL to be crawlable/reachable; keep it indexable.
  robots: { index: true, follow: true },
};

// /account/delete — Public account-deletion page.
//
// This is the canonical "data deletion" URL submitted to Google Play (Data
// safety → account deletion) and referenced from Settings. It must be reachable
// WITHOUT signing in and must clearly state what is deleted and how to request
// it, so it renders instructions for everyone and an in-app delete button when
// the visitor is signed in (handled by the client component).
export default function DeleteAccountPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-2">Delete your account</h1>
      <p className="text-[#aaa] mb-8">
        You can permanently delete your Melori Music account and its associated
        data at any time.
      </p>

      <section className="mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-3">What gets deleted</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-[#ccc]">
          <li>Your profile, username, display name, bio, and avatar</li>
          <li>Your membership record and account login</li>
          <li>Your comments, messages, and community activity</li>
          <li>Content you uploaded (tracks, videos, gallery photos)</li>
          <li>Your listening history and Superfan stats</li>
        </ul>
        <h2 className="text-lg font-semibold mt-6 mb-3">What is retained</h2>
        <p className="text-sm text-[#ccc]">
          Records we are legally required to keep — such as payment and tax
          records for completed purchases — are retained by our payment
          processor (Stripe) for the period required by law. These are not used
          to identify you within Melori after deletion.
        </p>
      </section>

      <section className="mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-3">How to delete your account</h2>
        <p className="text-sm text-[#ccc] mb-4">
          <strong>Option 1 — In the app:</strong> Sign in, go to Settings →
          Account → Delete account, and confirm. Deletion is immediate and
          permanent.
        </p>
        <p className="text-sm text-[#ccc]">
          <strong>Option 2 — By email:</strong> If you cannot sign in, email{" "}
          <a
            href="mailto:support@melorimusic.org?subject=Account%20deletion%20request"
            className="text-[#ff8c00] underline"
          >
            support@melorimusic.org
          </a>{" "}
          from the address on your account and we will delete it within 30 days.
        </p>
      </section>

      {/* Signed-in visitors get a real delete button; signed-out visitors see a
          sign-in prompt. */}
      <DeleteAccountClient />
    </div>
  );
}
