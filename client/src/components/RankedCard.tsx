type Props = {
  rank: number;
  imageUrl: string | null;
  title: string;
  subtitle?: string;
  meta?: string;
};

function FallbackArt({ title }: { title: string }) {
  // Deterministic-ish hue from the title so each fallback feels distinct.
  let h = 0;
  for (let i = 0; i < title.length; i++) {
    h = (h * 31 + title.charCodeAt(i)) % 360;
  }
  const hue = h;
  const grad = `linear-gradient(135deg, hsl(${hue} 55% 28%) 0%, hsl(${
    (hue + 50) % 360
  } 60% 18%) 100%)`;
  const initials = title
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className="flex h-full w-full items-center justify-center font-display text-3xl text-ink-100/70"
      style={{ background: grad }}
    >
      {initials || "?"}
    </div>
  );
}

export default function RankedCard({
  rank,
  imageUrl,
  title,
  subtitle,
  meta,
}: Props) {
  return (
    <div className="card">
      <div className="aspect-square w-full overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <FallbackArt title={title} />
        )}
      </div>
      <div className="absolute left-3 top-3 flex h-9 min-w-[2.25rem] items-center justify-center rounded-full bg-ink-950/85 px-2 font-display text-base font-semibold text-accent shadow-lg backdrop-blur">
        {rank}
      </div>
      <div className="space-y-1 p-4">
        <div className="text-sm font-semibold leading-tight text-ink-100">
          {title}
        </div>
        {subtitle && (
          <div className="text-xs text-ink-300">{subtitle}</div>
        )}
        {meta && (
          <div className="pt-1 text-[11px] uppercase tracking-[0.16em] text-ink-300/80">
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}
