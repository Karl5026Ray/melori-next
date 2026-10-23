import { CHANNELS, channelImage, channelUrl, type Channel } from "@/lib/channels";

const GROUPS: Channel["group"][] = ["Main", "Series", "For kids", "My work"];

// Each row is one tap target: thumbnail, show name, one line, the handle.
// Plain <a> with target=_blank — these leave the site for YouTube.
export default function ChannelLinks({ showGroups = true }: { showGroups?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      {GROUPS.map((group) => {
        const items = CHANNELS.filter((c) => c.group === group);
        if (!items.length) return null;
        return (
          <section key={group} aria-label={group}>
            {showGroups && (
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-text-secondary">
                {group}
              </h3>
            )}
            <ul className="flex flex-col gap-3">
              {items.map((c) => (
                <li key={c.handle}>
                  <a
                    href={channelUrl(c)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${c.name} on YouTube`}
                    className="group grid grid-cols-[56px_1fr_auto] items-center gap-3 rounded-2xl border border-brand-border bg-brand-surface p-2.5 pr-4 transition-colors hover:border-brand-primary active:scale-[0.99] sm:grid-cols-[64px_1fr_auto]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={channelImage(c)}
                      alt=""
                      width={64}
                      height={64}
                      loading="lazy"
                      className="h-14 w-14 rounded-xl object-cover sm:h-16 sm:w-16"
                    />
                    <span className="min-w-0">
                      <span className="block font-bold leading-tight">{c.name}</span>
                      <span className="block text-sm text-text-secondary">{c.blurb}</span>
                      <span className="block truncate text-xs text-brand-primary">@{c.handle}</span>
                    </span>
                    <span className="rounded-lg bg-brand-primary px-3 py-1.5 text-sm font-bold text-white group-hover:bg-brand-primary-dark">
                      Watch
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
