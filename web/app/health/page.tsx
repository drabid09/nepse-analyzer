import { Ago } from "@/components/client";
import type { Metadata } from "next";
import { Setup, Unavailable } from "@/components/states";
import { Card, Empty, Pill, Title } from "@/components/ui";
import * as data from "@/lib/data";
import { configured } from "@/lib/db";
import { ago, dateTime, day } from "@/lib/format";
import { freshness } from "@/lib/market";

export const revalidate = 60;
export const metadata: Metadata = { title: "Data health" };

const JOBS: Record<string, [string, string]> = {
  live: ["Live prices", "Every 5 minutes during trading, 11:00 to 15:00"],
  eod: ["End of day", "Final prices, floorsheet and indices after 15:00"],
  analytics: ["Calls and ranges", "After the end-of-day run, with data checks"],
  watchdog: ["Watchdog", "Hourly on trading afternoons, daily otherwise"],
  backtest: ["Backtest", "Saturdays"],
  details: ["Company details", "About 110 companies a day"],
  companies: ["Company list", "Sundays"],
  backfill: ["History import", "One-time"],
};

function tone(status: string) {
  return status === "ok" || status === "holiday" ? "up" : status === "running" ? "accent" : status === "failed" ? "down" : "warn";
}

export default async function HealthPage() {
  if (!configured()) return <Setup />;
  try {
    const [h, runs, issueRows] = await Promise.all([data.health(), data.recentRuns(30), data.issues({}, 30)]);
    const f = freshness(h.runs, h.latestFinal, h.marketErrors);
    const latest = Object.fromEntries(h.runs.map((r) => [r.job, r]));
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">Data health</h1>
          <p className="text-[15px] text-muted mt-1 max-w-[720px] leading-relaxed">
            Every job reports here when it runs. If a job is late or a data check fails, the dashboard says so instead of showing a doubtful number, and the watchdog emails the owner.
          </p>
        </div>

        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone={f.problems.length ? "warn" : "up"}>{f.problems.length ? `${f.problems.length} issue${f.problems.length > 1 ? "s" : ""}` : "All good"}</Pill>
            <span className="text-[14px] text-muted">Latest final trading day: <span className="text-ink">{day(h.latestFinal)}</span></span>
          </div>
          {f.problems.length ? <ul className="mt-3 space-y-1 text-[14px]">{f.problems.map((p, i) => <li key={i} className={p.level === "error" ? "text-down" : "text-warn"}>{p.text}</li>)}</ul> : null}
        </Card>

        <Card>
          <Title>Jobs</Title>
          <ul className="divide-y divide-line">
            {Object.entries(JOBS).map(([job, [label, when]]) => {
              const r = latest[job];
              return (
                <li key={job} className="py-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium">{label}</div>
                    <div className="text-[12px] text-faint">{when}</div>
                    {r?.message ? <div className="text-[13px] text-muted mt-1 max-w-[640px]">{r.message}</div> : null}
                  </div>
                  <div className="text-right">
                    {r ? <Pill tone={tone(r.status) as never}>{r.status}</Pill> : <Pill>not run yet</Pill>}
                    {r ? <div className="text-[12px] text-faint mt-1">{dateTime(r.heartbeat_at)} · <Ago ts={r.heartbeat_at} initial={ago(r.heartbeat_at)} /></div> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <Title sub="Recorded by the daily data checks. A company with a warning or error gets no call that day.">Data checks</Title>
          {issueRows.length ? (
            <ul className="divide-y divide-line text-[14px]">
              {issueRows.map((i) => (
                <li key={i.id} className="py-2 flex flex-wrap gap-x-3 gap-y-1"><Pill tone={i.severity === "error" ? "down" : i.severity === "warning" ? "warn" : "neutral"}>{i.severity}</Pill><span className="text-muted">{day(i.trade_date)}</span><span className="min-w-0">{i.detail}</span></li>
              ))}
            </ul>
          ) : <Empty>No issues recorded.</Empty>}
        </Card>

        <Card>
          <Title>Recent runs</Title>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-muted text-left"><tr><th className="px-2 py-2 font-normal">Started</th><th className="px-2 py-2 font-normal">Job</th><th className="px-2 py-2 font-normal">Status</th><th className="px-2 py-2 font-normal hidden md:table-cell">Message</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-2 py-2 whitespace-nowrap text-muted">{dateTime(r.started_at)}</td>
                    <td className="px-2 py-2">{JOBS[r.job]?.[0] ?? r.job}</td>
                    <td className="px-2 py-2"><Pill tone={tone(r.status) as never}>{r.status}</Pill></td>
                    <td className="px-2 py-2 text-muted hidden md:table-cell">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <Title>How it works</Title>
          <div className="text-[14px] text-muted space-y-2 leading-relaxed max-w-[760px]">
            <p>Prices are read from NEPSE&apos;s website every 5 minutes during trading and finalised after the close, with the floorsheet and all 17 indices. History before November 2026 comes from the open Aabishkar2/nepse-data dataset. Bonus and right-share adjustments are detected from NEPSE&apos;s adjusted previous close.</p>
            <p>Before any call is made, each day is checked: complete, within NEPSE&apos;s 10% daily limit, prices in a sensible order, and every close compared with Sharesansar. Calls come from fixed, published rules; their measured record is on the Track record page.</p>
            <p>Source code and documentation: github.com/drabid09/nepse-analyzer. Educational analysis, not financial advice.</p>
          </div>
        </Card>
      </div>
    );
  } catch (e) {
    return <Unavailable error={e} />;
  }
}
