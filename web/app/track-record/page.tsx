import type { Metadata } from "next";
import { Setup, Unavailable } from "@/components/states";
import { Card, Empty, Stat, Title } from "@/components/ui";
import * as data from "@/lib/data";
import { configured } from "@/lib/db";
import { day, num, pct, whole } from "@/lib/format";

export const revalidate = 300;
export const metadata: Metadata = { title: "Track record" };

const LABEL: Record<string, string> = { "1W": "1 week", "1M": "1 month", "3M": "3 months" };

export default async function TrackRecordPage() {
  if (!configured()) return <Setup />;
  try {
    const [tests, record] = await Promise.all([data.marketBacktests(), data.liveRecord()]);
    const calls = ["buy", "hold", "sell", "all"].map((v) => tests.find((t) => t.name === "call_next_21_days" && t.variant === v)).filter(Boolean) as data.Backtest[];
    const strategy = tests.find((t) => t.name === "signal" && t.kind === "strategy");
    const ranges = (h: string) => ["ensemble", "random_walk", "trend", "mean_reversion"].map((m) => tests.find((t) => t.kind === "forecast" && t.name === m && t.variant === h)).filter(Boolean) as data.Backtest[];
    const live = ["1W", "1M", "3M"].map((h) => {
      const r = record.find((x) => x.horizon === h);
      const n = num(r?.checked) ?? 0;
      return { h, n, inside: n ? (100 * (num(r?.inside) ?? 0)) / n : null };
    });
    const period = calls[0] ? `${day(calls[0].period_start)} to ${day(calls[0].period_end)}` : "";

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">Track record</h1>
          <p className="text-[15px] text-muted mt-1 max-w-[720px] leading-relaxed">
            How the same rules would have done on real NEPSE history ({period}), using only data available on each day, and how the published price ranges are doing since they started. Recomputed every Saturday.
          </p>
        </div>

        <Card>
          <Title sub="Average price change over the next 21 trading days (about a month), before costs">What followed each call</Title>
          {calls.length ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {calls.map((t) => (
                <div key={t.variant} className="rounded-2xl bg-soft px-4 py-3">
                  <div className="text-[12px] text-muted uppercase tracking-wide">{t.variant === "all" ? "All calls" : `After ${t.variant}`}</div>
                  <div className={`num text-[24px] font-semibold mt-1 ${(t.avg_gain_pct ?? 0) >= 0 ? "text-up" : "text-down"}`}>{pct(t.avg_gain_pct, 2)}</div>
                  <div className="text-[12px] text-faint">rose {t.hit_rate !== null ? Math.round(t.hit_rate * 100) : "—"}% of the time · {whole(t.sample_size)} calls</div>
                </div>
              ))}
            </div>
          ) : <Empty>The first backtest has not run yet.</Empty>}
          <p className="text-[14px] text-muted mt-4 leading-relaxed">
            Read it plainly: buy calls were followed by somewhat better returns than average, a small and consistent edge. Sell calls were not followed by falls, so treat a sell call as &quot;weak relative to others&quot;, not &quot;will drop&quot;. A month&apos;s swing of the whole market is usually larger than this edge.
          </p>
        </Card>

        <Card>
          <Title sub="Buy the day after a buy call; sell at the stop loss, the first target, a sell call, or after 63 trading days. 0.75% costs per round trip and 5% capital gains tax deducted.">Following the buy calls</Title>
          {strategy ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Trades" value={whole(strategy.sample_size)} />
              <Stat label="Profitable" value={strategy.hit_rate !== null ? `${Math.round(strategy.hit_rate * 100)}%` : "—"} />
              <Stat label="Average gain" value={pct(strategy.avg_gain_pct, 1)} tone="up" />
              <Stat label="Average loss" value={pct(strategy.avg_loss_pct, 1)} tone="down" />
            </div>
          ) : <Empty>Not available yet.</Empty>}
          <p className="text-[14px] text-muted mt-4">Roughly break-even after costs: the calls help rank companies, they do not make money on their own.</p>
        </Card>

        <Card>
          <Title sub="How often the outcome landed inside the 80% range, and how far the middle estimate missed on average">Price ranges in the backtest</Title>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-[14px]">
              <thead className="text-[12px] text-muted text-left"><tr><th className="px-2 py-2 font-normal">Horizon</th><th className="px-2 py-2 font-normal">Model</th><th className="px-2 py-2 font-normal text-right">Tests</th><th className="px-2 py-2 font-normal text-right">Inside range</th><th className="px-2 py-2 font-normal text-right">Average miss</th></tr></thead>
              <tbody>
                {["1W", "1M", "3M"].flatMap((h) => ranges(h).map((t) => (
                  <tr key={h + t.name} className={`border-t border-line ${t.name === "ensemble" ? "font-medium" : "text-muted"}`}>
                    <td className="px-2 py-2">{LABEL[h]}</td>
                    <td className="px-2 py-2">{t.name === "ensemble" ? "Published (blend)" : t.name === "random_walk" ? "No change" : t.name === "trend" ? "Recent trend" : "Back to the 50-day average"}</td>
                    <td className="px-2 py-2 text-right num">{whole(t.sample_size)}</td>
                    <td className="px-2 py-2 text-right num">{t.band_coverage_pct !== null ? `${t.band_coverage_pct.toFixed(0)}%` : "—"}</td>
                    <td className="px-2 py-2 text-right num">{pct(t.mae_pct, 1, false)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <p className="text-[14px] text-muted mt-4">The ranges hold about 4 times in 5, as designed: use them for how far a price can realistically move. The middle estimate is no better than &quot;no change&quot;.</p>
        </Card>

        <Card>
          <Title sub="Every published 1-week, 1-month and 3-month range is checked against the real price on its date">Live record since launch</Title>
          <div className="grid grid-cols-3 gap-4">
            {live.map((l) => (
              <Stat key={l.h} label={LABEL[l.h]} value={l.n ? `${l.inside!.toFixed(0)}% inside` : "—"} note={l.n ? `${l.n} ranges checked` : "first results after the target date"} />
            ))}
          </div>
        </Card>
      </div>
    );
  } catch (e) {
    return <Unavailable error={e} />;
  }
}
