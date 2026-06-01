import type { AggregateRow } from "../types";

type Props = {
  rows: AggregateRow[];
};

function FallbackThumb({ name }: { name: string }) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  const grad = `linear-gradient(135deg, hsl(${h} 55% 28%) 0%, hsl(${
    (h + 50) % 360
  } 60% 18%) 100%)`;
  const initial = (name[0] ?? "?").toUpperCase();
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-display text-ink-100/80"
      style={{ background: grad }}
    >
      {initial}
    </div>
  );
}

function votesLabel(votes: number): string {
  return votes === 1 ? "1 album pick" : `${votes} album picks`;
}

export default function ArtistVotesTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-300">
        No album picks yet. Once people submit, the most-loved artists rise to
        the top.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900/50">
      <table className="w-full text-left text-sm">
        <thead className="bg-ink-900/80 text-[11px] uppercase tracking-[0.16em] text-ink-300">
          <tr>
            <th className="w-12 px-4 py-3">#</th>
            <th className="px-3 py-3">Artist</th>
            <th className="hidden w-32 px-3 py-3 sm:table-cell">Album picks</th>
            <th className="w-24 px-4 py-3 text-right">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800/70">
          {rows.map((row) => (
            <tr
              key={`${row.rank}-${row.displayName}`}
              className="transition hover:bg-ink-900"
            >
              <td className="px-4 py-3 font-display text-base text-accent">
                {row.rank}
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-3">
                  {row.imageUrl ? (
                    <img
                      src={row.imageUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-md object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <FallbackThumb name={row.displayName} />
                  )}
                  <span className="text-ink-100">{row.displayName}</span>
                </div>
              </td>
              <td className="hidden px-3 py-3 text-ink-300 sm:table-cell">
                {votesLabel(row.votes)}
              </td>
              <td className="px-4 py-3 text-right font-display text-base text-ink-100">
                {row.score}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
