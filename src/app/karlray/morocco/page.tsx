import { redirect } from "next/navigation";
import { MOROCCO_SUPPORT_URL } from "@/lib/karlray";

// The Morocco trip-updates feed that lived here was removed on 2026-11-17 at
// Karl's request: /morocco (public/morocco.html) is the one trip page. This
// route stays only to forward links already shared, and the "Follow my
// Christmas trip" button on /karlray, so nobody lands on a 404.
export default function MoroccoTripRedirect() {
  redirect(MOROCCO_SUPPORT_URL);
}
