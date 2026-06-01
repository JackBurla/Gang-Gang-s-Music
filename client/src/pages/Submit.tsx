import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { fetchPreview, fetchSubmission, postSubmission } from "../api";
import { getEditToken, saveEditToken } from "../editToken";

const ARTIST_SLOTS = 10;
const MIN_ALBUM_SLOTS = 10;
const MAX_ALBUM_SLOTS = 25;

type AlbumEntry = { album: string; artist: string };

function makeEmpty<T>(count: number, make: () => T): T[] {
  return Array.from({ length: count }, make);
}

export default function Submit() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialName = searchParams.get("name") ?? "";

  const [name, setName] = useState(initialName);
  const [artists, setArtists] = useState<string[]>(
    makeEmpty(ARTIST_SLOTS, () => "")
  );
  const [albums, setAlbums] = useState<AlbumEntry[]>(
    makeEmpty(MIN_ALBUM_SLOTS, () => ({ album: "", artist: "" }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const editToken = useMemo(() => getEditToken(name), [name]);

  // Pre-fill the form with existing picks when the name matches a token in
  // localStorage. Debounced so brief typos in the name field don't clear the
  // form. Also clears the form if the user changes the name away from a loaded
  // submission, to avoid accidentally saving someone else's picks under a new
  // name.
  useEffect(() => {
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    if (loadedFor === lower) return;

    const handle = window.setTimeout(() => {
      if (!trimmed) {
        if (loadedFor) {
          setArtists(makeEmpty(ARTIST_SLOTS, () => ""));
          setAlbums(makeEmpty(MIN_ALBUM_SLOTS, () => ({ album: "", artist: "" })));
          setLoadedFor(null);
        }
        return;
      }

      const token = getEditToken(trimmed);
      if (!token) {
        if (loadedFor) {
          setArtists(makeEmpty(ARTIST_SLOTS, () => ""));
          setAlbums(makeEmpty(MIN_ALBUM_SLOTS, () => ({ album: "", artist: "" })));
          setLoadedFor(null);
        }
        return;
      }

      setLoading(true);
      fetchSubmission(trimmed)
        .then((sub) => {
          const padArtists = sub.artists.map((a) => a.name);
          while (padArtists.length < ARTIST_SLOTS) padArtists.push("");
          setArtists(padArtists.slice(0, ARTIST_SLOTS));

          const incomingAlbums = sub.albums.map((a) => ({
            album: a.album,
            artist: a.artist,
          }));
          // If they originally submitted more than MIN_ALBUM_SLOTS, render all
          // of them so every pick is editable.
          const targetCount = Math.max(MIN_ALBUM_SLOTS, incomingAlbums.length);
          const padded = incomingAlbums.slice();
          while (padded.length < targetCount) padded.push({ album: "", artist: "" });
          setAlbums(padded.slice(0, MAX_ALBUM_SLOTS));

          setLoadedFor(lower);
        })
        .catch(() => {
          // Stored token but API can't find the submission. Leave form alone.
        })
        .finally(() => {
          setLoading(false);
        });
    }, 350);

    return () => window.clearTimeout(handle);
  }, [name, loadedFor]);

  const filledArtists = artists.filter((a) => a.trim().length > 0);
  const filledAlbums = albums.filter((a) => a.album.trim().length > 0);

  const canSubmit =
    name.trim().length > 0 &&
    filledArtists.length > 0 &&
    filledAlbums.length >= MIN_ALBUM_SLOTS &&
    !submitting;

  const canAddAlbum = albums.length < MAX_ALBUM_SLOTS;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await postSubmission({
        name: name.trim(),
        editToken: editToken ?? undefined,
        artists: filledArtists,
        albums: filledAlbums,
      });
      saveEditToken(result.submission.name, result.editToken);
      navigate(`/u/${encodeURIComponent(result.submission.name)}`, {
        replace: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const isEditing = loadedFor !== null && loadedFor === name.trim().toLowerCase();

  return (
    <div className="space-y-10">
      <section className="space-y-3 pt-4">
        <div className="pill inline-block">{isEditing ? "edit" : "submit"}</div>
        <h1 className="wordmark text-4xl leading-tight text-ink-100 sm:text-5xl">
          {isEditing ? `Editing ${name}'s picks.` : "Drop your picks."}
        </h1>
        <p className="max-w-2xl text-ink-200">
          {isEditing ? (
            <>
              Change whatever you want and hit <strong>Save changes</strong> at
              the bottom. Leave the rest alone &mdash; you don&rsquo;t have to
              retype anything.
            </>
          ) : (
            <>
              Your top 10 in order &mdash; rank 1 is the GOAT, rank 10 is still
              undeniable. Album art and artist photos auto-populate from
              iTunes. If you&rsquo;re editing your existing list, use the same
              name and same browser.
            </>
          )}
        </p>
      </section>

      <form onSubmit={onSubmit} className="space-y-10">
        <div>
          <label htmlFor="name" className="mb-2 block text-sm font-medium">
            Your name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jack"
            className="input max-w-sm"
            maxLength={60}
            autoComplete="off"
            required
          />
          {loading && (
            <p className="mt-2 text-xs text-ink-300">
              Loading your existing picks&hellip;
            </p>
          )}
          {!loading && isEditing && (
            <p className="mt-2 text-xs text-accent">
              Your picks are pre-filled below.
            </p>
          )}
          {!loading && editToken && !isEditing && (
            <p className="mt-2 text-xs text-ink-300">
              We have a saved edit token for this name. Click out of the field
              to load your picks.
            </p>
          )}
        </div>

        <section className="space-y-4">
          <h2 className="wordmark text-2xl text-ink-100">
            10 Greatest Artists of All Time
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {artists.map((value, i) => (
              <ArtistRow
                key={`artist-${i}`}
                rank={i + 1}
                value={value}
                onChange={(v) => {
                  const next = artists.slice();
                  next[i] = v;
                  setArtists(next);
                }}
              />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="wordmark text-2xl text-ink-100">
              Top 10 Albums of All Time
            </h2>
            <span className="text-xs text-ink-300">
              {MIN_ALBUM_SLOTS} required &middot; up to {MAX_ALBUM_SLOTS} allowed
            </span>
          </div>
          <div className="grid gap-3">
            {albums.map((value, i) => (
              <AlbumRow
                key={`album-${i}`}
                rank={i + 1}
                value={value}
                isExtra={i >= MIN_ALBUM_SLOTS}
                onChange={(v) => {
                  const next = albums.slice();
                  next[i] = v;
                  setAlbums(next);
                }}
                onRemove={
                  i >= MIN_ALBUM_SLOTS
                    ? () => setAlbums(albums.filter((_, j) => j !== i))
                    : undefined
                }
              />
            ))}
          </div>
          <div>
            <button
              type="button"
              disabled={!canAddAlbum}
              onClick={() =>
                setAlbums([...albums, { album: "", artist: "" }])
              }
              className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
            >
              {canAddAlbum
                ? `+ Add another album (${albums.length}/${MAX_ALBUM_SLOTS})`
                : `Album limit reached (${MAX_ALBUM_SLOTS}/${MAX_ALBUM_SLOTS})`}
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!canSubmit} className="btn-primary">
            {submitting
              ? "Submitting\u2026"
              : isEditing
                ? "Save changes"
                : "Submit picks"}
          </button>
          <span className="text-xs text-ink-300">
            {filledArtists.length}/{ARTIST_SLOTS} artists &middot;{" "}
            {filledAlbums.length}/{albums.length} albums
            {filledAlbums.length < MIN_ALBUM_SLOTS && (
              <span className="text-accent">
                {" "}
                (need {MIN_ALBUM_SLOTS - filledAlbums.length} more)
              </span>
            )}
          </span>
        </div>
      </form>
    </div>
  );
}

function useDebouncedPreview(
  type: "artist" | "album",
  q: string,
  artist?: string
) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setImageUrl(null);
      return;
    }
    timer.current = window.setTimeout(() => {
      fetchPreview(type, trimmed, artist?.trim())
        .then((r) => setImageUrl(r.imageUrl))
        .catch(() => setImageUrl(null));
    }, 450);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [type, q, artist]);

  return imageUrl;
}

function Thumb({ src }: { src: string | null }) {
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-ink-700 bg-ink-900">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-ink-800 to-ink-900" />
      )}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-800 font-display text-sm text-accent">
      {rank}
    </span>
  );
}

function ArtistRow({
  rank,
  value,
  onChange,
}: {
  rank: number;
  value: string;
  onChange: (v: string) => void;
}) {
  const img = useDebouncedPreview("artist", value);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/40 p-2">
      <RankBadge rank={rank} />
      <Thumb src={img} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Artist name"
        className="input flex-1"
        maxLength={120}
        autoComplete="off"
      />
    </div>
  );
}

function AlbumRow({
  rank,
  value,
  isExtra,
  onChange,
  onRemove,
}: {
  rank: number;
  value: AlbumEntry;
  isExtra: boolean;
  onChange: (v: AlbumEntry) => void;
  onRemove?: () => void;
}) {
  const img = useDebouncedPreview("album", value.album, value.artist);
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border bg-ink-900/40 p-2 sm:flex-row sm:items-center ${
        isExtra ? "border-ink-800/60 border-dashed" : "border-ink-800"
      }`}
    >
      <div className="flex items-center gap-3">
        <RankBadge rank={rank} />
        <Thumb src={img} />
      </div>
      <input
        value={value.album}
        onChange={(e) => onChange({ ...value, album: e.target.value })}
        placeholder="Album title"
        className="input flex-1"
        maxLength={120}
        autoComplete="off"
      />
      <input
        value={value.artist}
        onChange={(e) => onChange({ ...value, artist: e.target.value })}
        placeholder="Artist"
        className="input sm:max-w-xs"
        maxLength={120}
        autoComplete="off"
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove album at rank ${rank}`}
          className="rounded-full border border-ink-700 px-2 py-1 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
        >
          Remove
        </button>
      )}
    </div>
  );
}
