import { redirect } from "next/navigation";

// The mission moved into Karl's profile (2026-10-17): "replace the mission
// statement and place the mission within my introduction page." Kept as a
// redirect, not deleted: /mission is in old shares, and /about (next.config.js)
// still points here.
export default function MissionPage() {
  redirect("/karlray#mission");
}
