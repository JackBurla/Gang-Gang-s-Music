import { useEffect, useState } from "react";
import { NavLink, Link } from "react-router-dom";

import { fetchSubmissions } from "../api";
import type { SubmissionSummary } from "../types";

function clsxLink(active: boolean): string {
  return `nav-link ${active ? "nav-link-active" : ""}`;
}

export default function Nav() {
  const [submitters, setSubmitters] = useState<SubmissionSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchSubmissions()
      .then((rows) => {
        if (!cancelled) setSubmitters(rows);
      })
      .catch(() => {
        // Nav still works without dynamic tabs; ignore.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-ink-800/70 bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-4 sm:px-8 md:flex-row md:items-center md:justify-between">
        <Link to="/" className="group inline-flex items-baseline gap-2">
          <span className="wordmark text-2xl text-ink-100 sm:text-3xl">
            gang gang&rsquo;s music
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1.5">
          <NavLink to="/" end className={({ isActive }) => clsxLink(isActive)}>
            Home
          </NavLink>
          <NavLink to="/submit" className={({ isActive }) => clsxLink(isActive)}>
            Submit
          </NavLink>
          {submitters.length > 0 && (
            <span aria-hidden className="mx-1 h-5 w-px bg-ink-700" />
          )}
          {submitters.map((s) => (
            <NavLink
              key={s.name}
              to={`/u/${encodeURIComponent(s.name)}`}
              className={({ isActive }) => clsxLink(isActive)}
            >
              {s.name}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
