import { pool } from "./db.js";
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

const ARTIST_QUERY = `
SELECT
  LOWER(artist_name)                   AS key,
  MAX(artist_name)                     AS display_name,
  (ARRAY_AGG(image_url) FILTER (WHERE image_url IS NOT NULL))[1] AS image_url,
  SUM(11 - rank)::INT                  AS score,
  COUNT(*)::INT                        AS votes
FROM artist_picks
GROUP BY LOWER(artist_name)
ORDER BY score DESC, votes DESC, display_name ASC;
`;

const ALBUM_QUERY = `
SELECT
  LOWER(album_name) || '\u200b' || LOWER(artist_name) AS key,
  MAX(album_name)                       AS display_name,
  MAX(artist_name)                      AS artist,
  (ARRAY_AGG(image_url) FILTER (WHERE image_url IS NOT NULL))[1] AS image_url,
  SUM(26 - rank)::INT                   AS score,
  COUNT(*)::INT                         AS votes
FROM album_picks
GROUP BY LOWER(album_name), LOWER(artist_name)
ORDER BY score DESC, votes DESC, display_name ASC;
`;

function withRanksAndTies(rows: AggregateRawRow[]): AggregateRow[] {
  // Assign dense rank by score (ties share the same rank). Then take everyone
  // up to and including the row at logical position 10, so ties at 10 are kept.
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

    if (currentRank > 10) break;

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

export async function getAggregate(): Promise<AggregateResponse> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.value;

  const [artistRows, albumRows] = await Promise.all([
    pool.query<AggregateRawRow>(ARTIST_QUERY),
    pool.query<AggregateRawRow>(ALBUM_QUERY),
  ]);

  const value: AggregateResponse = {
    artists: withRanksAndTies(artistRows.rows),
    albums: withRanksAndTies(albumRows.rows),
  };

  cache = { value, expires: now + CACHE_MS };
  return value;
}

export function invalidateAggregateCache(): void {
  cache = null;
}
