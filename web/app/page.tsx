import Link from "next/link";
import { IntradayLine } from "@/components/charts";
import { Card, Change, Empty, Pill, ScoreBar, Stat, Title } from "@/components/ui";
import * as data from "@/lib/data";
import { configured } from "@/lib/db";
import { Setup, Unavailable } from "@/components/states";
import { YourStocks, type WatchRow } from "@/components/watchlist";
import { change, day, num, price, rupees, whole } from "@/lib/format";
import { statusLine } from "@/lib/market";
import { companyHref } from "@/lib/symbol";
import { VIEWER } from "@/lib/viewer";

export const revalidate = 60;

export default async function MarketPage() {
  if (!configured()) return <Setup />;
  try {
    return await Market();
  } catch (e) {
    return <Unavailable error={e} />;
  }
}

async function Market() {
  const [c, idx, indexInfo, mkt, prices, signalDate, backtests] = await Promise.all([
    data.companies(), data.indexDays(), data.indices(), data.marketDays(2), data.latestPrices(), data.latestSignalDate(), data.marketBacktests(),
  ]);
  const [signals, ranges] = signalDate ? await Promise.all([data.signalsOn(signalDate), data.forecastsOn(signalDate, "1M")]) : [[], []];
  const nepseDay = idx.rows.find((r) => r.index_id === 58);
  const intraday = idx.date ? await data.indexIntraday(58, `${idx.date}T00:00:00+05:45`) : [];
  const today = mkt[0];
  const live = prices.rows.length > 0 && prices.rows.some((p) => !p.is_final);

  const equities = prices.rows.filter((p) => c.byId.get(p.company_id)?.instrument_type === "Equity" && p.prev_close);
  const movers = equities.map((p) => ({ p, ch: change(p.close, p.prev_close) ?? 0 })).sort((a, b) => b.ch - a.ch);
  // Only real gainers and losers: on a broad up day the "losers" list must not fill up with risers.
  const gainers = movers.filter((m) => m.ch > 0).slice(0, 6), losers = movers.filter((m) => m.ch < 0).slice(-6).reverse();

  const rangeBy = new Map(ranges.map((r) => [r.company_id, r]));
  const priceBy = new Map(prices.rows.map((p) => [p.company_id, p]));
  const counts = { buy: 0, hold: 0, sell: 0, avoid: 0 };
  for (const s of signals) counts[(s.data_ok ? s.recommendation : "avoid") as keyof typeof counts]++;
  const strongest = signals.filter((s) => s.data_ok && s.recommendation === "buy").sort((a, b) => b.score - a.score).slice(0, 10);
  const nextMonth = Object.fromEntries(backtests.filter((b) => b.name === "call_next_21_days").map((b) => [b.variant, b]));
  const indexName = new Map(indexInfo.map((i) => [i.id, i.name]));
  const nepseChange = nepseDay ? change(nepseDay.close, nepseDay.prev_close) : null;

  // Every company's latest numbers, for the stars this browser has saved ("Your stocks"). A
  // company that did not trade on the latest day has no price row that day; it still appears,
  // with its last close from the call, so a star never silently disappears.
  const signalBy = new Map(signals.map((s) => [s.company_id, s]));
  const ids = new Set<number>([...prices.rows.map((p) => p.company_id), ...signals.map((s) => s.company_id)]);
  const watchRows: WatchRow[] = [...ids].flatMap((id) => {
    const co = c.byId.get(id);
    if (!co) return [];
    const p = priceBy.get(id), s = signalBy.get(id), r = rangeBy.get(id);
    return [{
      symbol: co.symbol, name: co.name, close: num(p?.close ?? s?.close), change: p ? change(p.close, p.prev_close) : null,
      call: s ? (s.data_ok ? s.recommendation : "avoid") : null, dataOk: s?.data_ok ?? true, score: s ? s.score : null,
      low: num(r?.low), high: num(r?.high), asOf: p ? null : s ? `close of ${day(s.date)}` : null,
    }];
  });

  const status = statusLine({ live, priceDate: prices.date, signalDate, now: new Date() }, day);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">Namaste, {VIEWER}</h1>
          <p className="text-[15px] text-muted mt-1">{status}</p>
        </div>
        <Link href="/guide" className="text-[14px] text-accent">How to read this page →</Link>
      </div>

      <YourStocks rows={watchRows} viewer={VIEWER} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[13px] text-muted">NEPSE Index · {day(idx.date)}{nepseDay && !nepseDay.is_final ? " · live" : ""}</div>
              <div className="num text-[40px] sm:text-[48px] font-semibold tracking-tight leading-tight mt-1">{price(nepseDay?.close)}</div>
              <div className="text-[17px] mt-0.5">
                <Change value={nepseChange} />{" "}
                <span className="text-muted text-[14px] num">{nepseDay?.prev_close ? (() => { const pts = num(nepseDay.close)! - num(nepseDay.prev_close)!; return `(${pts > 0 ? "+" : ""}${pts.toFixed(2)})`; })() : ""}</span>
              </div>
            </div>
            {nepseDay?.high ? (
              <div className="text-right text-[13px] text-muted num">
                <div>High {price(nepseDay.high)}</div>
                <div>Low {price(nepseDay.low)}</div>
              </div>
            ) : null}
          </div>
          <div className="mt-4"><IntradayLine points={intraday} up={(nepseChange ?? 0) >= 0} /></div>
        </Card>

        <Card>
          <Title sub={today ? `${day(today.date)}${today.is_final ? "" : " · so far today"}` : undefined}>Market</Title>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Stat label="Turnover" value={rupees(today?.turnover)} />
            <Stat label="Transactions" value={whole(today?.transactions)} />
            <Stat label="Shares traded" value={whole(today?.traded_shares)} />
            <Stat label="Companies traded" value={whole(today?.scrips_traded)} />
            <Stat label="Advancing" value={whole(today?.advancers)} tone="up" />
            <Stat label="Declining" value={whole(today?.decliners)} tone="down" />
          </div>
        </Card>
      </div>

      <Card>
        <Title sub="Today's change of each NEPSE index">Sectors</Title>
        {idx.rows.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {idx.rows.filter((r) => r.index_id !== 58).sort((a, b) => (change(b.close, b.prev_close) ?? 0) - (change(a.close, a.prev_close) ?? 0)).map((r) => (
              <div key={r.index_id} className="rounded-2xl bg-soft px-4 py-3">
                <div className="text-[12px] text-muted truncate">{(indexName.get(r.index_id) ?? "").replace(/ (Sub)?Index$/i, "")}</div>
                <div className="flex items-baseline justify-between gap-2 mt-0.5">
                  <span className="num text-[15px] font-medium">{price(r.close)}</span>
                  <span className="text-[13px]"><Change value={change(r.close, r.prev_close)} /></span>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>No index data yet.</Empty>}
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Title sub={signalDate ? `Computed from the close of ${day(signalDate)}. Highest scores first.` : undefined}>Strongest buy calls</Title>
          <div className="flex flex-wrap gap-2">
            <Pill tone="up">{counts.buy} buy</Pill><Pill>{counts.hold} hold</Pill><Pill tone="down">{counts.sell} sell</Pill><Pill tone="warn">{counts.avoid} no call</Pill>
          </div>
        </div>
        {nextMonth.buy?.avg_gain_pct != null && nextMonth.all?.avg_gain_pct != null ? (
          <p className="text-[13px] text-muted rounded-2xl bg-accent-soft px-4 py-3 mb-4 leading-relaxed">
            How much to trust a buy call: from {day(nextMonth.buy.period_start)} to {day(nextMonth.buy.period_end)}, stocks rose <b className="text-ink">{nextMonth.buy.avg_gain_pct.toFixed(2)}%</b> on average in the 21 trading days after one,
            against {nextMonth.all.avg_gain_pct.toFixed(2)}% after any call. A small edge, not a promise.
            {nextMonth.sell?.avg_gain_pct != null ? <> After a sell call: {nextMonth.sell.avg_gain_pct.toFixed(2)}%, so a sell call means weaker than others, not a coming fall.</> : null}
            {" "}<Link href="/track-record" className="text-accent underline underline-offset-2">Full track record</Link>
          </p>
        ) : null}
        {strongest.length ? (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-[14px]">
              <thead className="text-[12px] text-muted text-left">
                <tr><th className="px-2 py-2 font-normal">Company</th><th className="px-2 py-2 font-normal text-right">Close</th><th className="px-2 py-2 font-normal text-right">Today</th><th className="px-2 py-2 font-normal">Score</th><th className="px-2 py-2 font-normal hidden sm:table-cell">Confidence</th><th className="px-2 py-2 font-normal text-right hidden md:table-cell">1-month range</th></tr>
              </thead>
              <tbody>
                {strongest.map((s) => {
                  const co = c.byId.get(s.company_id);
                  const p = priceBy.get(s.company_id);
                  const r = rangeBy.get(s.company_id);
                  return (
                    <tr key={s.company_id} className="border-t border-line">
                      <td className="px-2 py-2.5">{co ? <Link href={companyHref(co.symbol)} prefetch={false} className="font-semibold hover:text-accent">{co.symbol}</Link> : "?"}<div className="text-[12px] text-muted truncate max-w-[220px]">{co?.name}</div></td>
                      <td className="px-2 py-2.5 text-right num">{price(p?.close ?? s.close)}</td>
                      <td className="px-2 py-2.5 text-right"><Change value={p ? change(p.close, p.prev_close) : null} /></td>
                      <td className="px-2 py-2.5"><ScoreBar score={s.score} /></td>
                      <td className="px-2 py-2.5 hidden sm:table-cell text-muted capitalize">{s.confidence}</td>
                      <td className="px-2 py-2.5 text-right num text-muted hidden md:table-cell">{r ? `${price(r.low)} – ${price(r.high)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>No buy calls for this day.</Empty>}
        <div className="mt-4 text-right"><Link href="/signals" className="text-[14px] text-accent">All {signals.length} companies →</Link></div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {[["Top gainers", gainers], ["Top losers", losers]].map(([label, list]) => (
          <Card key={label as string}>
            <Title sub={`${live ? "So far today" : day(prices.date)}, shares only`}>{label as string}</Title>
            {(list as typeof movers).length ? (
              <ul className="divide-y divide-line">
                {(list as typeof movers).map(({ p, ch }) => {
                  const co = c.byId.get(p.company_id);
                  return (
                    <li key={p.company_id} className="flex items-center justify-between py-2.5 text-[14px]">
                      <Link href={co ? companyHref(co.symbol) : "/signals"} prefetch={false} className="min-w-0"><span className="font-semibold">{co?.symbol}</span><span className="block text-[12px] text-muted truncate">{co?.name}</span></Link>
                      <span className="text-right"><span className="num block">{price(p.close)}</span><Change value={ch} /></span>
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>No trades yet.</Empty>}
          </Card>
        ))}
      </div>
    </div>
  );
}
