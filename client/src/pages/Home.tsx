import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchAggregate } from "../api";
import ArtistVotesTable from "../components/ArtistVotesTable";
import Leaderboard from "../components/Leaderboard";
import type { AggregateResponse } from "../types";

export default function Home() {
  const [data, setData] = useState<AggregateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAggregate()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-14">
      <section className="space-y-4 pt-4">
        <div className="pill inline-block">the aggregate</div>
        <h1 className="wordmark text-4xl leading-tight text-ink-100 sm:text-6xl">
          Praise the Beatles. Praise Born.
        </h1>
        <p className="max-w-2xl text-base text-ink-200 sm:text-lg">
          Jesus, Joe Mazulla, Joe Biden.{" "}
          <Link
            to="/submit"
            className="text-accent underline-offset-4 hover:underline"
          >
            Add your picks
          </Link>
          .
        </p>
      </section>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <Leaderboard
        kicker="aggregate"
        title="10 Greatest Artists of All Time"
        rows={data?.artists ?? []}
        kind="artist"
      />

      <Leaderboard
        kicker="aggregate"
        title="Top 20 Albums of All Time"
        rows={data?.albums ?? []}
        kind="album"
        emptyMessage={"No albums yet. Expect ties \u2014 that's encouraged."}
      />

      <section className="space-y-6">
        <header className="space-y-2">
          <div className="pill inline-block">album voting power</div>
          <h2 className="wordmark text-3xl text-ink-100 sm:text-4xl">
            Artists with the Most Votes
          </h2>
          <p className="max-w-2xl text-sm text-ink-300">
            Every album pick counts toward its artist. Rank 1 album = 25 pts,
            rank 25 = 1 pt. Same scoring as the album board, summed by artist.
          </p>
        </header>
        <ArtistVotesTable rows={data?.artistsByAlbumScore ?? []} />
      </section>
    </div>
  );
}
