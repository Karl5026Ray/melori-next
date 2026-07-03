import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { authHeaders } from "@/lib/authClient";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimeAgo(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString();
}

export const AGORA_APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID ?? "";

export interface AgoraTokenResponse {
  token: string;
  uid: number;
  channel: string;
  expiresIn: number;
}

export async function fetchAgoraToken(
  channel: string
): Promise<AgoraTokenResponse> {
  const res = await fetch("/api/agora-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ channel }),
  });
  if (!res.ok) throw new Error("Failed to fetch Agora token");
  return res.json();
}
