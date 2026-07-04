import { supabase } from "@/lib/supabase";
import { SpaceCard } from "@/components/social/spaces/SpaceCard";
import { Plus, Radio, CalendarClock } from "lucide-react";
import Link from "next/link";

export const revalidate = 30;

type Tab = "live" | "scheduled";

async function getSpaces(tab: Tab) {
  const query = supabase
    .from("spaces")
    .select(
      `
      *,
      host:profiles(id, display_name, avatar_url, role, verified)
    `,
    )
    .eq("status", tab === "scheduled" ? "scheduled" : "live")
    .order(tab === "scheduled" ? "scheduled_at" : "created_at", {
      ascending: tab === "scheduled",
    })
    .limit(50);

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching spaces:", error);
    return [];
  }

  return data || [];
}

interface PageProps {
  searchParams?: { tab?: string };
}

export default async function SpacesPage({ searchParams }: PageProps) {
  const tab: Tab = searchParams?.tab === "scheduled" ? "scheduled" : "live";
  const spaces = await getSpaces(tab);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 animate-fade-in">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold mb-1">
              {tab === "scheduled" ? "Scheduled Spaces" : "Active Spaces"}
            </h2>
            <p className="text-melori-muted text-sm">
              {tab === "scheduled"
                ? "Rooms opening soon. Set a reminder or join when they go live."
                : "Join the conversation. No algorithms. Just music."}
            </p>
          </div>
          <Link
            href="/social/spaces/create"
            className="btn-primary px-6 py-3 rounded-full font-semibold text-sm flex items-center gap-2 shadow-lg"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Start a Space</span>
          </Link>
        </div>

        <div className="mb-6 flex gap-1 rounded-full border border-melori-border bg-melori-elevated/40 p-1 w-fit">
          <Link
            href="/social/spaces"
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-2 ${
              tab === "live"
                ? "bg-melori-purple text-white shadow"
                : "text-melori-muted hover:text-melori-text"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Live
          </Link>
          <Link
            href="/social/spaces?tab=scheduled"
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-2 ${
              tab === "scheduled"
                ? "bg-melori-purple text-white shadow"
                : "text-melori-muted hover:text-melori-text"
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            Scheduled
          </Link>
        </div>

        {spaces.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-melori-elevated flex items-center justify-center mx-auto mb-4">
              {tab === "scheduled" ? (
                <CalendarClock className="w-10 h-10 text-melori-muted" />
              ) : (
                <Radio className="w-10 h-10 text-melori-muted" />
              )}
            </div>
            <h3 className="text-xl font-bold mb-2">
              {tab === "scheduled"
                ? "Nothing scheduled yet"
                : "No active spaces"}
            </h3>
            <p className="text-melori-muted mb-6">
              {tab === "scheduled"
                ? "Be the first to announce a room."
                : "Be the first to start a conversation."}
            </p>
            <Link
              href="/social/spaces/create"
              className="btn-primary px-6 py-3 rounded-full font-semibold text-sm inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {tab === "scheduled" ? "Schedule a Space" : "Start a Space"}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {spaces.map((space) => (
              <SpaceCard key={space.id} space={space} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
