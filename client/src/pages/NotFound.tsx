import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="space-y-4 pt-12 text-center">
      <div className="pill mx-auto inline-block">404</div>
      <h1 className="wordmark text-4xl text-ink-100 sm:text-5xl">
        Nothing here yet.
      </h1>
      <p className="text-ink-300">Maybe you meant the aggregate?</p>
      <div>
        <Link to="/" className="btn-ghost">
          Back home
        </Link>
      </div>
    </div>
  );
}
