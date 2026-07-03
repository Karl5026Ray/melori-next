"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  useCanParticipate,
  UpgradePrompt,
} from "@/components/social/UpgradePrompt";
import { authFetch } from "@/lib/authClient";
import {
  ArrowLeft,
  Headphones,
  MessageCircle,
  Mic,
  Radio,
} from "lucide-react";
import Link from "next/link";

const spaceTypes = [
  {
    id: "listening",
    label: "Listening",
    icon: Headphones,
    desc: "Play music together",
  },
  {
    id: "discussion",
    label: "Discussion",
    icon: MessageCircle,
    desc: "Talk about music",
  },
  { id: "creation", label: "Creation", icon: Mic, desc: "Show your process" },
  { id: "dj_set", label: "DJ Set", icon: Radio, desc: "Live mixing" },
];

export default function CreateSpacePage() {
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [type, setType] = useState("listening");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      router.push("/social/auth");
      return;
    }

    setIsSubmitting(true);
    setError("");

    // Server independently enforces Superfan+ on this endpoint (403 otherwise).
    const res = await authFetch("/api/social/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, topic, type }),
    });

    if (res.ok) {
      const { space } = await res.json();
      router.push(`/social/spaces/${space.id}`);
      return;
    }

    if (res.status === 403) {
      router.push("/membership");
      return;
    }

    const data = await res.json().catch(() => ({}));
    setError(data?.error ?? "Could not create the space. Please try again.");
    setIsSubmitting(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 animate-fade-in">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/social/spaces"
            className="p-2 hover:bg-melori-elevated rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h2 className="text-2xl font-bold">Start a Space</h2>
        </div>

        {user && !canParticipate ? (
          <UpgradePrompt action="start a Space" />
        ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm text-melori-muted mb-2">
              Space Title
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Late Night Beat Breakdown"
              className="w-full bg-melori-elevated border border-melori-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
            />
          </div>

          <div>
            <label className="block text-sm text-melori-muted mb-2">
              Topic / Genre
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., Trap Production, Neo-Soul"
              className="w-full bg-melori-elevated border border-melori-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
            />
          </div>

          <div>
            <label className="block text-sm text-melori-muted mb-3">Type</label>
            <div className="grid grid-cols-2 gap-3">
              {spaceTypes.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={`text-left p-4 rounded-xl border transition ${
                      type === t.id
                        ? "border-melori-purple bg-melori-purple/10"
                        : "border-melori-border hover:border-melori-purple/30"
                    }`}
                  >
                    <Icon
                      className={`w-5 h-5 mb-2 ${
                        type === t.id
                          ? "text-melori-purple"
                          : "text-melori-muted"
                      }`}
                    />
                    <p className="font-medium text-sm">{t.label}</p>
                    <p className="text-xs text-melori-muted mt-1">{t.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Going Live..." : "Go Live"}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
