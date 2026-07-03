"use client";

import Link from "next/link";
import { Space } from "@/types/social";
import { Badge } from "@/components/social/ui/Badge";
import { Users, Radio } from "lucide-react";

const typeConfig = {
  listening: { variant: "green" as const, label: "Listening" },
  discussion: { variant: "purple" as const, label: "Discussion" },
  creation: { variant: "pink" as const, label: "Creation" },
  dj_set: { variant: "orange" as const, label: "DJ Set" },
};

export function SpaceCard({ space }: { space: Space }) {
  const type = typeConfig[space.type] || typeConfig.discussion;
  const host = space.host;

  return (
    <Link href={`/social/spaces/${space.id}`}>
      <div className="room-card glass rounded-2xl p-5 border border-melori-border relative overflow-hidden group cursor-pointer h-full flex flex-col">
        <div className="absolute top-4 right-4 flex items-center gap-1.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="text-xs font-medium text-red-400">LIVE</span>
        </div>

        <div className="flex items-start gap-4 mb-4">
          <img
            src={host?.avatar_url || "/favicon.png"}
            className="w-12 h-12 rounded-full border-2 border-melori-purple/30 object-cover"
            alt={host?.display_name || "Host"}
          />
          <div className="flex-1 min-w-0 pr-12">
            <h3 className="font-bold text-lg leading-tight mb-1 group-hover:text-melori-purple transition">
              {space.title}
            </h3>
            <p className="text-xs text-melori-muted mb-2">
              Hosted by{" "}
              <span className="text-melori-text">
                {host?.display_name || "Unknown"}
              </span>
            </p>
            <Badge variant={type.variant}>{type.label}</Badge>
          </div>
        </div>

        <p className="text-sm text-melori-muted mb-4 line-clamp-2 flex-1">
          &ldquo;{space.topic}&rdquo;
        </p>

        <div className="flex items-center justify-between pt-4 border-t border-melori-border mt-auto">
          <div className="flex items-center gap-1.5 text-xs text-melori-muted">
            <Users className="w-3.5 h-3.5" />
            <span>{space.participant_count} listening</span>
          </div>
          <Radio className="w-3.5 h-3.5 text-melori-muted" />
        </div>
      </div>
    </Link>
  );
}
