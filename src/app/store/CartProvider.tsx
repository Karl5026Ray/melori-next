"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CartLine } from "@/types";

const STORAGE_KEY = "melori_store_cart";
const FREE_SHIPPING_THRESHOLD = 5000; // $50.00 in cents
const SHIPPING_RATE = 500; // $5.00 in cents

interface CartContextValue {
  items: CartLine[];
  addItem: (line: CartLine) => void;
  removeItem: (productId: string, size: string) => void;
  updateQuantity: (productId: string, size: string, quantity: number) => void;
  clear: () => void;
  count: number;
  subtotal: number;
  shipping: number;
  total: number;
}

const CartContext = createContext<CartContextValue | null>(null);

function sameLine(a: CartLine, productId: string, size: string) {
  return a.productId === productId && a.size === size;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load once on mount (client-only) to avoid SSR hydration mismatches.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw) as CartLine[]);
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage may be unavailable (private mode) — cart still works in-memory */
    }
  }, [items, hydrated]);

  const addItem = useCallback((line: CartLine) => {
    setItems((prev) => {
      const idx = prev.findIndex((p) => sameLine(p, line.productId, line.size));
      if (idx === -1) return [...prev, line];
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        quantity: next[idx].quantity + line.quantity,
      };
      return next;
    });
  }, []);

  const removeItem = useCallback((productId: string, size: string) => {
    setItems((prev) => prev.filter((p) => !sameLine(p, productId, size)));
  }, []);

  const updateQuantity = useCallback(
    (productId: string, size: string, quantity: number) => {
      setItems((prev) =>
        prev
          .map((p) =>
            sameLine(p, productId, size)
              ? { ...p, quantity: Math.max(0, quantity) }
              : p
          )
          .filter((p) => p.quantity > 0)
      );
    },
    []
  );

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((n, i) => n + i.quantity, 0);
    const subtotal = items.reduce((n, i) => n + i.unitPrice * i.quantity, 0);
    const shipping =
      subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_RATE;
    return {
      items,
      addItem,
      removeItem,
      updateQuantity,
      clear,
      count,
      subtotal,
      shipping,
      total: subtotal + shipping,
    };
  }, [items, addItem, removeItem, updateQuantity, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
