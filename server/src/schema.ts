export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS submissions (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  edit_token  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS submissions_name_lower_idx
  ON submissions (LOWER(name));

CREATE TABLE IF NOT EXISTS artist_picks (
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  rank          INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 10),
  artist_name   TEXT NOT NULL,
  image_url     TEXT,
  PRIMARY KEY (submission_id, rank)
);

CREATE INDEX IF NOT EXISTS artist_picks_lower_idx
  ON artist_picks (LOWER(artist_name));

CREATE TABLE IF NOT EXISTS album_picks (
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  rank          INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 25),
  album_name    TEXT NOT NULL,
  artist_name   TEXT NOT NULL,
  image_url     TEXT,
  PRIMARY KEY (submission_id, rank)
);

CREATE INDEX IF NOT EXISTS album_picks_lower_idx
  ON album_picks (LOWER(album_name), LOWER(artist_name));

-- If an older deploy created album_picks with a CHECK (rank BETWEEN 1 AND 10),
-- relax it to 1..25. Idempotent: safe to run on every boot.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'album_picks'
      AND c.conname = 'album_picks_rank_check'
  ) THEN
    EXECUTE 'ALTER TABLE album_picks DROP CONSTRAINT album_picks_rank_check';
  END IF;
  EXECUTE 'ALTER TABLE album_picks ADD CONSTRAINT album_picks_rank_check CHECK (rank BETWEEN 1 AND 25)';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
`;
