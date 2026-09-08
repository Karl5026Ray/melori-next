import { redirect } from "next/navigation";

// The merch store was removed from Melori entirely. Redirect home.
export default function StorePage() {
    redirect("/");
}
