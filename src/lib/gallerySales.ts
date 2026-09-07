// Gallery print sales: OFF.
//
// Karl, 2026-09-07: "The gallery is just that, I dont want to sell anything.
// I will put things in place later when our memberships are up."
//
// So this is a switch, not a demolition. The Snappd instant-print machinery
// stays exactly as built — the Stripe Connect destination charges, the
// platform/photographer split in /api/gallery/checkout, the post-purchase
// download route, the for_sale and price_cents columns, and everything in the
// studio that writes them. Nothing is deleted; nothing is reachable.
//
// Switched off at the DATA layer rather than by hiding buttons. /gallery/[slug]
// stops putting for_sale and price_cents into the props it ships to the
// browser, so a price is not merely invisible in the DOM — it never leaves the
// server. The checkout route refuses for the same reason: an endpoint that
// nothing links to is still an endpoint.
//
// Flip this to true when memberships are up and the whole thing returns.
export const GALLERY_SALES_ENABLED = false;
