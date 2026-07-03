"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "./CartProvider";

export default function StoreNav() {
  const { count } = useCart();

  return (
    <div className="border-b border-brand-border bg-brand-background/80 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link
          href="/store"
          className="font-bold tracking-wide text-brand-primary"
        >
          MELORI STORE
        </Link>
        <Link
          href="/store/cart"
          className="relative flex items-center gap-2 text-sm text-text-secondary hover:text-brand-primary transition-colors"
          aria-label="View cart"
        >
          <ShoppingBag className="h-5 w-5" />
          <span className="hidden sm:inline">Cart</span>
          {count > 0 && (
            <span className="absolute -top-2 -right-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-primary px-1 text-xs font-bold text-black">
              {count}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
