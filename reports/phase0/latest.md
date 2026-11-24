# Phase 0 source probe

- Run at: 2026-11-24 16:15:26 UTC = 2026-11-24 22:00 NPT (Tuesday)
- Ran from: AS8075 Microsoft Corporation in Phoenix, US (IP 134.33.77.176)
- Trigger: schedule

Every value below was returned by the source during this run.

## nepalstock.com (NEPSE website API)

- TLS certificate verifies with a standard client: **yes** 
- Homepage reachable: **yes**, status 200, 1.65s, block signals: none
- robots.txt is a real rules file: NO
- API without a token: status 401 (<html><head><title>Error</title></head><body>WARNING: UNAUTHORIZED ACCESS</body></html>)
- Library used TLS verification: yes
- Requests sent: 28, HTTP statuses: {'200': 28}
- Burst of 10 quick calls: {'succeeded': 10, 'slowest_seconds': 0.27, 'errors': []}

| Call | OK | Seconds | Rows | Notes |
|---|---|---|---|---|
| market_status | yes | 1.89 |  | {"isOpen": "CLOSE", "asOf": "2026-11-24T15:00:00", "id": 80} |
| nepse_index | yes | 0.26 | 4 |  |
| sub_indices | yes | 0.26 | 13 |  |
| market_summary | yes | 0.26 | 6 |  |
| company_list | yes | 0.53 | 652 |  |
| security_list | yes | 0.53 | 573 |  |
| price_volume_today | yes | 0.28 | 279 |  |
| live_market | yes | 0.26 | 0 |  |
| top_gainers | yes | 0.27 | 191 |  |
| index_intraday_graph | yes | 0.53 | 610 |  |
| history_NABIL | yes | 0.8 |  | 2025-11-24 to 2026-11-23; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| history_ACLBSL | yes | 0.27 |  | 2025-11-24 to 2026-11-23; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| intraday_ticks_NABIL | yes | 0.27 | 132 |  |
| company_details_NABIL | yes | 0.28 |  | {"securityDailyTradeDto": {"securityId": "131", "openPrice": 549.9, "highPrice": 554.9, "lowPrice": 549.9, "totalTradeQuantity": 75338, "totalTrades": 390, "las ...[truncated] |
| floorsheet_first_page | yes | 0.29 |  | paging {'totalElements': 52387, 'totalPages': 2620} |

## Open history dataset (Aabishkar2/nepse-data on GitHub)

- Last commit: 2026-11-24T00:25:23Z
- NABIL: 3545 daily rows, 2011-05-15 to 2026-11-23; last row {'published_date': '2026-11-23', 'open': '550.0', 'high': '551.0', 'low': '549.0', 'close': '549.9', 'per_change': '-0.02', 'traded_quantity': '40160.0', 'traded_amount': '22080843.4', 'status': '-1'}
- ACLBSL: 1399 daily rows, 2020-07-29 to 2026-11-23; last row {'published_date': '2026-11-23', 'open': '785.0', 'high': '785.0', 'low': '756.0', 'close': '757.0', 'per_change': '-2.11', 'traded_quantity': '613.0', 'traded_amount': '466094.0', 'status': '-1'}

## Public sites

| Site | Page | Reachable | Status | Seconds | Needed browser UA | Block signals | Detail |
|---|---|---|---|---|---|---|---|
| Sharesansar | robots.txt | yes | 200 | 0.28 | no | none | User-agent: * Disallow:  |
| Sharesansar | today-share-price | yes | 200 | 2.01 | no | none | 351 rows; Search Watch Video As of : 2026-11-24 S.No Symbol Conf. Open High Low Close LTP Close - LTP Close - LTP % VWA; ACLBSL ['1', 'ACLBSL', '24.13', '735.00', '765.00', '735.00', '756.10', '756.10', '0.00', '0.00', '756.31', '168.00'] |
| Merolagani | robots.txt | yes | 200 | 1.11 | no | none | real rules file: NO |
| Merolagani | LatestMarket.aspx | yes | 200 | 2.27 | no | none | 395 rows; Losers Live Trading As of 2026/11/24 15:00:00 Go to your Watchlist &rarr; Symbol LTP % Change Open High Low Qt |
| NepseAlpha | robots.txt | yes | 200 | 0.29 | no | none |  |
| NepseAlpha | homepage | yes | 200 | 1.57 | no | none |  |
| yonepse | /data/market_status.json | yes | 404 | 0.25 | no | none |  items; last-modified None |
| yonepse | /data/nepse_data.json | yes | 200 | 0.14 | no | none | 350 items; last-modified Tue, 10 Nov 2026 07:21:36 GMT |
| yonepse | /data/upcoming_ipo.json | yes | 404 | 0.12 | no | none |  items; last-modified None |

Full detail: `reports/phase0/latest.json`.
