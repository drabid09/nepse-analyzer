import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PriceChart, type Bar } from "@/components/charts";
import { Setup, Unavailable } from "@/components/states";
import { StarButton } from "@/components/watchlist";
import { BUILDER } from "@/lib/viewer";
import { CallBadge, Card, Change, Empty, Pill, ScoreBar, Stat, Title, Trend } from "@/components/ui";
import * as data from "@/lib/data";
import { configured } from "@/lib/db";
import { change, day, num, pct, price, rupees, whole } from "@/lib/format";
import { companyHref, parseSymbol } from "@/lib/symbol";

export const revalidate = 60;
// Company pages are rendered on first visit and then served from Vercel's cache like the
// other pages, so a page left open (it refreshes every minute in trading hours) costs a
// cache read, not a fresh render and database reads each time.
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const symbol = parseSymbol((await params).symbol);
  return { title: symbol ?? "Not found" };
}

export default async function CompanyPage({ params }: Props) {
  if (!configured()) return <Setup />;
  const segment = (await params).symbol;
  // Checked before any database read: a made-up address costs no query and no cached page.
  const symbol = parseSymbol(segment);
  if (!symbol) notFound();
  // One address per company: /c/nabil becomes /c/NABIL instead of a second cached copy.
  // Another spelling (lower case, an unencoded slash) goes to the one canonical address.
  if (`/c/${segment}` !== companyHref(symbol)) redirect(companyHref(symbol));
  let company: data.Company | null;
  try {
    company = await data.companyBySymbol(symbol);
  } catch (e) {
    return <Unavailable error={e} />;
  }
  if (!company) notFound();
  try {
    return await Company({ company });
  } catch (e) {
    return <Unavailable error={e} />;
  }
}

function since(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function Company({ company }: { company: data.Company }) {
  const id = company.id;
  const [c, prices, signal, history, backtests, floor, adjustments, issueRows] = await Promise.all([
    data.companies(), data.companyPrices(id, since(1150)), data.companySignal(id), data.companyCallHistory(id, 12), data.companyBacktests(id),
    data.companyFloorsheet(id), data.companyAdjustments(id), data.issues({ company_id: `eq.${id}` }, 10),
  ]);
  const last = prices.at(-1);
  const [forecasts, intraday] = await Promise.all([
    signal ? data.companyForecasts(id, signal.date) : Promise.resolve([]),
    last && !last.is_final ? data.companyIntraday(id, `${last.date}T00:00:00+05:45`) : Promise.resolve([]),
  ]);
  const sector = company.sector_id ? c.sectorName.get(company.sector_id) : null;
  const bars: Bar[] = prices.map((p) => ({ date: p.date, open: num(p.open), high: num(p.high), low: num(p.low), close: num(p.close)!, volume: num(p.volume), adj: num(p.adj_factor) ?? 1 }));
  const close = num(last?.close);
  const strategy = backtests.find((b) => b.kind === "strategy" && b.name === "signal");
  const rangeTests = backtests.filter((b) => b.kind === "forecast");
  const order = { "1W": 0, "1M": 1, "3M": 2 } as Record<string, number>;
  const sortedForecasts = forecasts
    .filter((f) => num(f.low) !== null && num(f.high) !== null && num(f.mid) !== null && num(f.base_close))
    .sort((a, b) => order[a.horizon] - order[b.horizon]);
  const usable = Boolean(signal && signal.data_ok && signal.recommendation !== "avoid");
  // The trade plan (buy zone, targets) belongs to a buy call only. On a hold or sell call it
  // would contradict the call, so those show the levels a holder needs and nothing to buy.
  const buyPlan = usable && signal!.recommendation === "buy";
  const chartLevels = !usable || !signal ? undefined : buyPlan ? signal : { stop_loss: signal.stop_loss };
  const fromClose = (v: number | null | undefined) => (close && v ? pct((Number(v) / close - 1) * 100, 1) : "");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] text-muted">{[sector, company.instrument_type].filter(Boolean).join(" · ")}</div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight leading-tight">{company.symbol}</h1>
          <div className="text-[15px] text-muted">{company.name}</div>
          <div className="mt-2"><StarButton symbol={company.symbol} label /></div>
        </div>
        <div className="text-right">
          <div className="num text-[34px] font-semibold tracking-tight leading-tight">{price(close)}</div>
          <div className="text-[15px]"><Change value={last ? change(last.close, last.prev_close) : null} /></div>
          <div className="text-[12px] text-faint">{last ? `${last.is_final ? "Close" : "Live"} · ${day(last.date)}` : "No trades stored"}</div>
        </div>
      </div>

      <Card>
        {bars.length ? <PriceChart bars={bars} intraday={intraday} levels={chartLevels} /> : <Empty>No price history.</Empty>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-[19px] font-semibold tracking-tight">Call</h2>
              <p className="text-[13px] text-muted mt-1">{signal ? `From the close of ${day(signal.date)}` : "No signal yet"}</p>
            </div>
            {signal ? <CallBadge call={signal.recommendation} dataOk={signal.data_ok} large /> : null}
          </div>
          {signal ? (
            <>
              {!signal.data_ok ? (
                <div className="rounded-2xl bg-warn-soft text-warn px-4 py-3 text-[14px] mb-4">No call: a data check failed for this company. {signal.data_note}</div>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-5">
                <div className="flex items-center gap-2 text-[13px] text-muted">Score <ScoreBar score={signal.score} /></div>
                <div className="text-[13px] text-muted">Confidence <span className="text-ink capitalize">{signal.confidence}</span></div>
              </div>
              {buyPlan ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4 mb-5">
                  <Stat label="Buy zone" value={<span className="text-[17px]">{price(signal.buy_low)} – {price(signal.buy_high)}</span>} />
                  <Stat label="Stop loss" value={<span className="text-[17px]">{price(signal.stop_loss)}</span>} note={fromClose(signal.stop_loss)} tone="down" />
                  <Stat label="Target 1" value={<span className="text-[17px]">{price(signal.take_profit_low)}</span>} note={fromClose(signal.take_profit_low)} tone="up" />
                  <Stat label="Target 2" value={<span className="text-[17px]">{price(signal.take_profit_high)}</span>} note={fromClose(signal.take_profit_high)} tone="up" />
                  <Stat label="Support (20-day low)" value={<span className="text-[17px]">{price(signal.support)}</span>} />
                  <Stat label="Resistance (60-day high)" value={<span className="text-[17px]">{price(signal.resistance)}</span>} />
                </div>
              ) : usable ? (
                <>
                  <p className="text-[13px] text-muted rounded-2xl bg-soft px-4 py-3 mb-4 leading-relaxed">
                    {signal.recommendation === "sell"
                      ? "A sell call: weaker than most companies right now. There is no buy plan. If you hold it, the levels below show where it has support and where to exit."
                      : "A hold call: no new buy plan. If you hold it, the levels below show where it has support and where to exit."}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4 mb-5">
                    <Stat label="Exit if it falls below" value={<span className="text-[17px]">{price(signal.stop_loss)}</span>} note={fromClose(signal.stop_loss)} tone="down" />
                    <Stat label="Support (20-day low)" value={<span className="text-[17px]">{price(signal.support)}</span>} />
                    <Stat label="Resistance (60-day high)" value={<span className="text-[17px]">{price(signal.resistance)}</span>} />
                  </div>
                </>
              ) : null}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-[12px] text-muted uppercase tracking-wide mb-2">For</div>
                  {signal.reasons_for.length ? <ul className="space-y-1.5 text-[14px]">{signal.reasons_for.map((r, i) => <li key={`${i}-${r}`} className="flex gap-2"><span className="text-up">+</span>{r}</li>)}</ul> : <p className="text-[14px] text-faint">Nothing notable.</p>}
                </div>
                <div>
                  <div className="text-[12px] text-muted uppercase tracking-wide mb-2">Against</div>
                  {signal.reasons_against.length ? <ul className="space-y-1.5 text-[14px]">{signal.reasons_against.map((r, i) => <li key={`${i}-${r}`} className="flex gap-2"><span className="text-down">−</span>{r}</li>)}</ul> : <p className="text-[14px] text-faint">Nothing notable.</p>}
                </div>
              </div>
            </>
          ) : <Empty>Not enough history for a call yet.</Empty>}
        </Card>

        <Card>
          <Title sub="80% ranges: 1 in 5 outcomes should fall outside. Never a single promised price.">Where the price could be</Title>
          {sortedForecasts.length ? (
            <div className="space-y-5">
              {sortedForecasts.map((f) => {
                const lo = num(f.low)!, hi = num(f.high)!, mid = num(f.mid)!, base = num(f.base_close)!;
                const span = Math.max(hi - lo, 0.01);
                const left = Math.max(0, Math.min(100, ((base - lo) / span) * 100));
                return (
                  <div key={f.horizon}>
                    <div className="flex items-baseline justify-between text-[14px]">
                      <span className="font-medium">{({ "1W": "1 week", "1M": "1 month", "3M": "3 months" } as Record<string, string>)[f.horizon]} <span className="text-faint text-[12px]">by {day(f.target_date)}</span></span>
                      <span className="num">{price(lo)} – {price(hi)}</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-accent-soft mt-2">
                      <div className="absolute -top-1 h-4 w-0.5 bg-ink rounded" style={{ left: `${left}%` }} title="Price when the range was made" />
                    </div>
                    <div className="flex justify-between text-[12px] text-faint mt-1">
                      <span>{pct((lo / base - 1) * 100, 1)}</span>
                      <span>middle {price(mid)}</span>
                      <span>{pct((hi / base - 1) * 100, 1)}</span>
                    </div>
                    <div className="mt-1">{f.reliable ? <Pill tone="up">Reliable in backtest</Pill> : <Pill tone="warn">Not yet reliable</Pill>} <span className="text-[12px] text-faint">{f.note}</span></div>
                  </div>
                );
              })}
            </div>
          ) : usable ? <Empty>The ranges for {signal ? day(signal.date) : "this day"} are not available yet. Try again in a few minutes.</Empty>
            : <Empty>No ranges: the company is too illiquid, too new, or a data check failed.</Empty>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <Title sub={strategy ? `Same rules on ${day(strategy.period_start)} to ${day(strategy.period_end)}, after 0.75% costs per round trip and 5% tax on gains` : undefined}>Track record for {company.symbol}</Title>
          {strategy && strategy.sample_size ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                <Stat label="Trades" value={whole(strategy.sample_size)} />
                <Stat label="Profitable" value={strategy.hit_rate !== null ? `${Math.round(strategy.hit_rate * 100)}%` : "—"} />
                <Stat label="Avg gain" value={pct(strategy.avg_gain_pct, 1)} tone="up" />
                <Stat label="Avg loss" value={pct(strategy.avg_loss_pct, 1)} tone="down" />
              </div>
              <p className="text-[13px] text-muted">Following every buy call: {pct(strategy.total_return_pct, 1)} in total. {strategy.note}.{strategy.sample_size < 8 ? " Too few trades to judge." : ""}</p>
            </>
          ) : <Empty>Not enough history for a backtest.</Empty>}
          {rangeTests.some((t) => t.name === "ensemble") ? (
            <div className="mt-5">
              <div className="text-[12px] text-muted uppercase tracking-wide mb-2">How often past ranges held</div>
              <div className="grid grid-cols-3 gap-3">
                {["1W", "1M", "3M"].map((h) => {
                  const t = rangeTests.find((x) => x.name === "ensemble" && x.variant === h);
                  return (
                    <div key={h} className="rounded-2xl bg-soft px-3 py-2.5">
                      <div className="text-[12px] text-muted">{h}</div>
                      <div className="num text-[17px] font-semibold">{t?.band_coverage_pct !== null && t?.band_coverage_pct !== undefined ? `${Math.round(t.band_coverage_pct)}%` : "—"}</div>
                      <div className="text-[11px] text-faint">{t ? `${t.sample_size} tests, target 80%` : ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </Card>

        <Card>
          <Title>Indicators</Title>
          {signal ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
              <dt className="text-muted">Short trend (20 days)</dt><dd><Trend value={signal.trend_short} /></dd>
              <dt className="text-muted">Medium trend (20 vs 50 days)</dt><dd><Trend value={signal.trend_medium} /></dd>
              <dt className="text-muted">Long trend (200 days)</dt><dd><Trend value={signal.trend_long} /></dd>
              <dt className="text-muted">RSI (14)</dt><dd className="num">{num(signal.rsi_14)?.toFixed(0) ?? "—"}</dd>
              <dt className="text-muted">Volatility (30 days, yearly)</dt><dd className="num">{signal.volatility_30d !== null ? pct(num(signal.volatility_30d)! * 100, 0, false) : "—"}</dd>
              <dt className="text-muted">Volume vs 20-day average</dt><dd className="num">{signal.volume_ratio !== null ? `${num(signal.volume_ratio)!.toFixed(1)}×` : "—"}</dd>
              <dt className="text-muted">3 months vs the market</dt><dd className="num">{signal.rel_strength_index !== null ? pct(num(signal.rel_strength_index)! * 100, 1) : "—"}</dd>
              <dt className="text-muted">3 months vs its sector</dt><dd className="num">{signal.rel_strength_sector !== null ? pct(num(signal.rel_strength_sector)! * 100, 1) : "—"}</dd>
            </dl>
          ) : <Empty>No indicators yet.</Empty>}
          {history.length > 1 ? (
            <div className="mt-5">
              <div className="text-[12px] text-muted uppercase tracking-wide mb-2">Recent calls</div>
              <div className="flex flex-wrap gap-1.5">
                {history.slice(0, 12).reverse().map((s) => (
                  <span key={s.date} title={`${day(s.date)}: ${s.recommendation}, score ${s.score}`}><CallBadge call={s.recommendation} dataOk={s.data_ok} /></span>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <Title>Company</Title>
          {[company.market_cap, company.listed_shares, company.paid_up_capital, company.face_value, company.promoter_pct, company.listing_date, company.isin].every((v) => v === null) ? (
            // Filled in by the daily company details job (never-read shares first): say so instead of a column of dashes.
            <p className="text-[14px] text-muted rounded-2xl bg-soft px-4 py-3 leading-relaxed">
              {company.symbol}&apos;s shares, capital and ISIN have not been read from NEPSE yet. A daily job fills them in, companies never read first, so they appear within a day or two.
            </p>
          ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
            <dt className="text-muted">Market capitalisation</dt><dd className="num">{rupees(company.market_cap)}</dd>
            <dt className="text-muted">Listed shares</dt><dd className="num">{whole(company.listed_shares)}</dd>
            <dt className="text-muted">Paid-up capital</dt><dd className="num">{rupees(company.paid_up_capital)}</dd>
            <dt className="text-muted">Face value</dt><dd className="num">{price(company.face_value)}</dd>
            <dt className="text-muted">Promoter / public</dt><dd className="num">{company.promoter_pct !== null ? `${num(company.promoter_pct)!.toFixed(0)}% / ${num(company.public_pct)?.toFixed(0)}%` : "—"}</dd>
            <dt className="text-muted">Listed on</dt><dd>{day(company.listing_date)}</dd>
            <dt className="text-muted">ISIN</dt><dd className="num">{company.isin ?? "—"}</dd>
          </dl>
          )}
          <p className="text-[12px] text-faint mt-4">Earnings, P/E and dividends are not shown: there is no verified free source for them yet.</p>
        </Card>

        <Card>
          <Title sub={floor[0] ? `Floorsheet of ${day(floor[0].date)}` : undefined}>Who traded</Title>
          {floor[0] ? (
            <>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Stat label="Trades" value={whole(floor[0].trades)} />
                <Stat label="Quantity" value={whole(floor[0].quantity)} />
                <Stat label="Avg price" value={price(floor[0].vwap)} />
              </div>
              <div className="grid grid-cols-2 gap-4 text-[13px]">
                {(["top_buyers", "top_sellers"] as const).map((side) => (
                  <div key={side}>
                    <div className="text-[12px] text-muted uppercase tracking-wide mb-1.5">{side === "top_buyers" ? "Top buying brokers" : "Top selling brokers"}</div>
                    <ul className="space-y-1">
                      {(floor[0][side] ?? []).map((b) => (
                        <li key={b.broker} className="flex justify-between num"><span>Broker {b.broker}</span><span className="text-muted">{whole(b.qty)}</span></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty>No floorsheet stored yet.</Empty>}
        </Card>
      </div>

      {(adjustments.some((a) => a.status === "confirmed") || issueRows.length) ? (
        <Card>
          <Title sub="Bonus and right-share adjustments are detected from NEPSE's adjusted previous close; charts use them unless you switch adjustment off.">Adjustments and data checks</Title>
          <ul className="divide-y divide-line text-[14px]">
            {issueRows.map((i) => (
              <li key={i.id} className="py-2 flex gap-3"><Pill tone={i.severity === "error" ? "down" : i.severity === "warning" ? "warn" : "neutral"}>{i.severity}</Pill><span className="text-muted">{day(i.trade_date)}</span><span className="min-w-0">{i.detail}</span></li>
            ))}
            {adjustments.filter((a) => a.status === "confirmed").map((a) => (
              <li key={a.ex_date} className="py-2 flex justify-between gap-3"><span>{day(a.ex_date)}</span><span className="num text-muted">factor {num(a.factor)?.toFixed(4)} ≈ {pct((1 / num(a.factor)! - 1) * 100, 1)} more shares or value</span></li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="flex flex-wrap justify-between gap-3 text-[14px]">
        <Link href="/signals" className="text-accent">← All signals</Link>
        <Link href={`/feedback?about=${encodeURIComponent(company.symbol)}`} prefetch={false} className="text-accent">Want to see more about {company.symbol}? Tell {BUILDER} →</Link>
      </div>
    </div>
  );
}
