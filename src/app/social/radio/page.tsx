import type { Metadata } from "next";
import RadioClient from "@/components/radio/RadioClient";

export const metadata: Metadata = {
  title: "Melori Radio",
  description:
    "Non-stop Melori Radio — every track on the platform in one crossfaded shuffle, plus a personalized For You station.",
};

// The pool is loaded client-side from /api/radio/pool so the "For You" station
// can read the caller's auth token (follows + listen history). The page itself
// is a thin shell; all playback lives in RadioClient.
export default function RadioPage() {
  return <RadioClient />;
}
