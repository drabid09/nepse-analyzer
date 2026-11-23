import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[22px] bg-card border border-line p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-[19px] font-semibold tracking-tight">{children}</h2>
      {sub ? <p className="text-[13px] text-muted mt-1 leading-snug">{sub}</p> : null}
    </div>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "up" | "down" | "warn" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "warn" ? "text-warn" : "";
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted uppercase tracking-wide">{label}</div>
      <div className={`num text-[22px] font-semibold tracking-tight mt-1 truncate ${color}`}>{value}</div>
      {note ? <div className="text-[12px] text-faint mt-0.5">{note}</div> : null}
    </div>
  );
}

export function Change({ value, digits = 2 }: { value: number | null; digits?: number }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-faint">—</span>;
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted";
  return <span className={`num ${tone}`}>{value > 0 ? "+" : ""}{value.toFixed(digits)}%</span>;
}

const CALL_STYLE: Record<string, string> = {
  buy: "bg-up-soft text-up",
  hold: "bg-soft text-muted",
  sell: "bg-down-soft text-down",
  avoid: "bg-warn-soft text-warn",
};

export function CallBadge({ call, dataOk = true, large = false }: { call: string; dataOk?: boolean; large?: boolean }) {
  const label = !dataOk ? "No call" : call === "avoid" ? "No call" : call[0].toUpperCase() + call.slice(1);
  const style = !dataOk ? CALL_STYLE.avoid : CALL_STYLE[call] ?? CALL_STYLE.hold;
  return (
    <span className={`inline-flex items-center rounded-full font-semibold ${style} ${large ? "px-4 py-1.5 text-[17px]" : "px-2.5 py-0.5 text-[12px]"}`}>
      {label}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "up" | "down" | "warn" | "accent" }) {
  const style = {
    neutral: "bg-soft text-muted",
    up: "bg-up-soft text-up",
    down: "bg-down-soft text-down",
    warn: "bg-warn-soft text-warn",
    accent: "bg-accent-soft text-accent",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${style}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[14px] text-muted py-6 text-center">{children}</p>;
}

export function Trend({ value }: { value: string | null }) {
  if (!value) return <span className="text-faint">—</span>;
  const icon = value === "up" ? "↗" : value === "down" ? "↘" : "→";
  const tone = value === "up" ? "text-up" : value === "down" ? "text-down" : "text-muted";
  return <span className={tone}>{icon} {value}</span>;
}

export function ScoreBar({ score }: { score: number }) {
  const tone = score >= 65 ? "bg-up" : score <= 35 ? "bg-down" : "bg-faint";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-soft overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
      </div>
      <span className="num text-[13px] text-muted">{score}</span>
    </div>
  );
}
