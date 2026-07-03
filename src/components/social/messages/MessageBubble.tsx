import { Message } from "@/types/social";
import { formatTimeAgo } from "@/lib/social";

export function MessageBubble({
  message,
  isMe,
}: {
  message: Message;
  isMe: boolean;
}) {
  return (
    <div
      className={`flex ${
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
          <p>{message.content}</p>
          <span
            className={`text-[10px] mt-1 block text-right ${
              isMe ? "text-white/60" : "text-melori-muted"
            }`}
          >
            {formatTimeAgo(message.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
