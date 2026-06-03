import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";

import { runMigrations } from "./db.js";
import { getAggregate } from "./aggregate.js";
import {
  HttpError,
  getSubmission,
  listSubmissions,
  upsertSubmission,
  validate,
} from "./submissions.js";
import { lookupAlbum, lookupArtist } from "./itunes.js";

const port = Number(process.env.PORT ?? 8080);

const corsOrigins = (process.env.CORS_ORIGIN ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();

app.use(express.json({ limit: "32kb" }));
app.use(
  cors({
    origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? true : corsOrigins,
    credentials: false,
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "gang-gangs-music-api" });
});

app.get("/api/submissions", async (_req, res, next) => {
  try {
    res.json(await listSubmissions());
  } catch (err) {
    next(err);
  }
});

app.get("/api/submissions/:name", async (req, res, next) => {
  try {
    const sub = await getSubmission(req.params.name);
    if (!sub) {
      res.status(404).json({ error: "Submission not found." });
      return;
    }
    res.json(sub);
  } catch (err) {
    next(err);
  }
});

app.post("/api/submissions", async (req, res, next) => {
  try {
    const input = validate(req.body);
    const { submission, editToken } = await upsertSubmission(input);
    res.json({ submission, editToken });
  } catch (err) {
    next(err);
  }
});

// Temporary diagnostic: dumps raw iTunes responses for a given artist+album
// so we can see what Railway's IP is actually being served. Safe to remove.
app.get("/api/debug/itunes-album", async (req, res, next) => {
  try {
    const album = String(req.query.album ?? "");
    const artist = String(req.query.artist ?? "");
    if (!album || !artist) {
      res.status(400).json({ error: "album and artist required" });
      return;
    }
    const r1 = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        artist
      )}&entity=musicArtist&attribute=artistTerm&limit=1`
    ).then((r) => r.json() as Promise<{ results: { artistId?: number }[] }>);
    const artistId = r1.results?.[0]?.artistId;
    if (!artistId) {
      res.json({ stage: "findArtistId", r1 });
      return;
    }
    const r2 = await fetch(
      `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=200`
    ).then(
      (r) =>
        r.json() as Promise<{
          results: {
            wrapperType?: string;
            collectionName?: string;
            collectionId?: number;
            artworkUrl100?: string;
          }[];
        }>
    );
    const matches = r2.results.filter(
      (x) =>
        x.wrapperType === "collection" &&
        x.collectionName?.toLowerCase().includes(album.toLowerCase())
    );
    const allCollections = r2.results
      .filter((x) => x.wrapperType === "collection")
      .map((x) => ({
        name: x.collectionName,
        id: x.collectionId,
        hasArt: Boolean(x.artworkUrl100),
      }));
    res.json({ artistId, matches, allCollections });
  } catch (err) {
    next(err);
  }
});

app.get("/api/aggregate", async (_req, res, next) => {
  try {
    res.json(await getAggregate());
  } catch (err) {
    next(err);
  }
});

app.get("/api/preview", async (req, res, next) => {
  try {
    const type = String(req.query.type ?? "");
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.json({ imageUrl: null, matchedName: null });
      return;
    }
    if (type === "artist") {
      const r = await lookupArtist(q);
      res.json({ imageUrl: r.imageUrl ?? null, matchedName: r.matchedName ?? null });
      return;
    }
    if (type === "album") {
      const artist = String(req.query.artist ?? "");
      const r = await lookupAlbum(q, artist);
      res.json({ imageUrl: r.imageUrl ?? null, matchedName: r.matchedName ?? null });
      return;
    }
    res.status(400).json({ error: "type must be 'artist' or 'album'." });
  } catch (err) {
    next(err);
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[gang-gangs-music] unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

async function start() {
  await runMigrations();
  app.listen(port, () => {
    console.log(`[gang-gangs-music] listening on port ${port}`);
    console.log(`[gang-gangs-music] CORS origins: ${corsOrigins.join(", ") || "*"}`);
  });
}

start().catch((err) => {
  console.error("[gang-gangs-music] failed to start:", err);
  process.exit(1);
});
