"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function usePresence(channelName: string) {
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  useEffect(() => {
    const channel = supabase.channel(channelName, {
      config: { presence: { key: "" } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineUsers(Object.keys(state));
      })
      .on("presence", { event: "join" }, ({ key }) => {
        setOnlineUsers((prev) => [...new Set([...prev, key])]);
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        setOnlineUsers((prev) => prev.filter((id) => id !== key));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName]);

  return onlineUsers;
}
