import { redirect } from "next/navigation";

// /photography used to be a hub that fanned out to Portfolio, Pricing and Book.
// Pricing and Book left with the rest of commerce, which reduced it to a menu
// pointing at one real destination — while its own copy, and its OpenGraph
// description, still offered to "view session pricing".
//
// So it forwards to the work itself. Kept as a redirect rather than deleted:
// it is in the footer of every page ever shared, in the mobile menu, and in
// whatever Karl has already handed to clients.
export default function PhotographyPage() {
  redirect("/gallery");
}
