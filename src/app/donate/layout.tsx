// Donate route metadata.
// WAS BROKEN: donate/page.tsx is a "use client" component, so its page title
// fell back to the generic site default ("MELORI MUSIC") — client components
// cannot export the Next.js `metadata` object.
// FIX: a server-side layout for the /donate segment supplies a descriptive
// title + description without changing the page's client behavior.

import type { Metadata } from "next";

export const metadata: Metadata = {
title: "Donate — MELORI MUSIC",
description:
"Support MELORI Music. Every contribution helps pay artists, build new features, and keep independent music thriving.",
};

export default function DonateLayout({
children,
}: {
children: React.ReactNode;
}) {
return children;
}
