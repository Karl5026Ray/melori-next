"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Message } from "@/types/social";
import { formatTimeAgo } from "@/lib/social";

export function MessageBubble({
  message,
  isMe,
  onDelete,
}: {
  message: Message;
  isMe: boolean;
  // Called when the sender chooses to delete their own message. Optional so
  // read-only contexts can omit it.
  onDelete?: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isDeleted = !!message.deleted_at;

  return (
    <div
      className={`group flex ${
        isMe ? "justify-end" : "justify-start"
      } animate-slide-up`}
    >
      <div
        className={`flex items-end gap-2 max-w-[75%] ${
          isMe ? "flex-row-reverse" : ""
        }`}
      >
        {!isMe && (
          <img
            src={message.sender?.avatar_url || "/favicon.png"}
            className="w-6 h-6 rounded-full mb-1 object-cover"
            alt={message.sender?.display_name}
          />
        )}
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm ${
            isMe ? "msg-bubble-sent" : "msg-bubble-received"
          }`}
        >
          {isDeleted ? (
            <p className="italic opacity-60">Message deleted</p>
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
          <span
            className={`text-[10px] mt-1 block text-right ${
              isMe ? "text-white/60" : "text-melori-muted"
            }`}
          >
            {formatTimeAgo(message.created_at)}
          </span>
        </div>

        {/* Per-message delete toggle — only on the sender's own, non-deleted
            messages. Appears on hover (desktop) and is always tappable on
            touch. A small confirm step prevents accidental deletes. */}
        {isMe && !isDeleted && onDelete && (
          <div className="mb-1 flex items-center">
            {confirming ? (
              <span className="flex items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => {
                    onDelete(message.id);
                    setConfirming(false);
                  }}
                  className="rounded-full bg-red-600 px-2 py-0.5 font-semibold text-white hover:bg-red-500"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-full bg-melori-elevated px-2 py-0.5 text-melori-muted hover:text-melori-text"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label="Delete message"
                title="Delete message"
                className="rounded-full p-1 text-melori-muted opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
