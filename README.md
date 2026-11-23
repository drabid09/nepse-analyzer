# nepse-analyzer

An interactive website for exploring the Nepal Stock Exchange. Educational analysis, not financial advice.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Data source verification | First probe done. See [docs/phase0-findings.md](docs/phase0-findings.md) |
| 1 | Database | Migrations written and tested. See [docs/phase1-database.md](docs/phase1-database.md) |
| 2 | Ingestion | Jobs built and run against the live database; running on schedule from `main`. See [docs/phase2-ingestion.md](docs/phase2-ingestion.md) |
| 3 | Analytics and estimation engine | Data checks, signals, price ranges, backtest and watchdog built and running on schedule from `main`. See [docs/phase3-analytics.md](docs/phase3-analytics.md) |
| 4 | Interactive website | Dashboard live at https://nepse-analyzer-peach.vercel.app. See [docs/phase4-dashboard.md](docs/phase4-dashboard.md) and [web/README.md](web/README.md) |
| 5 | Quality and launch | Not started |
