import RankedCard from "./RankedCard";
import type { AggregateRow } from "../types";

type Props = {
  title: string;
  kicker?: string;
  rows: AggregateRow[];
  kind: "artist" | "album";
  emptyMessage?: string;
};

function votesLabel(votes: number): string {
  return votes === 1 ? "1 vote" : `${votes} votes`;
}

export default function Leaderboard({
  title,
  kicker,
  rows,
  kind,
  emptyMessage,
}: Props) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        {kicker && <div className="pill inline-block">{kicker}</div>}
        <h2 className="wordmark text-3xl text-ink-100 sm:text-4xl">{title}</h2>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-300">
          {emptyMessage ?? "No picks yet. Be the first to submit."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((row) => (
            <RankedCard
              key={`${kind}-${row.rank}-${row.displayName}-${row.artist ?? ""}`}
              rank={row.rank}
              imageUrl={row.imageUrl}
              title={row.displayName}
              subtitle={kind === "album" ? row.artist : undefined}
              meta={`${row.score} pts \u00b7 ${votesLabel(row.votes)}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
