import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Title } from "@/components/ui";

export const metadata: Metadata = { title: "Guide" };

function Item({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="py-3 border-t border-line first:border-t-0 first:pt-0">
      <dt className="font-semibold">{term}</dt>
      <dd className="text-muted mt-1 leading-relaxed">{children}</dd>
    </div>
  );
}

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-accent underline underline-offset-2">{children}</Link>
);

export default function GuidePage() {
  return (
    <div className="space-y-6 max-w-[820px]">
      <div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">How to use this dashboard</h1>
        <p className="text-[15px] text-muted mt-2 leading-relaxed">
          Every number here comes from fixed rules applied to NEPSE&apos;s own prices, and the rules have been tested on three years of
          history. It is a research tool: it can shortlist companies and show how far a price can realistically move, but it cannot see
          news, results or rumours. Educational analysis, not financial advice.
        </p>
      </div>

      <Card>
        <Title sub="Thirty seconds, every time.">Before you buy or sell</Title>
        <ol className="list-decimal pl-5 space-y-3 text-[15px] leading-relaxed">
          <li><b>Check the dot at the top.</b> Green (market open) or grey (closed) with no coloured banner means the data is current and
            passed its checks. An amber or red banner means something is late or failed a check: wait, and see <A href="/health">Data health</A>.</li>
          <li><b>Check the date of the call.</b> Calls are worked out once a day, at about 15:50, from that day&apos;s closing prices. During
            trading the price moves, the call does not.</li>
          <li><b>Look at the 1-month range before the call.</b> If the bottom of the range would be a loss you cannot accept, buy less or
            not at all.</li>
          <li><b>Decide your own exit before you enter.</b> The stop loss and targets shown are a starting plan. Write yours down.</li>
          <li><b>Never put most of your money in one company</b>, however strong the call.</li>
        </ol>
      </Card>

      <Card>
        <Title>Reading a call</Title>
        <dl className="text-[15px]">
          <Item term="Buy">The score is 65 or more and the short-term trend is not falling. The company looks stronger than most right now.</Item>
          <Item term="Hold">The score is between 36 and 64, or a buy-level score with a falling short-term trend. Nothing stands out.</Item>
          <Item term="Sell">The score is 35 or less: weaker than most. In testing, prices after a sell call did <i>not</i> fall more than
            average, so read it as &quot;weak compared with others&quot;, not &quot;will drop&quot;.</Item>
          <Item term="No call">Not enough to go on: under 120 trading days of history, last trade more than 10 trading days ago, average turnover
            below Rs 5 lakh a day, extremely volatile, or that day&apos;s data for the company failed a check.</Item>
          <Item term="Score (0 to 100)">Five parts: trend over 20, 50 and 200 days (30%), momentum over the last month (20%), performance
            against other NEPSE shares over three months (20%), RSI (15%) and trading volume (15%). Very volatile shares lose 10 points.</Item>
          <Item term="Confidence">High needs a strong score (70 or more, or 30 or less), all three trends pointing the same way, and this
            company&apos;s own past buy calls working at least 55% of the time. Low means a data issue, a weak score, or a poor record
            for this company&apos;s past calls.</Item>
          <Item term="For and against">The reasons behind the score, in words, on each company page.</Item>
        </dl>
      </Card>

      <Card>
        <Title sub="Shown as dashed lines on the company chart.">Buy zone, stop loss and targets</Title>
        <dl className="text-[15px]">
          <Item term="ATR">Average true range: how much the price usually moves in a day, averaged over about 14 days. The levels below are
            measured in ATRs, so a calm share gets tight levels and a jumpy one gets wide ones.</Item>
          <Item term="Buy zone">From the 20-day low (but no more than 1 ATR below the close) up to the close.</Item>
          <Item term="Stop loss">Half an ATR below the 20-day low, and never more than 3 ATRs below the close. If the price closes below it,
            the reason for buying has gone.</Item>
          <Item term="Target 1">The highest price of the last 60 days, kept between 1.5 and 4 ATRs above the close so it can be reached
            within weeks.</Item>
          <Item term="Target 2">Target 1 plus one more ATR.</Item>
        </dl>
      </Card>

      <Card>
        <Title>Price ranges</Title>
        <div className="text-[15px] text-muted leading-relaxed space-y-3">
          <p>For 1 week, 1 month and 3 months ahead, each company shows a range the price should end inside <b className="text-ink">4 times out
            of 5</b>. One time in five it ends outside: that is how the range is built, not a fault. There is never a single promised price.</p>
          <p><b className="text-ink">Reliable in backtest</b> means that, for this company and horizon, at least 20 past ranges were tested,
            70 to 90% of them held, and the middle estimate did no worse than simply assuming no change. Treat a range without the badge as rough.</p>
          <p>In testing, the ranges were the most dependable thing on this site. Use them to judge risk: how much could this cost me if it goes badly?</p>
        </div>
      </Card>

      <Card>
        <Title>How good is it?</Title>
        <div className="text-[15px] text-muted leading-relaxed space-y-3">
          <p>The same rules were replayed over three years of NEPSE history, using only what was known on each day. In short:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>The ranges held about 4 times in 5, as designed.</li>
            <li>Buy calls had a <b className="text-ink">small, consistent edge</b>: on average, stocks did a little better in the month after a
              buy call than after other calls. A month&apos;s swing of the whole market is usually larger than that edge.</li>
            <li>Sell calls had no edge.</li>
            <li>Buying every buy call and following the stop loss and first target was roughly <b className="text-ink">break-even</b> after
              trading costs and tax.</li>
          </ul>
          <p>So use buy calls to make a shortlist, then look at each company yourself. The current figures are on the <A href="/track-record">Track record</A> page and update every Saturday.</p>
        </div>
      </Card>

      <Card>
        <Title sub="Nepal time, Monday to Friday.">When things update</Title>
        <dl className="text-[15px]">
          <Item term="11:00 to 15:00">Prices about every 5 minutes. Open pages refresh themselves every minute.</Item>
          <Item term="About 15:20">Final closing prices, the floorsheet and all indices.</Item>
          <Item term="About 15:50">New calls and price ranges, after the day&apos;s data passes its checks (including a comparison of every close with Sharesansar).</Item>
          <Item term="Saturday">The track record is recomputed.</Item>
          <Item term="If something is late">A banner says so on every page and the owner is emailed. Nothing old is shown as if it were current.</Item>
        </dl>
      </Card>

      <Card>
        <Title>Costs to remember</Title>
        <p className="text-[15px] text-muted leading-relaxed">
          Each trade pays broker commission (0.33% each way for trades of Rs 50,000 to 5 lakh), a SEBON fee of 0.015% and a DP charge of
          Rs 25, and gains on shares held up to 365 days pay 5% capital gains tax (individuals, from 22 Sep 2026). Small, frequent trades
          lose most to costs. Rates are from ShareHub Nepal&apos;s published table; confirm with your broker.
        </p>
      </Card>

      <Card>
        <Title>Keep it on your phone</Title>
        <ul className="list-disc pl-5 space-y-2 text-[15px] text-muted leading-relaxed">
          <li><b className="text-ink">iPhone (Safari):</b> tap Share, then Add to Home Screen.</li>
          <li><b className="text-ink">Android (Chrome):</b> tap the ⋮ menu, then Add to Home screen or Install app.</li>
        </ul>
      </Card>
    </div>
  );
}
