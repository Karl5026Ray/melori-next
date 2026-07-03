"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoreProduct } from "@/types";
import { useCart } from "../CartProvider";
import { resolvedPrice } from "../pricing";

export default function AddToCart({ product }: { product: StoreProduct }) {
  const { addItem } = useCart();
  const router = useRouter();
  const sizes = (product.sizes ?? "One Size")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const [size, setSize] = useState(sizes[0] ?? "One Size");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const outOfStock = product.inventory <= 0;

  function add() {
    addItem({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      image_url: product.image_url,
      unitPrice: resolvedPrice(product),
      size,
      quantity,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  return (
    <div className="flex flex-col gap-5">
      {sizes.length > 1 && (
        <div>
          <p className="mb-2 text-sm font-medium text-text-secondary">Size</p>
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={`rounded-md border px-4 py-2 text-sm transition-colors ${
                  size === s
                    ? "border-brand-primary bg-brand-primary text-black"
                    : "border-brand-border text-text-primary hover:border-brand-primary"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-text-secondary">Quantity</p>
        <div className="inline-flex items-center rounded-md border border-brand-border">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="px-4 py-2 text-lg hover:text-brand-primary"
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span className="w-10 text-center">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            className="px-4 py-2 text-lg hover:text-brand-primary"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={add}
          disabled={outOfStock}
          className="flex-1 rounded-md bg-brand-primary px-6 py-3 font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {outOfStock ? "Out of stock" : added ? "Added ✓" : "Add to cart"}
        </button>
        <button
          type="button"
          onClick={() => {
            add();
            router.push("/store/cart");
          }}
          disabled={outOfStock}
          className="flex-1 rounded-md border border-brand-primary px-6 py-3 font-semibold text-brand-primary transition-colors hover:bg-brand-primary hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          Buy now
        </button>
      </div>

      <p className="text-sm text-text-secondary">
        Free shipping on orders over $50.
      </p>
    </div>
  );
}
