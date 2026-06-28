import Image from "next/image";
import Link from "next/link";

const navLinks = [
  { label: "Music", href: "/music" },
  { label: "Artists", href: "/artists" },
  { label: "Membership", href: "#" },
  { label: "About", href: "#" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-40 bg-brand-background/90 backdrop-blur border-b border-brand-border">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo/logo.png"
            alt="MELORI Music"
            width={36}
            height={36}
            priority
          />
          <span className="font-bold tracking-wide">MELORI MUSIC</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-text-secondary hover:text-brand-primary transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
