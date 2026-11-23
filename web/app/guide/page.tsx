import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CallBadge, Card, Change, Pill, ScoreBar, Title, Trend } from "@/components/ui";
import { BUILDER, VIEWER } from "@/lib/viewer";

export const metadata: Metadata = { title: "Guide" };

// ------------------------------------------------------------------ small building blocks

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-accent underline underline-offset-2">{children}</Link>
);

/** A word exactly as it appears on screen. */
const L = ({ children }: { children: ReactNode }) => <b className="font-semibold text-ink">&ldquo;{children}&rdquo;</b>;

function Section({ id, n, title, sub, children }: { id: string; n: number; title: string; sub?: string; children: ReactNode }) {
  return (
    <Card>
      <section id={id} className="scroll-mt-24">
        <div className="flex items-start gap-3 mb-4">
          <span className="shrink-0 h-8 w-8 rounded-full bg-ink text-bg flex items-center justify-center text-[15px] font-semibold num" aria-hidden>{n}</span>
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight leading-tight">{title}</h2>
            {sub ? <p className="text-[14px] text-muted mt-1">{sub}</p> : null}
          </div>
        </div>
        <div className="text-[15px] leading-relaxed text-muted space-y-4">{children}</div>
      </section>
    </Card>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="space-y-3 list-decimal pl-5 marker:text-faint marker:font-semibold">{children}</ol>;
}

function Example({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-soft px-4 py-3 flex flex-wrap items-center gap-3 text-[14px]">{children}</div>;
}

/** The dashed lines on the company chart, drawn in order from top to bottom. */
function LevelLadder() {
  const rows: [string, string, string, string][] = [
    ["Target 2", "586.60", "text-up", "border-up"],
    ["Target 1", "572.00", "text-up", "border-up"],
    ["Buy zone (top) = close", "550.00", "text-accent", "border-accent"],
    ["Buy zone (bottom)", "540.20", "text-accent", "border-accent"],
    ["Stop loss", "530.10", "text-down", "border-down"],
  ];
  return (
    <div className="rounded-2xl bg-soft px-4 py-3 space-y-2.5" aria-label="Example of the trade levels">
      {rows.map(([label, value, text, border]) => (
        <div key={label} className="flex items-center gap-3 text-[13px]">
          <span className={`flex-1 border-t-2 border-dashed ${border}`} />
          <span className={`w-44 sm:w-52 ${text} font-medium`}>{label}</span>
          <span className="num text-ink w-16 text-right">{value}</span>
        </div>
      ))}
    </div>
  );
}

function RangeExample() {
  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3" aria-label="Example of a price range">
      <div className="flex items-baseline justify-between text-[14px] text-ink">
        <span className="font-medium">1 month <span className="text-faint text-[12px]">by Mon, 21 Dec</span></span>
        <span className="num">523.00 – 572.00</span>
      </div>
      <div className="relative h-2 rounded-full bg-accent-soft mt-2">
        <div className="absolute -top-1 h-4 w-0.5 bg-ink rounded" style={{ left: "55%" }} />
      </div>
      <div className="flex justify-between text-[12px] text-faint mt-1"><span>-4.9%</span><span>middle 548.10</span><span>+4.0%</span></div>
      <div className="mt-2 flex flex-wrap gap-2"><Pill tone="up">Reliable in backtest</Pill><Pill tone="warn">Not yet reliable</Pill></div>
    </div>
  );
}

function Item({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="py-3 border-t border-line first:border-t-0 first:pt-0">
      <dt className="font-semibold text-ink">{term}</dt>
      <dd className="text-muted mt-1 leading-relaxed">{children}</dd>
    </div>
  );
}

const CONTENTS: [string, string][] = [
  ["top", "The top of every page"],
  ["market", "Market: today at a glance"],
  ["signals", "Signals: every company in one list"],
  ["company", "A company page, top to bottom"],
  ["example", "Putting it together: reading one company"],
  ["record", "Track record: how much to trust it"],
  ["health", "Data health: is everything up to date?"],
  ["routine", "A simple daily routine"],
  ["feedback", `Asking ${BUILDER} for more`],
];

// ------------------------------------------------------------------ the page

export default function GuidePage() {
  return (
    <div className="space-y-6 max-w-[860px]">
      <div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">How to read your dashboard</h1>
        <p className="text-[15px] text-muted mt-2 leading-relaxed">
          {VIEWER}, this guide walks through the dashboard one screen at a time, in the order you will meet them. It takes about ten minutes.
          Everything here comes from fixed rules applied to NEPSE&apos;s own prices and tested on three years of history. The dashboard can
          shortlist companies and show how far a price can realistically move, but it cannot see news, results or rumours. It is educational
          analysis, not financial advice.
        </p>
      </div>

      <Card>
        <Title>Contents</Title>
        <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[15px] list-decimal pl-5 marker:text-faint">
          {CONTENTS.map(([id, label]) => <li key={id}><a href={`#${id}`} className="text-accent hover:underline">{label}</a></li>)}
          <li><a href="#reference" className="text-accent hover:underline">Reference: every term explained</a></li>
        </ol>
      </Card>

      <Section id="top" n={1} title="The top of every page" sub="Look here first, every time.">
        <Steps>
          <li><b className="text-ink">The dot and the words next to it.</b> A green dot with <L>Market open</L> means trading is on and prices are
            arriving. A grey dot means <L>Market closed</L>. Next to it, <L>2 min ago</L> says when new data last arrived.</li>
          <li><b className="text-ink">A coloured banner under the menu.</b> Normally there is none. An amber banner means something is late (for
            example <L>Live prices are delayed</L>); a red one means a data check failed and no new calls are shown. When you see one, wait
            before acting on the numbers, and tap <L>Details</L>.</li>
          <li><b className="text-ink">The menu.</b> <L>Market</L>, <L>Signals</L>, <L>Track record</L> (shown as <L>Record</L> on a phone),
            {" "}<L>Data health</L> (<L>Health</L>) and <L>Guide</L>. The search box finds any company by its symbol or name.</li>
        </Steps>
      </Section>

      <Section id="market" n={2} title="Market: today at a glance" sub="The first page you see.">
        <Steps>
          <li><b className="text-ink">Your stocks.</b> The companies you starred, with their price, today&apos;s change and call. Tap the star on
            any company page, or next to a company in Signals, to add it. Stars are saved on the phone or computer you use.</li>
          <li><b className="text-ink">NEPSE Index.</b> The big number is the index now (or at the close), with today&apos;s change in green or red,
            and the line shows how it moved through the day. <L>live</L> after the date means the session is still on.</li>
          <li><b className="text-ink">Market.</b> <L>Turnover</L> is the total value traded today, in lakh or crore. <L>Advancing</L> and
            {" "}<L>Declining</L> count companies up and down: more advancing than declining means a broadly positive day.</li>
          <li><b className="text-ink">Sectors.</b> Today&apos;s change for each sector index, best first. It shows where money is moving.</li>
          <li><b className="text-ink">Strongest buy calls.</b> The ten highest scores from the last close. The blue box above the list says
            how much buy calls have been worth in the past; read it once.</li>
          <li><b className="text-ink">Top gainers and Top losers.</b> The biggest moves of the day, shares only.</li>
        </Steps>
      </Section>

      <Section id="signals" n={3} title="Signals: every company in one list" sub="For finding companies worth a closer look.">
        <Steps>
          <li><b className="text-ink">Filter by call.</b> Tap <L>Buy</L>, <L>Hold</L>, <L>Sell</L> or <L>No call</L>; add <L>Only your stocks</L> to
            narrow it to your starred companies. The number on each button is how many companies it would show with the other filters you chose.
            Your filters stay in the page address, so Back, refresh or a shared link show the same list.</li>
          <li><b className="text-ink">Narrow it down.</b> Choose a sector, or type part of a name in <L>Filter</L>.</li>
          <li><b className="text-ink">Sort.</b> Tap a column heading (<L>Company</L>, <L>Price</L>, <L>Today</L>, <L>Score</L>) to sort by it; tap
            again to reverse.</li>
          <li><b className="text-ink">Read a row from left to right.</b>
            <Example>
              <span className="font-semibold text-ink">NABIL</span>
              <span className="num text-ink">550.00</span>
              <Change value={0.36} />
              <span className="inline-flex items-center gap-2"><CallBadge call="buy" /><span className="text-[12px] text-faint">Medium confidence</span></span>
              <ScoreBar score={78} />
              <Trend value="up" />
              <span className="num">523.00 – 572.00</span>
            </Example>
            Company, price, change today, the call and its confidence, the score out of 100, the short-term trend, and the 1-month range.
            {" "}<L>not yet reliable</L> under a range means its past ranges were not accurate enough yet: treat it as rough.</li>
          <li><b className="text-ink">Tap a company</b> to open its page.</li>
        </Steps>
      </Section>

      <Section id="company" n={4} title="A company page, top to bottom" sub="Where the decision is made. Go through it in this order.">
        <Steps>
          <li><b className="text-ink">Header.</b> Symbol, name and sector on the left; price and change on the right. <L>Live</L> means
            today&apos;s session is on; <L>Close</L> means the price is final. <L>Add to your stocks</L> pins it to your Market page.</li>
          <li><b className="text-ink">The chart.</b> Choose <L>1M</L> to <L>3Y</L> for daily candles (green: closed higher than it opened; red:
            lower), or <L>Today</L> for today&apos;s line. Bars at the bottom are volume. Keep <L>Adjusted for bonus and right shares</L> ticked,
            so a bonus issue does not look like a crash. The dashed lines are the trade levels:
            <LevelLadder />
          </li>
          <li><b className="text-ink">Call.</b> The big badge (<CallBadge call="buy" />, <CallBadge call="hold" />, <CallBadge call="sell" /> or{" "}
            <CallBadge call="avoid" />), the date it was made from, the score and the confidence. Then the levels (the full plan
            below is shown on buy calls only; a hold or sell call shows just the exit level, support and resistance, for when you already own it):
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><L>Buy zone</L>: the price area the plan would buy in.</li>
              <li><L>Stop loss</L>: the exit if it goes wrong. The small number under it is how far below today&apos;s price it is.</li>
              <li><L>Target 1</L> and <L>Target 2</L>: where the plan would take profit. The small numbers under them are how far above.</li>
              <li><L>Support (20-day low)</L> and <L>Resistance (60-day high)</L>: recent floor and ceiling.</li>
              <li><L>For</L> and <L>Against</L>: the reasons behind the score, in words. Read both.</li>
            </ul>
          </li>
          <li><b className="text-ink">Where the price could be.</b> Ranges for 1 week, 1 month and 3 months. The price should end inside 4 times
            out of 5; the black mark is today&apos;s price.
            <RangeExample />
          </li>
          <li><b className="text-ink">Track record for this company.</b> What happened when the same rules were followed on this company before:
            {" "}<L>Trades</L>, <L>Profitable</L> (how often it made money), <L>Avg gain</L> and <L>Avg loss</L>, and <L>How often past ranges held</L>
            {" "}(target 80%). Few trades means little evidence.</li>
          <li><b className="text-ink">Indicators.</b> The three trends, <L>RSI (14)</L> (above 70 is stretched, below 30 is beaten down),
            {" "}<L>Volatility (30 days, yearly)</L> (how jumpy), <L>Volume vs 20-day average</L>, and how it did against the market and its sector over 3 months.</li>
          <li><b className="text-ink">Company and Who traded.</b> Size and share facts, then the latest floorsheet: trades, quantity, average
            price and the brokers who bought and sold the most.</li>
          <li><b className="text-ink">Adjustments and data checks.</b> Bonus and right-share adjustments found, and any data problem for this
            company. If a check failed, there is no call that day.</li>
        </Steps>
      </Section>

      <Section id="example" n={5} title="Putting it together: reading one company" sub="An example with made-up numbers, to show the thinking.">
        <p>Say a company page shows <CallBadge call="buy" />, score 78, <L>Medium</L> confidence, price 550, <L>Stop loss</L> 530.10 (-3.6%),
          {" "}<L>Target 1</L> 572.00 (+4.0%), and a 1-month range of 523 to 572 marked <Pill tone="up">Reliable in backtest</Pill>.</p>
        <Steps>
          <li><b className="text-ink">Is the data sound?</b> No banner, and the call is from the latest close. Yes.</li>
          <li><b className="text-ink">How much could go wrong?</b> To the stop loss: 550 to 530, about 20 rupees a share (3.6%). The range&apos;s
            low, 523, would be about 27 rupees (4.9%). Ask: on the amount I would buy, is that loss acceptable?</li>
          <li><b className="text-ink">How much could go right?</b> To Target 1: about 22 rupees (4.0%). Here the possible gain is about the same
            size as the possible loss. When the gain to Target 1 is smaller than the loss to the stop, the plan is weaker.</li>
          <li><b className="text-ink">What do the reasons say?</b> Several <L>For</L> and one <L>Against</L> is a cleaner picture than the
            reverse.</li>
          <li><b className="text-ink">What does the dashboard not know?</b> News, results, dividends, rights announcements. Check those yourself.</li>
          <li><b className="text-ink">Decide, and write down your exit</b> before buying: your stop loss and your target.</li>
        </Steps>
      </Section>

      <Section id="record" n={6} title="Track record: how much to trust it" sub="Read it once, and again when it updates on Saturdays.">
        <Steps>
          <li><L>What followed each call</L>: the average change in the month after each kind of call. Buy calls have done a little better than
            average; sell calls have not done worse, so a sell call means &quot;weaker than others&quot;, not &quot;will fall&quot;.</li>
          <li><L>Following the buy calls</L>: buying every buy call with the stop loss and Target 1 came out roughly even after costs and tax.
            The calls are a shortlist, not a money machine.</li>
          <li><L>Price ranges in the backtest</L> and <L>Live record since launch</L>: how often the ranges held, which has been about 4 in 5.</li>
        </Steps>
      </Section>

      <Section id="health" n={7} title="Data health: is everything up to date?" sub="Open it whenever a banner appears.">
        <Steps>
          <li><L>All good</L> in green and <L>Latest final trading day</L> showing the last trading day: everything is current.</li>
          <li><L>Jobs</L>: when each automatic job last ran. <L>ok</L> or <L>running</L> is normal.</li>
          <li><L>Data checks</L>: any company whose data looked wrong that day. Those companies show <L>No call</L>.</li>
        </Steps>
      </Section>

      <Section id="routine" n={8} title="A simple daily routine" sub="Nepal time, Monday to Friday.">
        <Steps>
          <li><b className="text-ink">After about 16:00:</b> open Market. Check for banners, look at Your stocks, then Strongest buy calls. New calls
            are ready from about 15:50.</li>
          <li><b className="text-ink">For anything interesting:</b> open its company page and go through step 4 and the example in step 5.</li>
          <li><b className="text-ink">During trading (11:00 to 15:00):</b> prices update about every 5 minutes, but the calls do not change until the
            evening.</li>
          <li><b className="text-ink">Weekends:</b> the site shows Friday&apos;s numbers. A good time to read the Track record.</li>
        </Steps>
      </Section>

      <Section id="feedback" n={9} title={`Asking ${BUILDER} for more`} sub="The dashboard can grow with what you need.">
        <p>Want to see something that is not here, think a call is missing something, or have your own view on a stock? Open{" "}
          <A href="/feedback">Tell {BUILDER}</A> (also at the bottom of every page, and on each company page), choose what kind of message it is,
          and write it. {BUILDER} gets a notification within about half an hour. Your message stays private.</p>
      </Section>

      <div id="reference" className="scroll-mt-24 pt-4">
        <h2 className="text-[24px] font-semibold tracking-tight">Reference: every term explained</h2>
      </div>

      <Card>
        <Title>Calls</Title>
        <dl className="text-[15px]">
          <Item term={<CallBadge call="buy" />}>The score is 65 or more and the short-term trend is not falling. Stronger than most companies right now.</Item>
          <Item term={<CallBadge call="hold" />}>The score is between 36 and 64, or a buy-level score with a falling short-term trend.</Item>
          <Item term={<CallBadge call="sell" />}>The score is 35 or less: weaker than most. In testing, prices after a sell call did not fall more than average.</Item>
          <Item term={<CallBadge call="avoid" />}>Not enough to go on: under 120 trading days of history, last trade more than 10 trading days ago, average
            turnover below Rs 5 lakh a day, extremely volatile, or that day&apos;s data for the company failed a check.</Item>
          <Item term="Score (0 to 100)">Five parts: trend over 20, 50 and 200 days (30%), momentum over the last month (20%), performance against other
            NEPSE shares over three months (20%), RSI (15%) and trading volume (15%). Very volatile shares lose 10 points.</Item>
          <Item term="Confidence">High needs a strong score (70 or more, or 30 or less), all three trends pointing the same way, and this company&apos;s own
            past buy calls working at least 55% of the time. Low means a data issue, a weak score, or a poor record for this company&apos;s past calls.</Item>
        </dl>
      </Card>

      <Card>
        <Title>Levels</Title>
        <dl className="text-[15px]">
          <Item term="ATR">Average true range: how much the price usually moves in a day, over about 14 days. The levels are measured in ATRs, so a calm
            share gets tight levels and a jumpy one gets wide ones.</Item>
          <Item term="Buy zone">From the 20-day low (but no more than 1 ATR below the close) up to the close.</Item>
          <Item term="Stop loss">Half an ATR below the 20-day low, and never more than 3 ATRs below the close.</Item>
          <Item term="Target 1">The highest price of the last 60 days, kept between 1.5 and 4 ATRs above the close so it can be reached within weeks.</Item>
          <Item term="Target 2">Target 1 plus one more ATR.</Item>
        </dl>
      </Card>

      <Card>
        <Title>Price ranges</Title>
        <div className="text-[15px] text-muted leading-relaxed space-y-3">
          <p>For 1 week, 1 month and 3 months ahead: a range the price should end inside 4 times out of 5. One time in five it ends outside, by
            design. There is never a single promised price.</p>
          <p><Pill tone="up">Reliable in backtest</Pill> means at least 20 past ranges for this company and horizon were tested, 70 to 90% held, and the
            middle estimate did no worse than assuming no change.</p>
        </div>
      </Card>

      <Card>
        <Title sub="Nepal time, Monday to Friday.">When things update</Title>
        <dl className="text-[15px]">
          <Item term="11:00 to 15:00">Prices about every 5 minutes. Open pages refresh themselves every minute.</Item>
          <Item term="About 15:20">Final closing prices, the floorsheet and all indices.</Item>
          <Item term="About 15:50">New calls and price ranges, after the day&apos;s data passes its checks (every close is compared with Sharesansar).</Item>
          <Item term="Saturday">The track record is recomputed.</Item>
          <Item term="If something is late">A banner says so on every page and {BUILDER} is emailed. Nothing old is shown as if it were current.</Item>
        </dl>
      </Card>

      <Card>
        <Title>Costs to remember</Title>
        <p className="text-[15px] text-muted leading-relaxed">
          Each trade pays broker commission (0.33% each way for trades of Rs 50,000 to 5 lakh), a SEBON fee of 0.015% and a DP charge of Rs 25, and
          gains on shares held up to 365 days pay 5% capital gains tax (individuals, from 22 Sep 2026). Small, frequent trades lose most to costs.
          Rates are from ShareHub Nepal&apos;s published table; confirm with your broker.
        </p>
      </Card>

      <Card>
        <Title>Keep it on your phone</Title>
        <ul className="list-disc pl-5 space-y-2 text-[15px] text-muted leading-relaxed">
          <li><b className="text-ink">iPhone (Safari):</b> tap Share, then Add to Home Screen.</li>
          <li><b className="text-ink">Android (Chrome):</b> tap the ⋮ menu, then Add to Home screen or Install app.</li>
          <li>Stars for Your stocks are saved separately in each browser, and on iPhone the home-screen app keeps its own, so star your companies
            where you usually open the dashboard.</li>
        </ul>
      </Card>
    </div>
  );
}
