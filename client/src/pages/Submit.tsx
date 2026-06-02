import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { fetchPreview, fetchSubmission, postSubmission } from "../api";
import { getEditToken, saveEditToken } from "../editToken";

const ARTIST_SLOTS = 10;
const MIN_ALBUM_SLOTS = 10;
const MAX_ALBUM_SLOTS = 25;

type ArtistRow = { id: string; value: string };
type AlbumRow = { id: string; album: string; artist: string };

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function emptyArtists(count: number): ArtistRow[] {
  return Array.from({ length: count }, () => ({ id: uid(), value: "" }));
}

function emptyAlbums(count: number): AlbumRow[] {
  return Array.from({ length: count }, () => ({
    id: uid(),
    album: "",
    artist: "",
  }));
}

export default function Submit() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialName = searchParams.get("name") ?? "";

  const [name, setName] = useState(initialName);
  const [artists, setArtists] = useState<ArtistRow[]>(() =>
    emptyArtists(ARTIST_SLOTS)
  );
  const [albums, setAlbums] = useState<AlbumRow[]>(() =>
    emptyAlbums(MIN_ALBUM_SLOTS)
  );
  // Rows the user has explicitly opened for editing via the pencil button.
  // Empty rows are always editable regardless of this set.
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const editToken = useMemo(() => getEditToken(name), [name]);

  // Pre-fill the form with existing picks whenever the typed name matches an
  // existing submission, regardless of which browser is being used. This is
  // friend-grade trust: anyone who knows the name can edit. Debounced so brief
  // typos in the name field don't clear the form.
  useEffect(() => {
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    if (loadedFor === lower) return;

    const handle = window.setTimeout(() => {
      if (!trimmed) {
        if (loadedFor) {
          setArtists(emptyArtists(ARTIST_SLOTS));
          setAlbums(emptyAlbums(MIN_ALBUM_SLOTS));
          setEditingIds(new Set());
          setLoadedFor(null);
        }
        return;
      }

      setLoading(true);
      fetchSubmission(trimmed)
        .then((sub) => {
          const padArtists: ArtistRow[] = sub.artists.map((a) => ({
            id: uid(),
            value: a.name,
          }));
          while (padArtists.length < ARTIST_SLOTS) {
            padArtists.push({ id: uid(), value: "" });
          }
          setArtists(padArtists.slice(0, ARTIST_SLOTS));

          const incomingAlbums: AlbumRow[] = sub.albums.map((a) => ({
            id: uid(),
            album: a.album,
            artist: a.artist,
          }));
          const targetCount = Math.max(MIN_ALBUM_SLOTS, incomingAlbums.length);
          while (incomingAlbums.length < targetCount) {
            incomingAlbums.push({ id: uid(), album: "", artist: "" });
          }
          setAlbums(incomingAlbums.slice(0, MAX_ALBUM_SLOTS));

          setEditingIds(new Set());
          setLoadedFor(lower);
        })
        .catch(() => {
          // No submission with this name (likely 404). Clear any previously
          // pre-filled picks so the user starts fresh.
          if (loadedFor) {
            setArtists(emptyArtists(ARTIST_SLOTS));
            setAlbums(emptyAlbums(MIN_ALBUM_SLOTS));
            setEditingIds(new Set());
            setLoadedFor(null);
          }
        })
        .finally(() => {
          setLoading(false);
        });
    }, 350);

    return () => window.clearTimeout(handle);
  }, [name, loadedFor]);

  const filledArtists = artists.filter((r) => r.value.trim().length > 0);
  const filledAlbums = albums.filter((r) => r.album.trim().length > 0);

  const canSubmit =
    name.trim().length > 0 &&
    filledArtists.length > 0 &&
    filledAlbums.length >= MIN_ALBUM_SLOTS &&
    !submitting;

  const canAddAlbum = albums.length < MAX_ALBUM_SLOTS;

  function isEditing(row: { id: string }, isEmpty: boolean): boolean {
    return isEmpty || editingIds.has(row.id);
  }

  function openEdit(id: string) {
    setEditingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function closeEdit(id: string) {
    setEditingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function removeAlbum(id: string) {
    setAlbums((prev) => prev.filter((r) => r.id !== id));
    closeEdit(id);
  }

  function addAlbum() {
    const row: AlbumRow = { id: uid(), album: "", artist: "" };
    setAlbums((prev) => [...prev, row]);
  }

  function updateArtist(id: string, value: string) {
    setArtists((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }

  function updateAlbum(id: string, patch: Partial<Omit<AlbumRow, "id">>) {
    setAlbums((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function onArtistDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setArtists((prev) => {
      const oldIdx = prev.findIndex((r) => r.id === active.id);
      const newIdx = prev.findIndex((r) => r.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  function onAlbumDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setAlbums((prev) => {
      const oldIdx = prev.findIndex((r) => r.id === active.id);
      const newIdx = prev.findIndex((r) => r.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await postSubmission({
        name: name.trim(),
        editToken: editToken ?? undefined,
        artists: filledArtists.map((r) => r.value),
        albums: filledAlbums.map((r) => ({ album: r.album, artist: r.artist })),
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

  const isEditingExisting =
    loadedFor !== null && loadedFor === name.trim().toLowerCase();

  return (
    <div className="space-y-10">
      <section className="space-y-3 pt-4">
        <div className="pill inline-block">
          {isEditingExisting ? "edit" : "submit"}
        </div>
        <h1 className="wordmark text-4xl leading-tight text-ink-100 sm:text-5xl">
          {isEditingExisting ? `Editing ${name}'s picks.` : "Drop your picks."}
        </h1>
        <p className="max-w-2xl text-ink-200">
          {isEditingExisting ? (
            <>
              Drag picks to reorder. Tap <strong>Edit</strong> on any row to
              change the pick itself. Hit <strong>Save changes</strong> at the
              bottom when done.
            </>
          ) : (
            <>
              Your top 10 in order &mdash; rank 1 is the GOAT, rank 10 is still
              undeniable. Album art and artist photos auto-populate from
              iTunes. Drag rows to reorder, click Edit to change a pick. To
              edit an existing list, just type the same name &mdash; any
              browser, any device.
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
              Looking up existing picks&hellip;
            </p>
          )}
          {!loading && isEditingExisting && (
            <p className="mt-2 text-xs text-accent">
              Existing picks pre-filled below &mdash; edit and save.
            </p>
          )}
        </div>

        <section className="space-y-4">
          <h2 className="wordmark text-2xl text-ink-100">
            10 Greatest Artists of All Time
          </h2>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onArtistDragEnd}
          >
            <SortableContext
              items={artists.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="grid gap-3">
                {artists.map((row, i) => (
                  <SortableArtistRow
                    key={row.id}
                    row={row}
                    rank={i + 1}
                    editing={isEditing(row, row.value.trim().length === 0)}
                    onChange={(value) => updateArtist(row.id, value)}
                    onEdit={() => openEdit(row.id)}
                    onDone={() => closeEdit(row.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onAlbumDragEnd}
          >
            <SortableContext
              items={albums.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="grid gap-3">
                {albums.map((row, i) => (
                  <SortableAlbumRow
                    key={row.id}
                    row={row}
                    rank={i + 1}
                    isExtra={i >= MIN_ALBUM_SLOTS}
                    editing={isEditing(row, row.album.trim().length === 0)}
                    onChange={(patch) => updateAlbum(row.id, patch)}
                    onEdit={() => openEdit(row.id)}
                    onDone={() => closeEdit(row.id)}
                    onRemove={
                      i >= MIN_ALBUM_SLOTS ? () => removeAlbum(row.id) : undefined
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <div>
            <button
              type="button"
              disabled={!canAddAlbum}
              onClick={addAlbum}
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
              : isEditingExisting
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

function GripIcon() {
  return (
    <svg
      width="14"
      height="20"
      viewBox="0 0 14 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="4" cy="10" r="1.5" />
      <circle cx="4" cy="16" r="1.5" />
      <circle cx="10" cy="4" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="10" cy="16" r="1.5" />
    </svg>
  );
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

function SortableArtistRow({
  row,
  rank,
  editing,
  onChange,
  onEdit,
  onDone,
}: {
  row: ArtistRow;
  rank: number;
  editing: boolean;
  onChange: (value: string) => void;
  onEdit: () => void;
  onDone: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const img = useDebouncedPreview("artist", row.value);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onDone();
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-xl border border-ink-800 bg-ink-900/40 p-2"
    >
      <button
        type="button"
        aria-label={`Drag artist at rank ${rank} to reorder`}
        className="cursor-grab touch-none rounded-md p-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <RankBadge rank={rank} />
      <Thumb src={img} />
      {editing ? (
        <input
          value={row.value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Artist name"
          className="input flex-1"
          maxLength={120}
          autoComplete="off"
          autoFocus={row.value.trim().length > 0}
        />
      ) : (
        <div className="flex-1 truncate px-1 text-sm text-ink-100">
          {row.value || (
            <span className="italic text-ink-300">No artist yet</span>
          )}
        </div>
      )}
      <RowActionButton
        editing={editing}
        canSwitch={row.value.trim().length > 0}
        onEdit={onEdit}
        onDone={onDone}
      />
    </div>
  );
}

function SortableAlbumRow({
  row,
  rank,
  isExtra,
  editing,
  onChange,
  onEdit,
  onDone,
  onRemove,
}: {
  row: AlbumRow;
  rank: number;
  isExtra: boolean;
  editing: boolean;
  onChange: (patch: Partial<Omit<AlbumRow, "id">>) => void;
  onEdit: () => void;
  onDone: () => void;
  onRemove?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const img = useDebouncedPreview("album", row.album, row.artist);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onDone();
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col gap-2 rounded-xl border bg-ink-900/40 p-2 sm:flex-row sm:items-center ${
        isExtra ? "border-dashed border-ink-800/60" : "border-ink-800"
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Drag album at rank ${rank} to reorder`}
          className="cursor-grab touch-none rounded-md p-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>
        <RankBadge rank={rank} />
        <Thumb src={img} />
      </div>
      {editing ? (
        <>
          <input
            value={row.album}
            onChange={(e) => onChange({ album: e.target.value })}
            onKeyDown={handleKey}
            placeholder="Album title"
            className="input flex-1"
            maxLength={120}
            autoComplete="off"
            autoFocus={row.album.trim().length > 0}
          />
          <input
            value={row.artist}
            onChange={(e) => onChange({ artist: e.target.value })}
            onKeyDown={handleKey}
            placeholder="Artist"
            className="input sm:max-w-xs"
            maxLength={120}
            autoComplete="off"
          />
        </>
      ) : (
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-sm font-medium text-ink-100">
            {row.album || (
              <span className="italic font-normal text-ink-300">
                No album yet
              </span>
            )}
          </div>
          {row.artist && (
            <div className="truncate text-xs text-ink-300">{row.artist}</div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <RowActionButton
          editing={editing}
          canSwitch={row.album.trim().length > 0}
          onEdit={onEdit}
          onDone={onDone}
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
    </div>
  );
}

function RowActionButton({
  editing,
  canSwitch,
  onEdit,
  onDone,
}: {
  editing: boolean;
  canSwitch: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  if (editing) {
    return (
      <button
        type="button"
        onClick={onDone}
        disabled={!canSwitch}
        className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition hover:border-accent/60 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-transparent disabled:text-ink-500"
        title={canSwitch ? "Collapse to card view" : "Add a pick first"}
      >
        Done
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
      title="Edit this pick"
    >
      Edit
    </button>
  );
}
