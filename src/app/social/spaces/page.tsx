import { supabase } from "@/lib/supabase";
import { SpaceCard } from "@/components/social/spaces/SpaceCard";
import { Plus, Radio } from "lucide-react";
import Link from "next/link";

export const revalidate = 30;

async function getSpaces() {
  const { data, error } = await supabase
    .from("spaces")
    .select(
      `
      *,
      host:profiles(id, display_name, avatar_url, role, verified)
    `
    )
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Error fetching spaces:", error);
    return [];
  }

  return data || [];
}

export default async function SpacesPage() {
  const spaces = await getSpaces();

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 animate-fade-in">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold mb-1">
              Active Spaces
            </h2>
            <p className="text-melori-muted text-sm">
              Join the conversation. No algorithms. Just music.
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

        {spaces.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-melori-elevated flex items-center justify-center mx-auto mb-4">
              <Radio className="w-10 h-10 text-melori-muted" />
            </div>
            <h3 className="text-xl font-bold mb-2">No active spaces</h3>
            <p className="text-melori-muted mb-6">
              Be the first to start a conversation.
            </p>
            <Link
              href="/social/spaces/create"
              className="btn-primary px-6 py-3 rounded-full font-semibold text-sm inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Start a Space
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
