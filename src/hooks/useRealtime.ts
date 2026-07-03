"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useRealtime<T>(table: string, filter?: string) {
  const [data, setData] = useState<T[]>([]);

  useEffect(() => {
    supabase
      .from(table)
      .select("*")
      .then(({ data }) => {
        if (data) setData(data as T[]);
      });

    const channel = supabase
      .channel(`${table}-changes`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setData((prev) => [...prev, payload.new as T]);
          } else if (payload.eventType === "DELETE") {
            setData((prev) =>
              prev.filter((item) => (item as any).id !== payload.old.id)
            );
          } else if (payload.eventType === "UPDATE") {
            setData((prev) =>
              prev.map((item) =>
                (item as any).id === payload.new.id ? (payload.new as T) : item
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter]);

  return data;
}
