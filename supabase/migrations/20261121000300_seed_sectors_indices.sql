-- Phase 1, migration 3: sectors and indices.
--
-- Sector names are the 13 values NEPSE's company list returned in the Phase 0
-- probe on 21 Nov 2026 (reports/phase0/latest.json). Companies themselves are
-- seeded by scripts/ingest/sync_companies.py, straight from NEPSE.
--
-- Index ids come from the endpoint list of the open-source `nepse` library.
-- The probe confirmed 57 (Sensitive Index) and 64 (Microfinance Index); the
-- display names of the others are placeholders that ingestion overwrites with
-- NEPSE's own wording.

insert into public.sectors (name, slug) values
  ('Commercial Banks',             'commercial-banks'),
  ('Development Banks',            'development-banks'),
  ('Finance',                      'finance'),
  ('Hotels And Tourism',           'hotels-and-tourism'),
  ('Hydro Power',                  'hydro-power'),
  ('Investment',                   'investment'),
  ('Life Insurance',               'life-insurance'),
  ('Manufacturing And Processing', 'manufacturing-and-processing'),
  ('Microfinance',                 'microfinance'),
  ('Mutual Fund',                  'mutual-fund'),
  ('Non Life Insurance',           'non-life-insurance'),
  ('Others',                       'others'),
  ('Tradings',                     'tradings')
on conflict (name) do nothing;

insert into public.indices (id, code, name, kind, sector_id)
select v.id, v.code, v.name, v.kind, s.id
from (values
  (58, 'nepse',              'NEPSE Index',                 'main',   null),
  (57, 'sensitive',          'Sensitive Index',             'main',   null),
  (62, 'float',              'Float Index',                 'main',   null),
  (63, 'sensitive-float',    'Sensitive Float Index',       'main',   null),
  (51, 'banking',            'Banking SubIndex',            'sector', 'Commercial Banks'),
  (55, 'development-bank',   'Development Bank Index',      'sector', 'Development Banks'),
  (60, 'finance',            'Finance Index',               'sector', 'Finance'),
  (52, 'hotels-and-tourism', 'Hotels And Tourism Index',    'sector', 'Hotels And Tourism'),
  (54, 'hydropower',         'HydroPower Index',            'sector', 'Hydro Power'),
  (67, 'investment',         'Investment Index',            'sector', 'Investment'),
  (65, 'life-insurance',     'Life Insurance Index',        'sector', 'Life Insurance'),
  (56, 'manufacturing',      'Manufacturing And Processing Index', 'sector', 'Manufacturing And Processing'),
  (64, 'microfinance',       'Microfinance Index',          'sector', 'Microfinance'),
  (66, 'mutual-fund',        'Mutual Fund Index',           'sector', 'Mutual Fund'),
  (59, 'non-life-insurance', 'Non Life Insurance Index',    'sector', 'Non Life Insurance'),
  (53, 'others',             'Others Index',                'sector', 'Others'),
  (61, 'trading',            'Trading Index',               'sector', 'Tradings')
) as v (id, code, name, kind, sector_name)
left join public.sectors s on s.name = v.sector_name
on conflict (id) do nothing;
