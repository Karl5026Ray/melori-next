import { redirect } from "next/navigation";

// Paid membership tiers were removed from Melori entirely; the platform is
// free. Redirect home.
export default function MembershipPage() {
    redirect("/");
}
