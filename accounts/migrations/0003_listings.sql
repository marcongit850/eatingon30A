CREATE TABLE IF NOT EXISTS listings (
  site TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (site, slug)
);

CREATE INDEX IF NOT EXISTS listings_site ON listings (site, deleted);

CREATE TABLE IF NOT EXISTS listing_photos (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  slug TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS listing_photos_listing ON listing_photos (site, slug);
