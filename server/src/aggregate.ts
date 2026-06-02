import { pool } from "./db.js";
import {
  resolveAlbumOverrideUrl,
  resolveArtistOverrideUrl,
} from "./itunes.js";
import type { AggregateResponse, AggregateRow } from "./types.js";

type AggregateRawRow = {
  display_name: string;
  artist?: string;
  image_url: string | null;
  score: number;
  votes: number;
};

// Scoring:
//   Artists  - max 10 picks per submitter, rank 1 -> 10 pts, rank 10 -> 1 pt.
//   Albums   - max 25 picks per submitter, rank 1 -> 25 pts, rank 25 -> 1 pt.
// Ties on score broken by vote count, then alphabetical for stability.
//
// Grouping uses a normalized key so the following collapse together:
//   "Is This It?" + "Is This It" + "is this it" -> "isthisit"
//   "Dark Side of the Moon" + "The Dark Side of the Moon" -> "darksideofthemoon"
//   "The Strokes" + "Strokes" -> "strokes"
// This mirrors the normalize() function in itunes.ts.

// Mirror of normalize() in itunes.ts. Strips leading "the ", lowercases, and
// keeps only alphanumerics. No diacritic stripping because that would require
// the `unaccent` Postgres extension; ASCII covers our crowd.
function normalizeExpr(col: string): string {
  return `regexp_replace(regexp_replace(LOWER(${col}), '^the\\s+', ''), '[^a-z0-9]+', '', 'g')`;
}

const ARTIST_QUERY = `
WITH grouped AS (
  SELECT
    ${normalizeExpr("artist_name")} AS key,
    artist_name,
    rank,
    image_url
  FROM artist_picks
)
SELECT
  key,
  MAX(artist_name)                     AS display_name,
  (ARRAY_AGG(image_url) FILTER (WHERE image_url IS NOT NULL))[1] AS image_url,
  SUM(11 - rank)::INT                  AS score,
  COUNT(*)::INT                        AS votes
FROM grouped
WHERE key <> ''
GROUP BY key
ORDER BY score DESC, votes DESC, display_name ASC;
`;

const ALBUM_QUERY = `
WITH grouped AS (
  SELECT
    ${normalizeExpr("album_name")} || '\u200b' || ${normalizeExpr("artist_name")} AS key,
    album_name,
    artist_name,
    rank,
    image_url
  FROM album_picks
)
SELECT
  key,
  MAX(album_name)                       AS display_name,
  MAX(artist_name)                      AS artist,
  (ARRAY_AGG(image_url) FILTER (WHERE image_url IS NOT NULL))[1] AS image_url,
  SUM(26 - rank)::INT                   AS score,
  COUNT(*)::INT                         AS votes
FROM grouped
WHERE key <> ''
GROUP BY key
ORDER BY score DESC, votes DESC, display_name ASC;
`;

// "Artists with the most album votes": aggregate every album_pick by its
// artist (so The Beatles appearing 4 times across people's album lists counts
// all 4 ranks). Uses the same 26-rank scoring as the album board.
const ARTISTS_BY_ALBUM_QUERY = `
WITH grouped AS (
  SELECT
    ${normalizeExpr("artist_name")} AS key,
    artist_name,
    rank,
    image_url
  FROM album_picks
)
SELECT
  key,
  MAX(artist_name)                     AS display_name,
  (ARRAY_AGG(image_url) FILTER (WHERE image_url IS NOT NULL))[1] AS image_url,
  SUM(26 - rank)::INT                  AS score,
  COUNT(*)::INT                        AS votes
FROM grouped
WHERE key <> ''
GROUP BY key
ORDER BY score DESC, votes DESC, display_name ASC;
`;

function withRanksAndTies(
  rows: AggregateRawRow[],
  limit: number
): AggregateRow[] {
  // Assign dense rank by score (ties share the same rank). Then take everyone
  // up to and including the row at logical position `limit`, so ties at the
  // cutoff are kept.
  if (rows.length === 0) return [];

  const out: AggregateRow[] = [];
  let currentRank = 0;
  let lastScore: number | null = null;
  let physicalIndex = 0;

  for (const row of rows) {
    physicalIndex += 1;
    if (lastScore === null || row.score !== lastScore) {
      currentRank = physicalIndex;
      lastScore = row.score;
    }

    if (currentRank > limit) break;

    out.push({
      rank: currentRank,
      displayName: row.display_name,
      artist: row.artist,
      imageUrl: row.image_url,
      score: row.score,
      votes: row.votes,
    });
  }
  return out;
}

let cache: { value: AggregateResponse; expires: number } | null = null;
const CACHE_MS = 30_000;

async function applyArtistImageOverrides(
  rows: AggregateRow[]
): Promise<AggregateRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      const url = await resolveArtistOverrideUrl(row.displayName);
      if (!url) return row;
      return { ...row, imageUrl: url };
    })
  );
}

async function applyAlbumImageOverrides(
  rows: AggregateRow[]
): Promise<AggregateRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (!row.artist) return row;
      const url = await resolveAlbumOverrideUrl(row.displayName, row.artist);
      if (!url) return row;
      return { ...row, imageUrl: url };
    })
  );
}

export async function getAggregate(): Promise<AggregateResponse> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.value;

  const [artistRows, albumRows, artistsByAlbumRows] = await Promise.all([
    pool.query<AggregateRawRow>(ARTIST_QUERY),
    pool.query<AggregateRawRow>(ALBUM_QUERY),
    pool.query<AggregateRawRow>(ARTISTS_BY_ALBUM_QUERY),
  ]);

  const [artists, albums, artistsByAlbumScore] = await Promise.all([
    applyArtistImageOverrides(withRanksAndTies(artistRows.rows, 10)),
    applyAlbumImageOverrides(withRanksAndTies(albumRows.rows, 20)),
    applyArtistImageOverrides(withRanksAndTies(artistsByAlbumRows.rows, 10)),
  ]);

  const value: AggregateResponse = {
    artists,
    albums,
    artistsByAlbumScore,
  };

  cache = { value, expires: now + CACHE_MS };
  return value;
}

export function invalidateAggregateCache(): void {
  cache = null;
}
