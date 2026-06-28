import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-brand-border bg-brand-background">
      <div className="max-w-6xl mx-auto px-6 py-12 grid gap-8 md:grid-cols-3 items-start">
        {/* Brand */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Image src="/logo/logo.png" alt="MELORI Music" width={32} height={32} />
            <span className="font-bold tracking-wide">MELORI MUSIC</span>
          </div>
          <p className="text-sm text-text-secondary">
            High-quality music, delivered digitally.
          </p>
        </div>

        {/* Links */}
        <div className="flex flex-col gap-2 text-sm">
          <Link href="#" className="text-text-secondary hover:text-brand-primary transition-colors">
            Privacy
          </Link>
          <Link href="#" className="text-text-secondary hover:text-brand-primary transition-colors">
            Terms
          </Link>
          <Link href="#" className="text-text-secondary hover:text-brand-primary transition-colors">
            Support
          </Link>
        </div>

        {/* QR placeholder — no QR exists on current live site; Karl to provide */}
        <div className="flex flex-col items-start gap-2">
          <div className="w-[120px] h-[120px] rounded-lg border border-brand-border bg-brand-surface flex items-center justify-center text-xs text-text-secondary text-center px-2">
            QR coming soon
          </div>
        </div>
      </div>
      <div className="border-t border-brand-border">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-text-secondary flex flex-col sm:flex-row justify-between gap-1">
          <span>© 2026 MELORI MUSIC. All rights reserved.</span>
          <span>Karl Ray | Founder</span>
        </div>
      </div>
    </footer>
  );
}
