import Link from "next/link";
import type { StoreProduct } from "@/types";
import { discountPercent, formatCents, resolvedPrice } from "./pricing";

export default function ProductCard({ product }: { product: StoreProduct }) {
  const price = resolvedPrice(product);
  const off = discountPercent(product);

  return (
    <Link
      href={`/store/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-brand-border bg-black/30 transition-colors hover:border-brand-primary"
    >
      <div className="relative aspect-square overflow-hidden bg-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image_url || "/logo/logo.png"}
          alt={product.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {off > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-brand-primary px-2 py-1 text-xs font-bold text-black">
            -{off}%
          </span>
        )}
        {product.is_featured && off === 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-brand-accent px-2 py-1 text-xs font-bold text-black">
            Featured
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-xs uppercase tracking-wide text-text-secondary">
          {product.category}
        </p>
        <h3 className="font-semibold leading-tight group-hover:text-brand-primary">
          {product.name}
        </h3>
        <div className="mt-auto flex items-center gap-2 pt-2">
          <span className="font-bold text-brand-primary">
            {formatCents(price)}
          </span>
          {product.sale_price != null && product.sale_price < product.price && (
            <span className="text-sm text-text-secondary line-through">
              {formatCents(product.price)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
