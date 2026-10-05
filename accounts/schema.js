// Shared account store for Eating on 30A and Eating in Destin.
// accounts/migrations/0001_init.sql must stay identical to SCHEMA_SQL.

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
