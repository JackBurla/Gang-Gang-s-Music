import { Outlet } from "react-router-dom";
import Nav from "./Nav";

export default function Layout() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-6 sm:px-8">
        <Outlet />
      </main>
      <footer className="border-t border-ink-800/70 py-8 text-center text-xs text-ink-300">
        made for gang gang. powered by friendship and questionable taste.
      </footer>
    </div>
  );
}
