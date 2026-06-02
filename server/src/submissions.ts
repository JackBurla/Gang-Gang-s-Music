import crypto from "node:crypto";
import { pool, withTx } from "./db.js";
import {
  lookupAlbum,
  lookupArtist,
  resolveAlbumOverrideUrl,
  resolveArtistOverrideUrl,
} from "./itunes.js";
import { invalidateAggregateCache } from "./aggregate.js";
import type {
  Submission,
  SubmissionInput,
  SubmissionSummary,
} from "./types.js";

const MAX_ARTISTS = 10;
const MIN_ALBUMS = 10;
const MAX_ALBUMS = 25;
const MAX_NAME_LEN = 60;
const MAX_FIELD_LEN = 120;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function clean(s: unknown, max = MAX_FIELD_LEN): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

function genToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function validate(input: unknown): SubmissionInput {
  if (!input || typeof input !== "object") {
    throw new HttpError(400, "Body must be an object.");
  }
  const obj = input as Record<string, unknown>;
  const name = clean(obj.name, MAX_NAME_LEN);
  if (!name) throw new HttpError(400, "Please include a name.");

  const rawArtists = Array.isArray(obj.artists) ? obj.artists : [];
  const artists = rawArtists
    .slice(0, MAX_ARTISTS)
    .map((a) => clean(a))
    .filter((a) => a.length > 0);
  if (artists.length === 0) {
    throw new HttpError(400, "Please include at least one artist.");
  }

  const rawAlbums = Array.isArray(obj.albums) ? obj.albums : [];
  const albums = rawAlbums
    .slice(0, MAX_ALBUMS)
    .map((a) => {
      if (!a || typeof a !== "object") return { album: "", artist: "" };
      const ao = a as Record<string, unknown>;
      return { album: clean(ao.album), artist: clean(ao.artist) };
    })
    .filter((a) => a.album.length > 0);
  if (albums.length < MIN_ALBUMS) {
    throw new HttpError(
      400,
      `Please include at least ${MIN_ALBUMS} albums (you have ${albums.length}). You can include up to ${MAX_ALBUMS}.`
    );
  }

  const editToken =
    typeof obj.editToken === "string" ? obj.editToken.trim() : undefined;

  return { name, artists, albums, editToken };
}

async function enrichSubmission(input: SubmissionInput): Promise<{
  artists: { rank: number; name: string; imageUrl: string | null }[];
  albums: {
    rank: number;
    album: string;
    artist: string;
    imageUrl: string | null;
  }[];
}> {
  const artistLookups = await Promise.all(
    input.artists.map((name) => lookupArtist(name))
  );
  const albumLookups = await Promise.all(
    input.albums.map(({ album, artist }) => lookupAlbum(album, artist))
  );

  return {
    artists: input.artists.map((name, i) => ({
      rank: i + 1,
      name,
      imageUrl: artistLookups[i]?.imageUrl ?? null,
    })),
    albums: input.albums.map(({ album, artist }, i) => ({
      rank: i + 1,
      album,
      artist,
      imageUrl: albumLookups[i]?.imageUrl ?? null,
    })),
  };
}

export async function upsertSubmission(input: SubmissionInput): Promise<{
  submission: Submission;
  editToken: string;
}> {
  const existing = await pool.query<{ id: number; edit_token: string }>(
    "SELECT id, edit_token FROM submissions WHERE LOWER(name) = LOWER($1) LIMIT 1",
    [input.name]
  );

  // Friend-grade trust: anyone who knows the name can edit. The edit_token is
  // no longer a credential check; we keep it stable across edits so the
  // original submitter's localStorage stays predictable.
  const editToken =
    existing.rows.length > 0 ? existing.rows[0]!.edit_token : genToken();

  const enriched = await enrichSubmission(input);

  const submission = await withTx(async (client) => {
    const ins = await client.query<{
      id: number;
      name: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      INSERT INTO submissions (name, edit_token)
      VALUES ($1, $2)
      ON CONFLICT (name)
      DO UPDATE SET updated_at = NOW()
      RETURNING id, name, created_at, updated_at;
      `,
      [input.name, editToken]
    );
    const row = ins.rows[0]!;

    await client.query("DELETE FROM artist_picks WHERE submission_id = $1", [
      row.id,
    ]);
    await client.query("DELETE FROM album_picks WHERE submission_id = $1", [
      row.id,
    ]);

    for (const a of enriched.artists) {
      await client.query(
        `INSERT INTO artist_picks (submission_id, rank, artist_name, image_url)
         VALUES ($1, $2, $3, $4)`,
        [row.id, a.rank, a.name, a.imageUrl]
      );
    }
    for (const a of enriched.albums) {
      await client.query(
        `INSERT INTO album_picks (submission_id, rank, album_name, artist_name, image_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.id, a.rank, a.album, a.artist, a.imageUrl]
      );
    }

    return {
      name: row.name,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      artists: enriched.artists,
      albums: enriched.albums,
    } satisfies Submission;
  });

  invalidateAggregateCache();
  return { submission, editToken };
}

export async function listSubmissions(): Promise<SubmissionSummary[]> {
  const res = await pool.query<{ name: string; updated_at: Date }>(
    "SELECT name, updated_at FROM submissions ORDER BY LOWER(name) ASC"
  );
  return res.rows.map((r) => ({
    name: r.name,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function refreshSubmissionArtwork(
  name: string,
  _editToken: string
): Promise<Submission> {
  const existing = await pool.query<{ id: number }>(
    "SELECT id FROM submissions WHERE LOWER(name) = LOWER($1) LIMIT 1",
    [name]
  );
  if (existing.rows.length === 0) {
    throw new HttpError(404, "Submission not found.");
  }
  const row = existing.rows[0]!;

  const current = await getSubmission(name);
  if (!current) {
    throw new HttpError(404, "Submission not found.");
  }

  const enriched = await enrichSubmission({
    name: current.name,
    artists: current.artists.map((a) => a.name),
    albums: current.albums.map((a) => ({ album: a.album, artist: a.artist })),
  });

  await withTx(async (client) => {
    for (const a of enriched.artists) {
      await client.query(
        `UPDATE artist_picks SET image_url = $1
         WHERE submission_id = $2 AND rank = $3`,
        [a.imageUrl, row.id, a.rank]
      );
    }
    for (const a of enriched.albums) {
      await client.query(
        `UPDATE album_picks SET image_url = $1
         WHERE submission_id = $2 AND rank = $3`,
        [a.imageUrl, row.id, a.rank]
      );
    }
    await client.query(
      "UPDATE submissions SET updated_at = NOW() WHERE id = $1",
      [row.id]
    );
  });

  invalidateAggregateCache();
  const updated = await getSubmission(name);
  if (!updated) throw new HttpError(500, "Refresh succeeded but reload failed.");
  return updated;
}

export async function getSubmission(name: string): Promise<Submission | null> {
  const subRes = await pool.query<{
    id: number;
    name: string;
    created_at: Date;
    updated_at: Date;
  }>(
    "SELECT id, name, created_at, updated_at FROM submissions WHERE LOWER(name) = LOWER($1) LIMIT 1",
    [name]
  );
  if (subRes.rows.length === 0) return null;
  const sub = subRes.rows[0]!;

  const [artistsRes, albumsRes] = await Promise.all([
    pool.query<{
      rank: number;
      artist_name: string;
      image_url: string | null;
    }>(
      "SELECT rank, artist_name, image_url FROM artist_picks WHERE submission_id = $1 ORDER BY rank ASC",
      [sub.id]
    ),
    pool.query<{
      rank: number;
      album_name: string;
      artist_name: string;
      image_url: string | null;
    }>(
      "SELECT rank, album_name, artist_name, image_url FROM album_picks WHERE submission_id = $1 ORDER BY rank ASC",
      [sub.id]
    ),
  ]);

  // Apply the same display-time overrides that the home aggregate uses, so
  // user pages don't "revert" to the originally-stored iTunes URLs.
  const artists = await Promise.all(
    artistsRes.rows.map(async (r) => {
      const override = await resolveArtistOverrideUrl(r.artist_name);
      return {
        rank: r.rank,
        name: r.artist_name,
        imageUrl: override ?? r.image_url,
      };
    })
  );
  const albums = await Promise.all(
    albumsRes.rows.map(async (r) => {
      const override = await resolveAlbumOverrideUrl(
        r.album_name,
        r.artist_name
      );
      return {
        rank: r.rank,
        album: r.album_name,
        artist: r.artist_name,
        imageUrl: override ?? r.image_url,
      };
    })
  );

  return {
    name: sub.name,
    createdAt: sub.created_at.toISOString(),
    updatedAt: sub.updated_at.toISOString(),
    artists,
    albums,
  };
}
