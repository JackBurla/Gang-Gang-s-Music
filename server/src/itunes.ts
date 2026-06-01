// Thin wrapper around the iTunes Search API. Free, no key required.
// Docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI

const BASE = "https://itunes.apple.com/search";

type ITunesResult = {
  wrapperType?: string;
  artistName?: string;
  collectionName?: string;
  trackName?: string;
  artworkUrl100?: string;
  artistId?: number;
  collectionId?: number;
};

type ITunesResponse = {
  resultCount: number;
  results: ITunesResult[];
};

async function itunesSearch(params: Record<string, string>): Promise<ITunesResponse> {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  // The iTunes API can rate-limit; keep a sensible timeout.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
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

function upscale(artwork: string | undefined): string | undefined {
  if (!artwork) return undefined;
  // iTunes returns `100x100bb.jpg`. Swap for a larger size for a sharper render.
  return artwork.replace("100x100", "600x600");
}

export type Artwork = {
  imageUrl: string | undefined;
  matchedName?: string;
};

export async function lookupArtist(name: string): Promise<Artwork> {
  if (!name.trim()) return { imageUrl: undefined };

  // Try the artist endpoint first (returns no artwork directly, but gives us
  // a canonical artistId we can use to find their most-known album art).
  const artistRes = await itunesSearch({
    term: name,
    entity: "musicArtist",
    limit: "1",
  });
  const artist = artistRes.results[0];

  if (artist?.artistId !== undefined) {
    // Look up that artist's top albums and use the first artwork as the
    // de-facto "artist image". iTunes does not expose artist portraits
    // through its public API, so this is the standard workaround.
    const albumRes = await itunesSearch({
      term: name,
      entity: "album",
      attribute: "artistTerm",
      limit: "1",
    });
    const album = albumRes.results[0];
    if (album?.artworkUrl100) {
      return {
        imageUrl: upscale(album.artworkUrl100),
        matchedName: artist.artistName ?? name,
      };
    }
    return { imageUrl: undefined, matchedName: artist.artistName ?? name };
  }

  // Final fallback: do a generic search and grab whatever artwork comes back.
  const generic = await itunesSearch({ term: name, limit: "1" });
  const first = generic.results[0];
  return {
    imageUrl: upscale(first?.artworkUrl100),
    matchedName: first?.artistName ?? name,
  };
}

export async function lookupAlbum(
  album: string,
  artist: string
): Promise<Artwork> {
  if (!album.trim()) return { imageUrl: undefined };
  const term = artist.trim() ? `${album} ${artist}` : album;
  const res = await itunesSearch({
    term,
    entity: "album",
    limit: "1",
  });
  const first = res.results[0];
  return {
    imageUrl: upscale(first?.artworkUrl100),
    matchedName: first?.collectionName ?? album,
  };
}
