import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site under /<repo-name>/. In dev we keep the
// base at `/` for convenience. Override with the `VITE_BASE_PATH` env var
// if you set up a custom domain (then use "/").
export default defineConfig(({ command }) => {
  const base =
    process.env.VITE_BASE_PATH ??
    (command === "build" ? "/Gang-Gang-s-Music/" : "/");
  return {
    base,
    plugins: [react()],
    server: {
      port: 5173,
    },
  };
});
