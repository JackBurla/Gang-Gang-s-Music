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

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    // strip combining diacritics
    .replace(/[\u0300-\u036f]/g, "")
    // collapse punctuation/whitespace
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  // Prefer exact prefix matches, but punish iTunes' " - Single" / " - EP" /
  // "(Deluxe)" cruft so a vanilla LP wins over a remix or single release of
  // the same name.
  let score = 0;
  if (c.startsWith(t)) score += 60;
  if (c.includes(t)) score += 30;
  if (c.endsWith(" single")) score -= 25;
  if (c.endsWith(" ep")) score -= 15;
  if (c.includes(" deluxe")) score -= 5;
  if (c.includes(" remix")) score -= 20;
  if (c.includes(" live")) score -= 10;
  if (c.includes(" instrumental")) score -= 25;
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
