import type { Metadata } from "next";
import Link from "next/link";
import { Video, Users, Radio } from "lucide-react";

// MM Faces — the social LIVE video system. Three modes are planned:
//   • Live         — a single host broadcasting live video.
//   • Duo Live      — two people live together (split screen).
//   • 8-Person Live — a group live room seating up to eight faces.
//
// The full spec lives outside the repo for now, so this page introduces the
// feature and gives the nav a real destination. The individual live-room UI
// will slot in under this same /social/live route as it's built.

export const metadata: Metadata = {
  title: "MM Faces — Live",
  description:
    "MM Faces brings artists and fans face-to-face: go Live solo, Duo Live with a guest, or host an 8-Person Live room.",
};

const modes = [
  {
    icon: Radio,
    label: "Live",
    desc: "Go live solo. Broadcast to your fans in real time, take comments, and react on camera.",
  },
  {
    icon: Video,
    label: "Duo Live",
    desc: "Bring one guest on with you — a split-screen live session for collabs, interviews, and back-to-backs.",
  },
  {
    icon: Users,
    label: "8-Person Live",
    desc: "Host a room with up to eight faces on screen — panels, cyphers, listening hangs, and watch parties.",
  },
];

export default function LivePage() {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-primary">
            <span className="h-2 w-2 rounded-full bg-brand-primary" aria-hidden />
            MM Faces
          </span>
          <h1 className="mt-4 text-3xl md:text-4xl font-bold text-text-primary">
            Go face-to-face, live
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-text-secondary leading-relaxed">
            MM Faces is Melori&apos;s live video side — where artists and fans
            meet on camera. Go Live on your own, bring a guest on with Duo Live,
            or fill the room with up to eight faces.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {modes.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="flex flex-col rounded-2xl border border-brand-border bg-white/5 p-6"
              >
                <Icon className="h-7 w-7 text-brand-primary" aria-hidden />
                <h2 className="mt-4 text-xl font-semibold text-text-primary">
                  {m.label}
                </h2>
                <p className="mt-2 text-sm text-text-secondary leading-relaxed">
                  {m.desc}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-10 rounded-2xl border border-brand-border bg-white/[0.03] p-6">
          <h3 className="text-lg font-semibold text-text-primary">
            Rolling out soon
          </h3>
          <p className="mt-2 text-sm text-text-secondary leading-relaxed">
            We&apos;re building the live rooms now. In the meantime, join the
            conversation in MM Spaces or catch the latest from artists.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/social/spaces"
              className="rounded-full bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-dark"
            >
              Explore MM Spaces
            </Link>
            <Link
              href="/music"
              className="rounded-full border border-brand-border px-5 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:border-brand-primary"
            >
              Browse Music
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
