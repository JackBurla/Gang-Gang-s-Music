// Wrapper around the iTunes Search + Lookup APIs. Free, no key required.
// Docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI
//
// For albums we use a 2-step lookup:
//   1. find the artist's iTunes artistId via /search?entity=musicArtist
//   2. fetch the artist's discography via /lookup?id=<artistId>&entity=album
// then match the user's album title against the discography. This is dramatically
// more accurate than a single /search call because iTunes' relevance is poor
// for short, common album titles like "Blonde" or "Currents".

const SEARCH = "https://itunes.apple.com/search";
const LOOKUP = "https://itunes.apple.com/lookup";
const FETCH_TIMEOUT_MS = 6000;

type ITunesResult = {
  wrapperType?: string;
  collectionType?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  artistId?: number;
  collectionId?: number;
};

type ITunesResponse = {
  resultCount: number;
  results: ITunesResult[];
};

async function getJson(url: URL): Promise<ITunesResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { resultCount: 0, results: [] };
    return (await res.json()) as ITunesResponse;
  } catch {
    return { resultCount: 0, results: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function search(params: Record<string, string>): Promise<ITunesResponse> {
  const url = new URL(SEARCH);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return getJson(url);
}

function lookup(params: Record<string, string>): Promise<ITunesResponse> {
  const url = new URL(LOOKUP);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return getJson(url);
}

function upscale(artwork: string | undefined): string | undefined {
  if (!artwork) return undefined;
  return artwork.replace("100x100", "600x600");
}

// Match the SQL normalization in aggregate.ts. Lowercase, strip diacritics,
// strip leading "the ", keep only [a-z0-9]. So "Is This It?", "Is This It",
// and "is this it" all collapse to "isthisit"; "The Dark Side of the Moon"
// and "Dark Side of the Moon" both collapse to "darksideofthemoon".
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

// Famous albums where the popular nickname doesn't match the iTunes title.
// Keyed by normalized(artist) + normalized(alias). The value is the iTunes
// `collectionName` we should match against in the discography lookup.
// Extend this list as you find gaps.
const ALBUM_ALIASES: Record<string, string> = {
  // Weezer color albums. iTunes uses "(<color> Album)" for all but the 1994 LP.
  // For Blue Album we point to "Weezer (2024 Remaster)", which has the original
  // iconic blue cover. The "Weezer (Deluxe Edition)" listing uses different art.
  "weezer|bluealbum": "Weezer (2024 Remaster)",
  "weezer|blue": "Weezer (2024 Remaster)",
  "weezer|greenalbum": "Weezer (Green Album)",
  "weezer|green": "Weezer (Green Album)",
  "weezer|redalbum": "Weezer (Red Album)",
  "weezer|red": "Weezer (Red Album)",
  "weezer|whitealbum": "Weezer (White Album)",
  "weezer|white": "Weezer (White Album)",
  "weezer|blackalbum": "Weezer (Black Album)",
  "weezer|black": "Weezer (Black Album)",
  "weezer|tealalbum": "Weezer (Teal Album)",
  "weezer|teal": "Weezer (Teal Album)",
  // Other classic nicknames.
  "beatles|whitealbum": "The Beatles",
  "metallica|blackalbum": "Metallica",
  "jayz|blackalbum": "The Black Album",
  "ledzeppelin|iv": "Led Zeppelin IV",
  "ledzeppelin|zoso": "Led Zeppelin IV",
  "princeandtherevolution|purplerain": "Purple Rain",
};

function aliasFor(album: string, artist: string): string | null {
  const key = `${normalize(artist)}|${normalize(album)}`;
  return ALBUM_ALIASES[key] ?? null;
}

// Per-artist override: when someone picks one of these artists, the artist
// tile uses the cover of the specified album instead of iTunes' default
// "most recent album" pick. Keyed by normalized(artist).
//
// Applied at submission time (so new picks store the override URL) AND at
// aggregate display time (so already-submitted picks also show the override
// without a DB backfill).
export const ARTIST_IMAGE_OVERRIDES: Record<string, string> = {
  davidbowie: "Aladdin Sane",
  bowie: "Aladdin Sane",
  kendricklamar: "To Pimp a Butterfly",
  kendrick: "To Pimp a Butterfly",
  kdot: "To Pimp a Butterfly",
  kanyewest: "Graduation",
  kanye: "Graduation",
  ye: "Graduation",
  radiohead: "Kid A",
  beatles: "Sgt. Pepper's Lonely Hearts Club Band",
  tylerthecreator: "Flower Boy",
  tyler: "Flower Boy",
};

export function artistImageOverrideAlbum(artistName: string): string | null {
  return ARTIST_IMAGE_OVERRIDES[normalize(artistName)] ?? null;
}

// Per-album display override: forces a specific iTunes album title for these
// (artist, album) pairs whenever they're shown. Used to fix already-submitted
// rows in the DB without a backfill — applied wherever album image_urls are
// served (aggregate + per-user pages).
// Keyed by `${normalize(artist)}|${normalize(album)}`.
const ALBUM_DISPLAY_OVERRIDES: Record<string, string> = {
  // Weezer Blue Album: force the 2024 Remaster cover (original iconic blue
  // art) over the Deluxe Edition cover that older picks may have stored.
  "weezer|weezer": "Weezer (2024 Remaster)",
  "weezer|bluealbum": "Weezer (2024 Remaster)",
  "weezer|weezerbluealbum": "Weezer (2024 Remaster)",
};

export function albumImageOverrideTitle(
  album: string,
  artist: string
): string | null {
  const key = `${normalize(artist)}|${normalize(album)}`;
  return ALBUM_DISPLAY_OVERRIDES[key] ?? null;
}

// Long-lived in-process cache of resolved override URLs so we don't re-hit
// iTunes on every request. Separate from the 15-min `cache` for general
// lookups because override URLs are extremely stable.
const overrideUrlCache = new Map<string, string | null>();

export async function resolveArtistOverrideUrl(
  artistName: string
): Promise<string | null> {
  const key = `artist:${normalize(artistName)}`;
  if (overrideUrlCache.has(key)) return overrideUrlCache.get(key) ?? null;

  const albumTitle = artistImageOverrideAlbum(artistName);
  if (!albumTitle) {
    overrideUrlCache.set(key, null);
    return null;
  }
  const art = await lookupAlbum(albumTitle, artistName);
  const url = art.imageUrl ?? null;
  overrideUrlCache.set(key, url);
  return url;
}

export async function resolveAlbumOverrideUrl(
  album: string,
  artist: string
): Promise<string | null> {
  const key = `album:${normalize(artist)}|${normalize(album)}`;
  if (overrideUrlCache.has(key)) return overrideUrlCache.get(key) ?? null;

  const overrideTitle = albumImageOverrideTitle(album, artist);
  if (!overrideTitle) {
    overrideUrlCache.set(key, null);
    return null;
  }
  const art = await lookupAlbum(overrideTitle, artist);
  const url = art.imageUrl ?? null;
  overrideUrlCache.set(key, url);
  return url;
}

// Lightweight TTL cache so the form's live previews don't hammer iTunes.
const cache = new Map<string, { value: Artwork; expires: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

function cached<T extends Artwork>(key: string, value: T): T {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

function fromCache(key: string): Artwork | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export type Artwork = {
  imageUrl: string | undefined;
  matchedName?: string;
};

async function findArtistId(name: string): Promise<{
  artistId: number | undefined;
  artistName: string | undefined;
}> {
  const res = await search({
    term: name,
    entity: "musicArtist",
    attribute: "artistTerm",
    limit: "1",
  });
  const first = res.results[0];
  return {
    artistId: first?.artistId,
    artistName: first?.artistName,
  };
}

export async function lookupArtist(name: string): Promise<Artwork> {
  const q = name.trim();
  if (!q) return { imageUrl: undefined };
  const cacheKey = `artist:${normalize(q)}`;
  const hit = fromCache(cacheKey);
  if (hit) return hit;

  // Hard override: use a specific album cover for certain artists, regardless
  // of what iTunes thinks is the artist's "default" album.
  const overrideAlbum = artistImageOverrideAlbum(q);
  if (overrideAlbum) {
    const art = await lookupAlbum(overrideAlbum, q);
    if (art.imageUrl) {
      return cached(cacheKey, { imageUrl: art.imageUrl, matchedName: q });
    }
  }

  const { artistId, artistName } = await findArtistId(q);

  // iTunes has no public artist-image endpoint. Standard workaround: use the
  // artwork of the artist's most-recent or most-popular album.
  if (artistId) {
    const albums = await lookup({
      id: String(artistId),
      entity: "album",
      limit: "5",
    });
    const album = albums.results.find(
      (r) => r.wrapperType === "collection" && r.artworkUrl100
    );
    if (album?.artworkUrl100) {
      return cached(cacheKey, {
        imageUrl: upscale(album.artworkUrl100),
        matchedName: artistName ?? q,
      });
    }
  }

  // Fallback: any artwork we can find for this term.
  const generic = await search({ term: q, limit: "1" });
  const g = generic.results[0];
  return cached(cacheKey, {
    imageUrl: upscale(g?.artworkUrl100),
    matchedName: g?.artistName ?? q,
  });
}

function scoreAlbumMatch(target: string, candidate: string): number {
  const t = normalize(target);
  const c = normalize(candidate);
  if (!t || !c) return 0;
  if (t === c) return 100;

  // Without spaces our normalized strings concatenate words, so we work on
  // the lowercased-with-spaces variant for "is this a remix/single/etc." style
  // signals. The penalty list below catches iTunes' usual cruft.
  const raw = candidate.toLowerCase();
  let score = 0;
  if (c.startsWith(t)) score += 60;
  else if (c.includes(t)) score += 30;
  if (raw.endsWith("- single") || raw.endsWith("(single)")) score -= 25;
  if (raw.endsWith("- ep") || raw.endsWith("(ep)")) score -= 15;
  if (raw.includes("deluxe")) score -= 5;
  if (raw.includes("remix")) score -= 20;
  if (raw.includes("live")) score -= 10;
  if (raw.includes("instrumental")) score -= 25;
  if (raw.includes("remaster")) score -= 5;
  return score;
}

export async function lookupAlbum(
  album: string,
  artist: string
): Promise<Artwork> {
  const albumQ = album.trim();
  if (!albumQ) return { imageUrl: undefined };
  const artistQ = artist.trim();
  const cacheKey = `album:${normalize(albumQ)}|${normalize(artistQ)}`;
  const hit = fromCache(cacheKey);
  if (hit) return hit;

  // Preferred path: find the artist, scan their discography, score-match the album.
  if (artistQ) {
    const { artistId } = await findArtistId(artistQ);
    if (artistId) {
      const albums = await lookup({
        id: String(artistId),
        entity: "album",
        limit: "200",
      });

      // Famous-nickname override (e.g. Weezer "Blue Album" -> "Weezer (Deluxe Edition)").
      // If we have a known alias for this artist+title, prefer the candidate
      // whose iTunes title matches the canonical name exactly.
      const aliasName = aliasFor(albumQ, artistQ);
      if (aliasName) {
        const target = normalize(aliasName);
        const aliasMatch = albums.results.find(
          (r) =>
            r.wrapperType === "collection" &&
            r.collectionName &&
            normalize(r.collectionName) === target
        );
        if (aliasMatch?.artworkUrl100) {
          return cached(cacheKey, {
            imageUrl: upscale(aliasMatch.artworkUrl100),
            matchedName: albumQ,
          });
        }
      }

      let best: { score: number; result: ITunesResult } | null = null;
      for (const r of albums.results) {
        if (r.wrapperType !== "collection") continue;
        if (!r.collectionName) continue;
        const score = scoreAlbumMatch(albumQ, r.collectionName);
        if (score > 0 && (!best || score > best.score)) {
          best = { score, result: r };
        }
      }
      if (best && best.score >= 30) {
        return cached(cacheKey, {
          imageUrl: upscale(best.result.artworkUrl100),
          matchedName: best.result.collectionName ?? albumQ,
        });
      }
    }
  }

  // Fallback: generic album search filtered by the album-title attribute.
  // Pull a few results and pick the best score across them so a featured-on
  // single doesn't beat the actual album.
  const generic = await search({
    term: artistQ ? `${albumQ} ${artistQ}` : albumQ,
    entity: "album",
    attribute: "albumTerm",
    limit: "10",
  });
  let best: { score: number; result: ITunesResult } | null = null;
  for (const r of generic.results) {
    if (!r.collectionName) continue;
    // If we have an artist, require it to roughly match the candidate's artist
    // name; this filters out same-titled albums by other people.
    if (artistQ) {
      const a = normalize(r.artistName ?? "");
      const want = normalize(artistQ);
      if (!a.includes(want) && !want.includes(a)) continue;
    }
    const score = scoreAlbumMatch(albumQ, r.collectionName);
    if (score > 0 && (!best || score > best.score)) {
      best = { score, result: r };
    }
  }
  if (best) {
    return cached(cacheKey, {
      imageUrl: upscale(best.result.artworkUrl100),
      matchedName: best.result.collectionName ?? albumQ,
    });
  }

  return cached(cacheKey, { imageUrl: undefined, matchedName: albumQ });
}
