# Phase 0 source probe

- Run at: 2026-11-26 18:21:47 UTC = 2026-11-27 00:06 NPT (Friday)
- Ran from: AS16509 Amazon.com, Inc. in Boardman, US (IP 3.42.157.109)
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
| market_status | yes | 1.33 |  | {"isOpen": "CLOSE", "asOf": "2026-11-26T15:00:00", "id": 80} |
| nepse_index | yes | 0.27 | 4 |  |
| sub_indices | yes | 0.27 | 13 |  |
| market_summary | yes | 0.27 | 6 |  |
| company_list | yes | 0.55 | 652 |  |
| security_list | yes | 0.28 | 573 |  |
| price_volume_today | yes | 0.29 | 279 |  |
| live_market | yes | 0.27 | 0 |  |
| top_gainers | yes | 0.27 | 123 |  |
| index_intraday_graph | NO | 3.23 |  | Exhausted: more than 12 requests needed for one call |
| history_NABIL | yes | 0.55 |  | 2025-11-26 to 2026-11-25; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| history_ACLBSL | yes | 0.28 |  | 2025-11-26 to 2026-11-25; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| intraday_ticks_NABIL | yes | 0.27 | 0 |  |
| company_details_NABIL | yes | 0.27 | 0 |  |
| floorsheet_first_page | yes | 0.27 | 0 |  |

## Open history dataset (Aabishkar2/nepse-data on GitHub)

- Last commit: 2026-11-25T22:00:41Z
- NABIL: 3547 daily rows, 2011-05-15 to 2026-11-25; last row {'published_date': '2026-11-25', 'open': '553.0', 'high': '558.0', 'low': '553.0', 'close': '556.3', 'per_change': '0.78', 'traded_quantity': '49354.0', 'traded_amount': '27439240.9', 'status': '1'}
- ACLBSL: 1401 daily rows, 2020-07-29 to 2026-11-25; last row {'published_date': '2026-11-25', 'open': '755.0', 'high': '760.9', 'low': '755.0', 'close': '755.0', 'per_change': '-0.15', 'traded_quantity': '841.0', 'traded_amount': '635629.7', 'status': '0'}

## Public sites

| Site | Page | Reachable | Status | Seconds | Needed browser UA | Block signals | Detail |
|---|---|---|---|---|---|---|---|
| Sharesansar | robots.txt | yes | 200 | 0.24 | no | none | User-agent: * Disallow:  |
| Sharesansar | today-share-price | yes | 200 | 2.19 | no | none | 356 rows; Search Watch Video As of : 2026-11-26 S.No Symbol Conf. Open High Low Close LTP Close - LTP Close - LTP % VWA; ACLBSL ['1', 'ACLBSL', '27.82', '755.00', '755.00', '733.00', '740.00', '740.00', '0.00', '0.00', '740.54', '271.00'] |
| Merolagani | robots.txt | yes | 200 | 1.18 | no | none | real rules file: NO |
| Merolagani | LatestMarket.aspx | yes | 200 | 2.92 | no | none | 400 rows; Losers Live Trading As of 2026/11/26 15:00:00 Go to your Watchlist &rarr; Symbol LTP % Change Open High Low Qt |
| NepseAlpha | robots.txt | yes | 200 | 0.05 | no | none |  |
| NepseAlpha | homepage | yes | 200 | 1.17 | no | none |  |
| yonepse | /data/market_status.json | yes | 404 | 0.18 | no | none |  items; last-modified None |
| yonepse | /data/nepse_data.json | yes | 200 | 0.17 | no | none | 350 items; last-modified Tue, 10 Nov 2026 07:21:36 GMT |
| yonepse | /data/upcoming_ipo.json | yes | 404 | 0.13 | no | none |  items; last-modified None |

Full detail: `reports/phase0/latest.json`.
