// Bare /social had no page (404). Redirect it to the social home (profile) so
// the section has a sensible landing entry point.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function SocialIndexPage() {
  redirect("/social/profile");
}
