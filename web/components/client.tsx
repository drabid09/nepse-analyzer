"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

/** Re-reads the page from the server every minute during trading hours, every 10 minutes otherwise. */
export function AutoRefresh({ open }: { open: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, open ? 60_000 : 600_000);
    return () => clearInterval(id);
  }, [open, router]);
  return null;
}

export function Nav() {
  const path = usePathname();
  const items = [
    ["/", "Market"],
    ["/signals", "Signals"],
    ["/track-record", "Track record"],
    ["/health", "Data health"],
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto -mx-1 px-1">
      {items.map(([href, label]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[14px] ${active ? "bg-ink text-bg font-medium" : "text-muted hover:text-ink"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SearchBox({ companies }: { companies: { symbol: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const starts = companies.filter((c) => c.symbol.toLowerCase().startsWith(term));
    const rest = companies.filter((c) => !c.symbol.toLowerCase().startsWith(term) && (c.symbol.toLowerCase().includes(term) || c.name.toLowerCase().includes(term)));
    return [...starts, ...rest].slice(0, 8);
  }, [q, companies]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className="relative w-full sm:w-64">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) { router.push(`/c/${results[0].symbol}`); setQ(""); setOpen(false); }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search a company or symbol"
        aria-label="Search a company or symbol"
        className="w-full rounded-full bg-soft px-4 py-2 text-[14px] outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/40"
      />
      {open && results.length > 0 ? (
        <ul className="absolute z-20 mt-2 w-full rounded-2xl border border-line bg-card shadow-lg overflow-hidden">
          {results.map((c) => (
            <li key={c.symbol}>
              <Link href={`/c/${c.symbol}`} onClick={() => { setQ(""); setOpen(false); }} className="block px-4 py-2.5 hover:bg-soft">
                <span className="font-semibold text-[14px]">{c.symbol}</span>
                <span className="block text-[12px] text-muted truncate">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
