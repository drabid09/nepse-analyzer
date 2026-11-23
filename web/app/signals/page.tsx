import type { Metadata } from "next";
import { SignalsTable, type Row } from "./SignalsTable";
import { Setup, Unavailable } from "@/components/states";
import { Card, Title } from "@/components/ui";
import * as data from "@/lib/data";
import { configured } from "@/lib/db";
import { change, day, num } from "@/lib/format";

export const revalidate = 60;
export const metadata: Metadata = { title: "Signals" };

export default async function SignalsPage() {
  if (!configured()) return <Setup />;
  try {
    const [c, prices, date] = await Promise.all([data.companies(), data.latestPrices(), data.latestSignalDate()]);
    if (!date) return <Card><Title>Signals</Title><p className="text-muted">No signals yet.</p></Card>;
    const [signals, ranges] = await Promise.all([data.signalsOn(date), data.forecastsOn(date, "1M")]);
    const priceBy = new Map(prices.rows.map((p) => [p.company_id, p]));
    const rangeBy = new Map(ranges.map((r) => [r.company_id, r]));
    const rows: Row[] = signals.map((s) => {
      const co = c.byId.get(s.company_id);
      const p = priceBy.get(s.company_id);
      const r = rangeBy.get(s.company_id);
      return {
        symbol: co?.symbol ?? "?", name: co?.name ?? "", sector: (co?.sector_id && c.sectorName.get(co.sector_id)) || "Other",
        close: num(p?.close ?? s.close), change: p ? change(p.close, p.prev_close) : null, call: s.data_ok ? s.recommendation : "avoid",
        dataOk: s.data_ok, score: s.score, confidence: s.confidence, trend: s.trend_short, rsi: num(s.rsi_14),
        low: num(r?.low), high: num(r?.high), reliable: r?.reliable ?? false, note: s.data_ok ? null : s.data_note,
      };
    });
    const live = prices.rows.some((p) => !p.is_final);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">Signals</h1>
          <p className="text-[15px] text-muted mt-1 max-w-[720px] leading-relaxed">
            Every tradable company, scored 0 to 100 from trend, momentum, strength against the market, RSI and volume, computed from the close of {day(date)}.
            Prices are {live ? "live from today's session" : `from ${day(prices.date)}`}. A call is a ranking, not an instruction: see the track record before acting on one.
          </p>
        </div>
        <SignalsTable rows={rows} />
      </div>
    );
  } catch (e) {
    return <Unavailable error={e} />;
  }
}
