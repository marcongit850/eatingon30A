-- Deactivate both Seagrove Village Market Café locations on Eating on 30A.
-- Apply on eating-accounts D1 after deploying the accounts Worker.
-- Empty payload keeps the built catalog as the source of listing fields.

INSERT INTO listings (site, slug, status, deleted, payload, updated_at, updated_by)
VALUES
  ('30a', 'seagrove-village-market-cafe-seagrove-beach', 'inactive', 0, '{}', 0, 'migration'),
  ('30a', 'village-market-cafe-bar-watersound-origins', 'inactive', 0, '{}', 0, 'migration')
ON CONFLICT(site, slug) DO UPDATE SET
  status = 'inactive',
  deleted = 0,
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by;
