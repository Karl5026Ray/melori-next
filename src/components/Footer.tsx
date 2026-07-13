import Image from "next/image";
import Link from "next/link";

const footerLinks = [
  { label: "Music", href: "/music" },
  { label: "Mission", href: "/mission" },
  { label: "Membership", href: "/membership" },
  { label: "Donate", href: "/donate" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Support", href: "/support" },
];

export default function Footer() {
  return (
    <footer className="border-t border-brand-border bg-brand-background">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Image src="/logo/logo.png" alt="MELORI Music" width={32} height={32} />
          <span className="font-bold tracking-wide">MELORI MUSIC</span>
        </div>

        {/* Links */}
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {footerLinks.map((link, i) => (
<span key={link.label} className="flex items-center gap-x-2">
{i > 0 && (
<span aria-hidden="true" className="text-text-secondary/40 select-none">·</span>
)}
<Link
href={link.href}
className="text-text-secondary transition-colors hover:text-brand-primary"
>
{link.label}
</Link>
</span>
))}
        </nav>
      </div>

      <div className="border-t border-brand-border">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-text-secondary">
          © 2026 MELORI MUSIC. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
