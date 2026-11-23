# Phase 0 source probe

- Run at: 2026-11-23 20:04:43 UTC = 2026-11-24 01:49 NPT (Tuesday)
- Ran from: AS8075 Microsoft Corporation in San Jose, US (IP 172.184.174.120)
- Trigger: schedule

Every value below was returned by the source during this run.

## nepalstock.com (NEPSE website API)

- TLS certificate verifies with a standard client: **yes** 
- Homepage reachable: **yes**, status 200, 1.07s, block signals: none
- robots.txt is a real rules file: NO
- API without a token: status 401 (<html><head><title>Error</title></head><body>WARNING: UNAUTHORIZED ACCESS</body></html>)
- Library used TLS verification: yes
- Requests sent: 39, HTTP statuses: {'200': 32, '401': 6}
- Burst of 10 quick calls: {'succeeded': 10, 'slowest_seconds': 0.27, 'errors': []}

| Call | OK | Seconds | Rows | Notes |
|---|---|---|---|---|
| market_status | yes | 1.34 |  | {"isOpen": "CLOSE", "asOf": "2026-11-23T15:00:00", "id": 80} |
| nepse_index | yes | 0.27 | 4 |  |
| sub_indices | yes | 0.27 | 13 |  |
| market_summary | yes | 0.27 | 6 |  |
| company_list | yes | 0.55 | 652 |  |
| security_list | yes | 0.54 | 571 |  |
| price_volume_today | yes | 0.29 | 280 |  |
| live_market | yes | 0.27 | 0 |  |
| top_gainers | yes | 0.27 | 129 |  |
| index_intraday_graph | NO | 3.23 |  | Exhausted: more than 12 requests needed for one call |
| history_NABIL | yes | 0.82 |  | 2025-11-23 to 2026-11-20; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| history_ACLBSL | yes | 0.28 |  | 2025-11-23 to 2026-11-20; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| intraday_ticks_NABIL | yes | 0.27 | 0 |  |
| company_details_NABIL | yes | 0.27 | 0 |  |
| floorsheet_first_page | yes | 0.27 | 0 |  |

## Open history dataset (Aabishkar2/nepse-data on GitHub)

- Last commit: 2026-11-20T20:48:07Z
- NABIL: 3544 daily rows, 2011-05-15 to 2026-11-20; last row {'published_date': '2026-11-20', 'open': '551.0', 'high': '554.0', 'low': '548.5', 'close': '550.0', 'per_change': '-0.18', 'traded_quantity': '40217.0', 'traded_amount': '22113497.8', 'status': '-1'}
- ACLBSL: 1398 daily rows, 2020-07-29 to 2026-11-20; last row {'published_date': '2026-11-20', 'open': '765.0', 'high': '773.3', 'low': '765.0', 'close': '773.3', 'per_change': '1.08', 'traded_quantity': '399.0', 'traded_amount': '307573.6', 'status': '1'}

## Public sites

| Site | Page | Reachable | Status | Seconds | Needed browser UA | Block signals | Detail |
|---|---|---|---|---|---|---|---|
| Sharesansar | robots.txt | yes | 200 | 0.3 | no | none | User-agent: * Disallow:  |
| Sharesansar | today-share-price | yes | 200 | 1.67 | no | none | 361 rows; Search Watch Video As of : 2026-11-23 S.No Symbol Conf. Open High Low Close LTP Close - LTP Close - LTP % VWA; ACLBSL ['1', 'ACLBSL', '24.75', '785.00', '785.00', '756.00', '757.00', '757.00', '0.00', '0.00', '760.35', '613.00'] |
| Merolagani | robots.txt | yes | 200 | 1.05 | no | none | real rules file: NO |
| Merolagani | LatestMarket.aspx | yes | 200 | 2.4 | no | none | 405 rows; Losers Live Trading As of 2026/11/23 15:00:00 Go to your Watchlist &rarr; Symbol LTP % Change Open High Low Qt |
| NepseAlpha | robots.txt | yes | 200 | 0.06 | no | none |  |
| NepseAlpha | homepage | yes | 200 | 1.28 | no | none |  |
| yonepse | /data/market_status.json | yes | 404 | 0.13 | no | none |  items; last-modified None |
| yonepse | /data/nepse_data.json | yes | 200 | 0.1 | no | none | 350 items; last-modified Tue, 10 Nov 2026 07:21:36 GMT |
| yonepse | /data/upcoming_ipo.json | yes | 404 | 0.17 | no | none |  items; last-modified None |

Full detail: `reports/phase0/latest.json`.
