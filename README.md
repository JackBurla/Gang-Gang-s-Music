# gang gang's music

A music aggregator for the gang. Everyone submits their **10 greatest artists of all time** and their **top 10 albums of all time** (you can extend the album list up to 25 if you want). The homepage shows the live, position-weighted aggregate; each submitter gets their own tab.

- **Frontend**: Vite + React + TypeScript + Tailwind, hosted on **GitHub Pages**.
- **Backend**: Node + Express + Postgres, hosted as a new service on **Railway** (in the same project as your maptap bot, on the same $5/mo plan).
- **Album art / artist photos**: pulled live from the free iTunes Search API (no API key needed) and cached in Postgres.

```
.
├── client/          # Vite React app -> GitHub Pages
├── server/          # Express API   -> Railway
└── .github/workflows/deploy-frontend.yml
```

## One-time setup

You'll need to:

1. Push this repo to GitHub.
2. Stand up the backend on Railway.
3. Wire up GitHub Pages with the Railway URL.

I (Jack) will walk you through each step below. None of them require code edits.

### 1. Push to GitHub

```bash
cd "C:\Users\Jack Rzucidlo\gang-gangs-music"
git add .
git commit -m "Initial scaffold"
gh repo create gang-gangs-music --public --source=. --remote=origin --push
# or, if you don't have gh:
#   create an empty repo at https://github.com/new named "gang-gangs-music"
#   then:
#   git remote add origin https://github.com/JackBurla/gang-gangs-music.git
#   git push -u origin main
```

### 2. Set up the backend on Railway

In your existing Railway project (the one running maptap):

1. **Add a new service**: New -> "GitHub Repo" -> pick `gang-gangs-music`.
2. In the service settings, set **Root Directory** to `server`. (This keeps the frontend out of the backend's build.)
3. **Add a Postgres plugin** to the project: New -> "Database" -> "Add PostgreSQL". Railway automatically injects `DATABASE_URL` into the new service.
4. Set the following **environment variables** on the new service:
   - `CORS_ORIGIN` = `https://jackburla.github.io` (or, if you set up a custom domain, that URL). You can comma-separate multiple values.
   - `NODE_ENV` = `production`
   - `DATABASE_URL` is already injected by the plugin — leave it alone.
5. Railway will deploy automatically. After it goes green, the service will have a public URL like `https://gang-gangs-music-api-production.up.railway.app`. Copy that URL — you'll need it for step 3.
6. Visit `<that-url>/api/health` in a browser. You should see `{"ok":true,"name":"gang-gangs-music-api"}`.

### 3. Wire up GitHub Pages

1. In the GitHub repo, go to **Settings -> Pages** and set **Source** to **GitHub Actions**.
2. Go to **Settings -> Secrets and variables -> Actions -> New repository secret** and add:
   - Name: `VITE_API_BASE_URL`
   - Value: the Railway URL from step 2.5 (no trailing slash).
3. Either push any change to `client/` or trigger the **Deploy frontend to GitHub Pages** workflow from the Actions tab. Once it finishes, the site is live at:
   - `https://jackburla.github.io/Gang-Gang-s-Music/`

That's it.

## Local development

You'll need Node.js 20+. Install it from [nodejs.org](https://nodejs.org/) or via your preferred version manager (`fnm`, `volta`, `nvm-windows`).

### Backend

```bash
cd server
cp .env.example .env
# edit .env: point DATABASE_URL at a local Postgres OR at the Railway public URL
npm install
npm run dev
# -> http://localhost:8080
```

If you want a local Postgres, the easiest path is Docker:

```bash
docker run --name ggm-pg -e POSTGRES_PASSWORD=ggm -e POSTGRES_USER=ggm -e POSTGRES_DB=ggm -p 5432:5432 -d postgres:16
# then in server/.env:
# DATABASE_URL=postgres://ggm:ggm@localhost:5432/ggm
```

Otherwise just paste the **public** Railway Postgres connection string from the Postgres plugin's "Connect" tab into `DATABASE_URL`. The pool detects `sslmode=require` automatically.

### Frontend

```bash
cd client
echo "VITE_API_BASE_URL=http://localhost:8080" > .env.local
npm install
npm run dev
# -> http://localhost:5173
```

When you `npm run build` locally, set `VITE_BASE_PATH=/` if you want the build to work from the filesystem root. The default `/Gang-Gang-s-Music/` is what GH Pages expects (matching the repo name).

## How submitting / editing works

- The Submit page takes a name + ranked artists + ranked albums.
- On submit, the server claims that name and returns a random `editToken`. The client stashes it in `localStorage` under `ggm:editToken:<name-lowercased>`.
- If the same person opens Submit later, the page sees the stored token, sends it with the request, and the server updates their picks in place.
- If a different person tries to submit under an existing name without the matching token, they get a friendly 409 telling them to pick a different name. (This is "friend-grade" anti-griefing — fine for a private gang gang thing.)

## Submission rules

- **Artists**: up to 10, ordered. Rank 1 = your GOAT.
- **Albums**: at least 10, up to 25, ordered. The Submit form starts with 10 album slots and lets you keep adding rows up to 25.

## Aggregation rules

- Artists: rank 1 is worth 10 points, rank 2 worth 9, ..., rank 10 worth 1.
- Albums: rank 1 is worth 25 points, rank 2 worth 24, ..., rank 25 worth 1. (Scaled so all 25 picks contribute, with steeper weight up top.)
- Artists/albums are grouped case-insensitively (and albums are also disambiguated by artist, so two "Greatest Hits" by different artists don't collide).
- The home page shows the **top 10 plus everything tied at position 10**. With a handful of submitters this naturally surfaces lots of 1/2/3-vote ties — by design.

## File map

- `server/src/index.ts` — Express app and all routes.
- `server/src/submissions.ts` — validation, upsert with iTunes enrichment, fetch by name.
- `server/src/aggregate.ts` — the SQL aggregation + tie-aware ranking + 30s in-process cache.
- `server/src/itunes.ts` — iTunes Search API wrapper (free, no key).
- `server/src/schema.ts` — the Postgres schema, run idempotently on boot.
- `server/src/db.ts` — pg pool + transaction helper.
- `client/src/pages/Home.tsx` — the homepage with the two leaderboards.
- `client/src/pages/Submit.tsx` — the submission form with live art previews.
- `client/src/pages/UserPage.tsx` — `/u/:name`, one person's picks.
- `client/src/components/{Nav,Layout,Leaderboard,RankedCard}.tsx` — the UI primitives.
- `client/src/index.css` — the visual system: dark, warm, Fraunces wordmark, single accent color.
