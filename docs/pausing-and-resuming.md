# Pausing and resuming work

How to shut everything down cleanly at the end of a session, and bring it back next time. Every
command runs from `app/` (the folder containing `package.json`) unless it says otherwise.

What's running during a session:

| Thing | Started with | Where |
|---|---|---|
| Docker Desktop | `open -a Docker` | menu-bar whale icon |
| Postgres | `docker compose up -d` | a container, data in the `app_cookbook-db-data` volume |
| Next.js dev server (app + API) | `npm run dev` | terminal 1 |
| Codegen watcher (Part 6+) | `npm run codegen:watch` | terminal 2 |
| Prisma Studio (optional) | `npx prisma studio` | another terminal |

---

## Pause

```bash
# 1. Stop the servers: press Ctrl+C in each terminal
#    (npm run dev, npm run codegen:watch, npx prisma studio)

# 2. Stop Postgres. The container goes away, but the data stays in the volume.
docker compose down

# 3. Save your work in progress (optional, but recommended)
git add -A && git commit -m "WIP: <where you got to>"
```

Then **quit Docker Desktop** from the whale icon in the menu bar → **Quit Docker Desktop**.
Wait for the icon to disappear before you reopen it.

> **Never run `docker compose down -v`.** The `-v` deletes the database volume, and all your data
> with it. Plain `down` is always safe. If you ever do lose the data, `npx prisma migrate reset`
> rebuilds the tables and reseeds them.

---

## Resume

```bash
# 1. Start Docker, then wait ~30–60s for the whale icon to stop animating
open -a Docker

# 2. Start Postgres on the existing volume
cd ~/Development/Study/React-GraphQL/React-GraphQL-Tutorial/app
docker compose up -d

# 3. Terminal 1: the app and the API
npm run dev

# 4. Terminal 2 (Part 6+): regenerate GraphQL types on save, once the dev server is up
npm run codegen:watch
```

Then open <http://localhost:3000>. The API's GraphiQL is at <http://localhost:3000/api/graphql>.

**Optional, when your data has drifted:** `npx prisma migrate reset` (answer `y`) drops everything
and reseeds: Sam, Alex, and the Weeknight Chili. It's safe on this local database. It only deletes
data you've created while testing.

---

## When something won't start

| Symptom | Fix |
|---|---|
| `docker.sock: no such file`, or `Cannot connect to the Docker daemon` | Docker Desktop isn't running: `open -a Docker`, and wait. |
| `docker` commands hang with no output | Docker Desktop is stuck. Run `pgrep -fl /Applications/Docker.app`. If it lists processes, kill them with `pkill -9 -f /Applications/Docker.app`, then `open -a Docker`. |
| `open -a Docker` does nothing visible | Normal: Docker runs as a menu-bar icon, not a window. If `docker` commands still hang, see the row above. |
| Docker suggests deleting `settings-store.json` | Safe: it only holds Docker Desktop's preferences. Your data lives elsewhere. |
| `Can't reach database server at localhost:5432` | Postgres isn't running: `docker compose up -d`. |
| `Port 3000 is in use` | A dev server from last time is still running. Find its terminal and press Ctrl+C, or run `lsof -i :3000` and quit that process. |
| Codegen: `Failed to load schema … ECONNREFUSED` | Start `npm run dev` first; codegen reads the schema from it. |
| API errors with `PothosSchemaError: Duplicate field …` | You edited a file in `graphql/` while the dev server was running. Restart `npm run dev`. |

**In Docker Desktop's Troubleshoot screen, never choose "Clean / Purge data" or "Reset to factory
defaults".** They delete every volume, including your database.

---

## Checking things are healthy

```bash
docker volume ls          # app_cookbook-db-data should be listed
docker compose ps         # the db service should be "running" / "healthy"
npx prisma studio         # browse the tables in a GUI
```
