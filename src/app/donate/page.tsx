import { redirect } from "next/navigation";

// Donations were removed from Melori entirely. This page now redirects home.
export default function DonatePage() {
    redirect("/");
}
