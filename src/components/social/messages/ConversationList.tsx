"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatTimeAgo } from "@/lib/social";
import { useAuth } from "@/components/social/providers/AuthProvider";

export function ConversationList({
  conversations,
}: {
  conversations: any[];
}) {
  const pathname = usePathname();
  const { user } = useAuth();

  if (conversations.length === 0) {
    return (
      <div className="text-center py-8 text-melori-muted text-sm">
        No conversations yet
      </div>
    );
  }

  return (
    <>
      {conversations.map((conv) => {
        const otherMember = conv.members?.find(
          (m: any) => m.user?.id !== user?.id
        )?.user;
        const lastMessage = conv.messages?.[0];
        const isActive = pathname === `/social/messages/${conv.id}`;

        return (
          <Link
            key={conv.id}
            href={`/social/messages/${conv.id}`}
            className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition ${
              isActive ? "bg-melori-purple/5" : "hover:bg-melori-elevated"
            }`}
          >
            <div className="relative">
              <img
                src={otherMember?.avatar_url || "/favicon.png"}
                className="w-12 h-12 rounded-full object-cover"
                alt={otherMember?.display_name}
              />
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-melori-success rounded-full border-2 border-melori-void" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <h4 className="font-medium text-sm truncate">
                  {otherMember?.display_name || "Unknown"}
                </h4>
                <span className="text-xs text-melori-muted">
                  {lastMessage ? formatTimeAgo(lastMessage.created_at) : ""}
                </span>
              </div>
              <p className="text-sm text-melori-muted truncate">
                {lastMessage?.content || "No messages yet"}
              </p>
            </div>
          </Link>
        );
      })}
    </>
  );
}
