import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { fetchSubmission, refreshArtwork } from "../api";
import RankedCard from "../components/RankedCard";
import { getEditToken } from "../editToken";
import type { Submission } from "../types";

export default function UserPage() {
  const { name = "" } = useParams<{ name: string }>();
  const [sub, setSub] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSub(null);
    setError(null);
    fetchSubmission(name)
      .then((res) => {
        if (!cancelled) setSub(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const editToken = getEditToken(name);
  const hasEditToken = Boolean(editToken);

  async function onRefreshArtwork() {
    if (!editToken) return;
    setRefreshing(true);
    try {
      const { submission } = await refreshArtwork(name, editToken);
      setSub(submission);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4 pt-8">
        <div className="pill inline-block">404</div>
        <h1 className="wordmark text-4xl text-ink-100 sm:text-5xl">
          We couldn&rsquo;t find &ldquo;{name}&rdquo;.
        </h1>
        <p className="text-ink-200">{error}</p>
        <Link
          to={`/submit?name=${encodeURIComponent(name)}`}
          className="btn-primary"
        >
          Add picks for {name}
        </Link>
      </div>
    );
  }

  if (!sub) {
    return <SkeletonGrid />;
  }

  return (
    <div className="space-y-14">
      <section className="flex flex-col gap-4 pt-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="pill inline-block">picks by</div>
          <h1 className="wordmark text-4xl leading-tight text-ink-100 sm:text-6xl">
            {sub.name}
          </h1>
          <p className="text-sm text-ink-300">
            Last updated {new Date(sub.updatedAt).toLocaleDateString()}.
          </p>
        </div>
        {hasEditToken && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRefreshArtwork}
              disabled={refreshing}
              className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
              title="Re-run the iTunes lookups for every pick"
            >
              {refreshing ? "Refreshing\u2026" : "Refresh artwork"}
            </button>
            <Link
              to={`/submit?name=${encodeURIComponent(name)}`}
              className="btn-ghost"
            >
              Edit my picks
            </Link>
          </div>
        )}
      </section>

      <section className="space-y-6">
        <header className="space-y-2">
          <div className="pill inline-block">artists</div>
          <h2 className="wordmark text-3xl text-ink-100 sm:text-4xl">
            {sub.name}&rsquo;s 10 Greatest Artists of All Time
          </h2>
        </header>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {sub.artists.map((a) => (
            <RankedCard
              key={`artist-${a.rank}`}
              rank={a.rank}
              imageUrl={a.imageUrl}
              title={a.name}
            />
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <header className="space-y-2">
          <div className="pill inline-block">albums</div>
          <h2 className="wordmark text-3xl text-ink-100 sm:text-4xl">
            {sub.name}&rsquo;s Top 10 Albums of All Time
          </h2>
        </header>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {sub.albums.map((a) => (
            <RankedCard
              key={`album-${a.rank}`}
              rank={a.rank}
              imageUrl={a.imageUrl}
              title={a.album}
              subtitle={a.artist}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="space-y-8 pt-8">
      <div className="h-10 w-1/2 animate-pulse rounded bg-ink-800" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-2xl bg-ink-900"
          />
        ))}
      </div>
    </div>
  );
}
