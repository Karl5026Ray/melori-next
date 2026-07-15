import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, UserX, Flag, HeartOff, AlertTriangle } from "lucide-react";

export const metadata: Metadata = {
  title: "Dating Safety Center",
  description: "How Melori Connect keeps dating safe: block, report, unmatch, NCII reporting, and 18+ policy.",
};

// Dating Safety Center. Explains the three safety actions, NCII / TAKE IT DOWN
// reporting, the Colorado Online Dating Safety Act disclosure, and the 18+ policy.
export default function SafetyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-24">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/social/connect" className="text-melori-muted hover:text-melori-text">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck className="h-6 w-6 text-melori-success" /> Dating Safety Center
        </h1>
      </div>

      <p className="mb-6 text-melori-muted">
        Your safety comes first on Melori Connect. Every profile, message, and match has
        safety tools one tap away, and our team reviews reports with full context before
        taking action.
      </p>

      <Card
        icon={<HeartOff className="h-5 w-5 text-melori-warning" />}
        title="Unmatch"
        body="Ends a match and stops further messaging. Your message history is preserved (not deleted) so it remains available if you later need to report — you never have to choose between walking away and keeping evidence."
      />
      <Card
        icon={<Flag className="h-5 w-5 text-melori-warning" />}
        title="Report"
        body="Flag a member for harassment, a fake profile, appearing underage, non-consensual intimate images (NCII), or anything else. Reports are confidential — the reported member is never told who reported them."
      />
      <Card
        icon={<UserX className="h-5 w-5 text-melori-danger" />}
        title="Block"
        body="Blocking cuts off contact everywhere on Melori — not just in dating — and immediately unmatches you. Blocks compose with the platform's existing block list."
      />

      <div className="mt-6 rounded-2xl border border-melori-danger/40 bg-melori-danger/10 p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <AlertTriangle className="h-5 w-5 text-melori-danger" /> NCII &amp; TAKE IT DOWN
        </h2>
        <p className="mt-2 text-sm text-melori-muted">
          Sharing intimate images of someone without their consent is never allowed. If
          intimate images of you have been shared, report them with the{" "}
          <span className="font-semibold text-melori-text">NCII</span> category — we escalate
          these immediately. For images of minors, the free{" "}
          <a
            href="https://takeitdown.ncmec.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-melori-accent underline"
          >
            TAKE IT DOWN
          </a>{" "}
          service (from NCMEC) can help remove them across participating platforms.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-melori-border bg-melori-surface p-5">
        <h2 className="font-bold">18+ only</h2>
        <p className="mt-2 text-sm text-melori-muted">
          Melori Connect is strictly for adults 18 and over, independent of Melori&apos;s
          general minimum age. Age is attested at sign-up and enforced in our systems.
          Profiles that appear to belong to a minor are removed and reported.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-melori-border bg-melori-surface p-5">
        <h2 className="font-bold">Colorado Online Dating Safety Act</h2>
        <p className="mt-2 text-sm text-melori-muted">
          In compliance with the Colorado Online Dating Safety Act, Melori Connect provides
          safety awareness notifications, a clear reporting process for members who have
          interacted with a banned user, and fraud-prevention guidance. Never send money to
          someone you have not met in person, and report anyone who asks you to.
        </p>
      </div>

      <p className="mt-6 text-center text-xs text-melori-muted">
        In immediate danger? Contact local emergency services first.
      </p>
    </div>
  );
}

function Card({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mb-3 rounded-2xl border border-melori-border bg-melori-surface p-5">
      <h2 className="flex items-center gap-2 font-bold">
        {icon}
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-melori-muted">{body}</p>
    </div>
  );
}
