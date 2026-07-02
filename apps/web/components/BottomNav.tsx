"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Home" },
  { href: "/matchmaking", label: "Play" },
  { href: "/history", label: "History" },
] as const;

/** Mobile-first bottom nav (design.md "1. Dashboard": Home / Play / History). */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-arena-border bg-arena-surface/95 py-2 backdrop-blur">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 py-2 text-center text-xs font-semibold uppercase tracking-wide transition ${
              active ? "text-arena-cyan" : "text-slate-400"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
