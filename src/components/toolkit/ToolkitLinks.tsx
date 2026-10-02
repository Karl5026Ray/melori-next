"use client";

import { useEffect, useState } from "react";
import { getNativePlatform } from "@/lib/native-app";
import {
  TOOLKIT_DISCLOSURE,
  toolkitRel,
  visibleToolkitItems,
} from "@/lib/toolkit";

// Outbound affiliate links to paid digital services are kept out of the
// native iOS/Android shell (the app IS this website — see tasks/lessons.md).
// Inside the app the page shows a neutral note instead of the cards, so App
// Review never sees a link-out to a subscription.
export default function ToolkitLinks() {
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(getNativePlatform() !== "web");
  }, []);

  if (isNative) {
    return (
      <p className="text-text-secondary text-lg">
        The Artist Toolkit is available on melorimusic.org in your web browser.
      </p>
    );
  }

  const items = visibleToolkitItems();

  return (
    <div>
      <div className="grid gap-6 md:grid-cols-2">
        {items.map((item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel={toolkitRel(item)}
            className="block rounded-2xl border border-brand-border p-6 transition-colors hover:border-brand-primary"
          >
            <p className="text-sm uppercase tracking-wide text-brand-primary mb-2">
              {item.category}
            </p>
            <h2 className="text-2xl font-semibold mb-2">{item.name}</h2>
            <p className="text-text-secondary leading-relaxed">{item.blurb}</p>
            <p className="mt-4 font-semibold text-brand-primary">Visit {item.name} &rarr;</p>
          </a>
        ))}
      </div>
      <p className="mt-10 text-sm text-text-secondary" data-testid="toolkit-disclosure">
        {TOOLKIT_DISCLOSURE}
      </p>
    </div>
  );
}
