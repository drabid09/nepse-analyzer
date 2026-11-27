# Phase 0 source probe

- Run at: 2026-11-27 15:30:03 UTC = 2026-11-27 21:15 NPT (Friday)
- Ran from: AS8075 Microsoft Corporation in Des Moines, US (IP 20.186.239.88)
- Trigger: schedule

Every value below was returned by the source during this run.

## nepalstock.com (NEPSE website API)

- TLS certificate verifies with a standard client: **yes** 
- Homepage reachable: **yes**, status 200, 1.01s, block signals: none
- robots.txt is a real rules file: NO
- API without a token: status 401 (<html><head><title>Error</title></head><body>WARNING: UNAUTHORIZED ACCESS</body></html>)
- Library used TLS verification: yes
- Requests sent: 28, HTTP statuses: {'200': 28}
- Burst of 10 quick calls: {'succeeded': 10, 'slowest_seconds': 0.25, 'errors': []}

| Call | OK | Seconds | Rows | Notes |
|---|---|---|---|---|
| market_status | yes | 1.84 |  | {"isOpen": "CLOSE", "asOf": "2026-11-27T15:00:00", "id": 80} |
| nepse_index | yes | 0.26 | 4 |  |
| sub_indices | yes | 0.26 | 13 |  |
| market_summary | yes | 0.26 | 6 |  |
| company_list | yes | 0.52 | 652 |  |
| security_list | yes | 0.51 | 573 |  |
| price_volume_today | yes | 0.28 | 279 |  |
| live_market | yes | 0.25 | 0 |  |
| top_gainers | yes | 0.26 | 85 |  |
| index_intraday_graph | yes | 0.51 | 611 |  |
| history_NABIL | yes | 0.77 |  | 2025-11-27 to 2026-11-26; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| history_ACLBSL | yes | 0.26 |  | 2025-11-27 to 2026-11-26; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| intraday_ticks_NABIL | yes | 0.26 | 108 |  |
| company_details_NABIL | yes | 0.28 |  | {"securityDailyTradeDto": {"securityId": "131", "openPrice": 535.0, "highPrice": 562.0, "lowPrice": 535.0, "totalTradeQuantity": 47616, "totalTrades": 300, "las ...[truncated] |
| floorsheet_first_page | yes | 0.29 |  | paging {'totalElements': 42821, 'totalPages': 2142} |

## Open history dataset (Aabishkar2/nepse-data on GitHub)

- Last commit: 2026-11-26T21:59:31Z
- NABIL: 3548 daily rows, 2011-05-15 to 2026-11-26; last row {'published_date': '2026-11-26', 'open': '560.0', 'high': '565.0', 'low': '555.0', 'close': '559.0', 'per_change': '0.49', 'traded_quantity': '72688.0', 'traded_amount': '40627509.8', 'status': '-1'}
- ACLBSL: 1402 daily rows, 2020-07-29 to 2026-11-26; last row {'published_date': '2026-11-26', 'open': '755.0', 'high': '755.0', 'low': '733.0', 'close': '740.0', 'per_change': '-1.99', 'traded_quantity': '271.0', 'traded_amount': '200687.2', 'status': '-1'}

## Public sites

| Site | Page | Reachable | Status | Seconds | Needed browser UA | Block signals | Detail |
|---|---|---|---|---|---|---|---|
| Sharesansar | robots.txt | yes | 200 | 0.15 | no | none | User-agent: * Disallow:  |
| Sharesansar | today-share-price | yes | 200 | 1.87 | no | none | 354 rows; Search Watch Video As of : 2026-11-27 S.No Symbol Conf. Open High Low Close LTP Close - LTP Close - LTP % VWA; ACLBSL ['1', 'ACLBSL', '30.78', '740.00', '744.00', '725.10', '739.00', '739.00', '0.00', '0.00', '731.37', '757.00'] |
| Merolagani | robots.txt | yes | 200 | 1.12 | no | none | real rules file: NO |
| Merolagani | LatestMarket.aspx | yes | 200 | 5.5 | no | none | 398 rows; Losers Live Trading As of 2026/11/27 15:00:00 Go to your Watchlist &rarr; Symbol LTP % Change Open High Low Qt |
| NepseAlpha | robots.txt | yes | 200 | 0.07 | no | none |  |
| NepseAlpha | homepage | yes | 200 | 1.36 | no | none |  |
| yonepse | /data/market_status.json | yes | 404 | 0.16 | no | none |  items; last-modified None |
| yonepse | /data/nepse_data.json | yes | 200 | 0.06 | no | none | 350 items; last-modified Tue, 10 Nov 2026 07:21:36 GMT |
| yonepse | /data/upcoming_ipo.json | yes | 404 | 0.12 | no | none |  items; last-modified None |

Full detail: `reports/phase0/latest.json`.
