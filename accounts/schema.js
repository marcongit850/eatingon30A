// Shared account store for Eating on 30A and Eating in Destin.
// accounts/migrations/0001_init.sql must stay identical to SCHEMA_SQL.
// accounts/migrations/0002_save_note.sql adds saves.note for private notes.
// accounts/migrations/0003_listings.sql must stay identical to LISTINGS_SQL.
// ensureSchema applies later changes when an existing database is missing them.

export const SAVE_NOTE_SQL = "ALTER TABLE saves ADD COLUMN note TEXT NOT NULL DEFAULT ''";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  created_site TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  return_to TEXT NOT NULL,
  site TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS exchange_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS saves (
  user_id TEXT NOT NULL,
  site TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, site, slug, kind)
);

CREATE INDEX IF NOT EXISTS saves_user ON saves (user_id, kind);
`.trim();

export const LISTINGS_SQL = `
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
`.trim();
