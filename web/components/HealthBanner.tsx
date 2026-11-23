import Link from "next/link";
import { ago, dateTime } from "@/lib/format";
import type { Freshness } from "@/lib/market";

export function SessionPill({ f }: { f: Freshness }) {
  const label = f.session === "open" ? "Market open" : f.session === "pre-open" ? "Pre-open" : "Market closed";
  const dot = f.problems.length ? "bg-warn" : f.session === "open" ? "bg-up" : "bg-faint";
  return (
    <Link href="/health" className="inline-flex items-center gap-2 text-[13px] text-muted hover:text-ink" title={f.lastUpdate ? `Last update ${dateTime(f.lastUpdate)}` : undefined}>
      <span className={`inline-block h-2 w-2 rounded-full ${dot} ${f.session === "open" && !f.problems.length ? "animate-pulse" : ""}`} />
      <span className="whitespace-nowrap">{label}</span>
      <span className="text-faint whitespace-nowrap">· {ago(f.lastUpdate)}</span>
    </Link>
  );
}

export function HealthBanner({ f }: { f: Freshness }) {
  if (!f.problems.length) return null;
  return (
    <div className="space-y-2 mb-6">
      {f.problems.map((p, i) => (
        <div key={i} className={`rounded-2xl px-4 py-3 text-[14px] ${p.level === "error" ? "bg-down-soft text-down" : "bg-warn-soft text-warn"}`}>
          {p.text} <Link href="/health" className="underline underline-offset-2">Details</Link>
        </div>
      ))}
    </div>
  );
}
