# Phase 0 source probe

- Run at: 2026-11-25 18:36:58 UTC = 2026-11-26 00:21 NPT (Thursday)
- Ran from: AS16509 Amazon.com, Inc. in Boardman, US (IP 3.42.157.119)
- Trigger: schedule

Every value below was returned by the source during this run.

## nepalstock.com (NEPSE website API)

- TLS certificate verifies with a standard client: **yes** 
- Homepage reachable: **yes**, status 200, 1.03s, block signals: none
- robots.txt is a real rules file: NO
- API without a token: status 401 (<html><head><title>Error</title></head><body>WARNING: UNAUTHORIZED ACCESS</body></html>)
- Library used TLS verification: yes
- Requests sent: 39, HTTP statuses: {'200': 32, '401': 6}
- Burst of 10 quick calls: {'succeeded': 10, 'slowest_seconds': 0.26, 'errors': []}

| Call | OK | Seconds | Rows | Notes |
|---|---|---|---|---|
| market_status | yes | 1.3 |  | {"isOpen": "CLOSE", "asOf": "2026-11-25T15:00:00", "id": 80} |
| nepse_index | yes | 0.27 | 4 |  |
| sub_indices | yes | 0.27 | 13 |  |
| market_summary | yes | 0.26 | 6 |  |
| company_list | yes | 0.54 | 652 |  |
| security_list | yes | 0.27 | 573 |  |
| price_volume_today | yes | 0.28 | 279 |  |
| live_market | yes | 0.26 | 0 |  |
| top_gainers | yes | 0.27 | 207 |  |
| index_intraday_graph | NO | 3.15 |  | Exhausted: more than 12 requests needed for one call |
| history_NABIL | yes | 0.54 |  | 2025-11-25 to 2026-11-24; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| history_ACLBSL | yes | 0.27 |  | 2025-11-25 to 2026-11-24; paging {'totalElements': 228, 'totalPages': 1, 'size': 500, 'number': 0, 'last': True} |
| intraday_ticks_NABIL | yes | 0.26 | 0 |  |
| company_details_NABIL | yes | 0.26 | 0 |  |
| floorsheet_first_page | yes | 0.26 | 0 |  |

## Open history dataset (Aabishkar2/nepse-data on GitHub)

- Last commit: 2026-11-24T22:48:21Z
- NABIL: 3546 daily rows, 2011-05-15 to 2026-11-24; last row {'published_date': '2026-11-24', 'open': '549.9', 'high': '554.9', 'low': '549.9', 'close': '552.0', 'per_change': '0.38', 'traded_quantity': '75338.0', 'traded_amount': '41635339.2', 'status': '1'}
- ACLBSL: 1400 daily rows, 2020-07-29 to 2026-11-24; last row {'published_date': '2026-11-24', 'open': '735.0', 'high': '765.0', 'low': '735.0', 'close': '756.1', 'per_change': '-0.12', 'traded_quantity': '168.0', 'traded_amount': '127059.3', 'status': '1'}

## Public sites

| Site | Page | Reachable | Status | Seconds | Needed browser UA | Block signals | Detail |
|---|---|---|---|---|---|---|---|
| Sharesansar | robots.txt | yes | 200 | 0.26 | no | none | User-agent: * Disallow:  |
| Sharesansar | today-share-price | yes | 200 | 1.5 | no | none | 357 rows; Search Watch Video As of : 2026-11-25 S.No Symbol Conf. Open High Low Close LTP Close - LTP Close - LTP % VWA; ACLBSL ['1', 'ACLBSL', '34.60', '755.00', '760.90', '755.00', '755.00', '755.00', '0.00', '0.00', '755.80', '841.00'] |
| Merolagani | robots.txt | yes | 200 | 1.16 | no | none | real rules file: NO |
| Merolagani | LatestMarket.aspx | yes | 200 | 4.33 | no | none | 401 rows; Losers Live Trading As of 2026/11/25 15:00:00 Go to your Watchlist &rarr; Symbol LTP % Change Open High Low Qt |
| NepseAlpha | robots.txt | yes | 200 | 0.74 | no | none |  |
| NepseAlpha | homepage | yes | 200 | 1.36 | no | none |  |
| yonepse | /data/market_status.json | yes | 404 | 0.14 | no | none |  items; last-modified None |
| yonepse | /data/nepse_data.json | yes | 200 | 0.22 | no | none | 350 items; last-modified Tue, 10 Nov 2026 07:21:36 GMT |
| yonepse | /data/upcoming_ipo.json | yes | 404 | 0.17 | no | none |  items; last-modified None |

Full detail: `reports/phase0/latest.json`.
