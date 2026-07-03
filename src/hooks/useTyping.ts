"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useTyping(conversationId: string, currentUserId?: string) {
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const channel = supabase.channel(`typing:${conversationId}`);
    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload.user_id !== currentUserId) {
          setIsTyping(payload.payload.typing);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, currentUserId]);

  return isTyping;
}
