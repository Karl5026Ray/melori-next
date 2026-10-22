import Link from "next/link";
import type { Metadata } from "next";
import ChannelLinks from "@/components/ChannelLinks";
import ShareButton from "@/components/ShareButton";
import { LINKS_PATH } from "@/lib/channels";
import { BOOKS_URL, KARL_PROFILE_PATH } from "@/lib/karlray";
import { SITE_URL } from "@/lib/site";

// Karl's channel links (2026-10-22). Public on purpose (PUBLIC_EXACT in
// src/proxy.ts): it is the one link on his Facebook profile. Static — no
// data, so no `no-store` for iOS wrappers to drop (see src/proxy.ts).

const description = "Every show by Karl Ray in one place: series, kids' shows, cooking and his photo and video work.";

export const metadata: Metadata = {
  title: "Karl Ray Channels",
  description,
  alternates: { canonical: `${SITE_URL}${LINKS_PATH}` },
  openGraph: { title: "Karl Ray Channels", description, images: ["/images/og-image.png"] },
};

export default function LinksPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <div className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-10 sm:px-6">
        <header className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-bold sm:text-4xl">Karl Ray Channels</h1>
          <p className="text-text-secondary">Music · Film · Photography · Books</p>
          <div className="mt-2">
            <ShareButton
              url={`${SITE_URL}${LINKS_PATH}`}
              title="Karl Ray Channels"
              text="Every show by Karl Ray in one place."
              label="Share this page"
            />
          </div>
        </header>

        <ChannelLinks />

        <div className="grid gap-3 sm:grid-cols-2">
          <a
            href={BOOKS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-brand-border bg-brand-surface px-5 py-4 text-center font-bold hover:border-brand-primary"
          >
            Get the Books
          </a>
          <Link
            href={KARL_PROFILE_PATH}
            className="rounded-2xl border border-brand-border bg-brand-surface px-5 py-4 text-center font-bold hover:border-brand-primary"
          >
            About Karl Ray
          </Link>
        </div>
      </div>
    </div>
  );
}
