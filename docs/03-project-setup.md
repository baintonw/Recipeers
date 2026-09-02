# Part 3 — Project setup

From here on there's **one codebase**. This Part scaffolds it, sets the folder layout and the
TypeScript options we'll rely on for the rest of the tutorial, stands up a local PostgreSQL in
Docker, and wires in Prisma. By the checkpoint the app boots, talks to an empty database, and
`prisma studio` opens.

No feature code yet — that starts in Part 4. This is the foundation everything else is built on,
so it's worth doing deliberately rather than copy-pasting past.

> **Follow along.** You need Node 22+, a package manager, and Docker Desktop running — all from
> §0.5. Every command below is run from the project directory you're about to create. The repo is
> committed and tagged `part-03-complete` at the end.

---

## 3.1 Scaffolding the app

We use `create-next-app`, the official generator. This tutorial was written against
**`create-next-app` 16.3** (Next.js 16, React 19.2) — check yours with
`npx create-next-app@latest --version`. Run it and answer the prompts:

```bash
npx create-next-app@latest cookbook
```

| Prompt | Answer | Why |
|---|---|---|
| Would you like to use TypeScript? | **Yes** | The whole point. |
| Which linter would you like to use? | **ESLint** | Not Biome — we build on `eslint-config-next` in §3.3 and Part 6. |
| Would you like to use Tailwind CSS? | **No** | The tutorial keeps CSS minimal so the focus stays on data flow. Say yes if you'd rather — nothing later depends on the answer. |
| Would you like your code inside a `src/` directory? | **No** | We keep `app/`, `lib/`, `graphql/`, and `prisma/` at the project root. |
| Would you like to use App Router? | **Yes** | Server Components, route handlers — everything from §2.6. It's the default in Next 16. |
| Would you like to customize the import alias? | **No** | The default `@/*` is what we want. |

The equivalent one-liner, if you'd rather not click through:

```bash
npx create-next-app@latest cookbook \
  --ts --eslint --app --no-tailwind --no-src-dir \
  --import-alias "@/*" --use-npm
```

Notes on Next 16 defaults:

- **Turbopack** is the bundler for `next dev` and `next build` now — there's no prompt for it. (An
  `--rspack` flag opts into the alternative; we don't.)
- **React Compiler** is off by default. It's a pure performance optimization and nothing in the
  tutorial needs it; add `--react-compiler` later if you want it.
- The generator writes an **`AGENTS.md`** (and a `CLAUDE.md` that includes it) with rules for
  coding assistants. `next dev` re-adds that block if you remove it — commit it and move on.

Then:

```bash
cd cookbook
npm run dev
```

Open <http://localhost:3000> — you should see the Next.js starter page.

### A walk through what was generated

```
cookbook/
├── app/
│   ├── layout.tsx        the root layout — wraps every page; where <html>/<body> live
│   ├── page.tsx          the "/" route
│   ├── page.module.css   CSS module scoped to page.tsx
│   ├── globals.css       global stylesheet
│   └── favicon.ico
├── public/               static files (SVGs) served as-is at the site root
├── next.config.ts        Next.js config
├── tsconfig.json         TypeScript config — we edit this in §3.3
├── eslint.config.mjs     ESLint flat config — we extend this in Part 6
├── next-env.d.ts         Next's ambient types — generated, git-ignored, don't edit
├── AGENTS.md / CLAUDE.md  coding-assistant rules (see note above)
├── package.json
└── .gitignore            already ignores /node_modules, /.next/, .env*, next-env.d.ts
```

The scripts in `package.json`:

- `npm run dev` — dev server with hot reload (Turbopack)
- `npm run build` — production build (also the fastest full type-check of the whole app)
- `npm run start` — serve the production build
- `npm run lint` — runs `eslint` over the project (Next 16 removed the `next lint` wrapper)

Get in the habit of running `npm run build` before each checkpoint commit — it type-checks the
whole project, which the dev server only does per-file as you touch things.

---

## 3.2 Project structure for this tutorial

Next.js only dictates `app/` and `public/`. Everything else is our convention. Here's the full
layout we're building toward — most of these directories arrive in a later Part, but it's worth
seeing the whole shape now:

```
cookbook/
├── app/                          Next.js routes and pages (Part 6+)
│   ├── layout.tsx
│   ├── page.tsx                  the recipe list
│   ├── recipes/[id]/page.tsx     the recipe detail page
│   └── api/
│       └── graphql/
│           └── route.ts          GraphQL Yoga mounted here (Part 5)
├── graphql/                      the GraphQL schema, code-first (Part 5)
│   ├── builder.ts                the Pothos schema builder
│   ├── schema.ts                 assembles and exports the schema
│   └── types/                    one file per domain type (Recipe, User, …)
├── prisma/
│   ├── schema.prisma             the database schema (Part 4)
│   ├── migrations/               generated migration SQL (Part 4)
│   └── seed.ts                   seed data (Part 4)
├── lib/                          shared, framework-agnostic code
│   ├── prisma.ts                 the Prisma Client singleton (§3.5)
│   ├── generated/graphql.ts      GraphQL Code Generator output — git-ignored (Part 6)
│   ├── auth.ts                   password hashing, JWT helpers (Part 7)
│   └── urql.ts                   the urql client (Part 6)
├── docker-compose.yml            local Postgres (§3.4)
├── .env                          secrets and connection strings — git-ignored
└── .env.example                  the same keys with placeholder values — committed
```

### The import-alias convention

`create-next-app` set up `@/*` to point at the project root (see `tsconfig.json` → `paths`). Use
it for **every** cross-directory import so you never write `../../../lib/prisma`:

```ts
import { prisma } from "@/lib/prisma";
import { schema } from "@/graphql/schema";
```

Relative imports (`./favorite-button`) are still fine for a file's immediate neighbors.

### Committed vs. generated

Two tools generate code — Prisma's client (into `node_modules`, so already ignored) and, in
Part 6, GraphQL Code Generator into `lib/generated/`. **Generated code is not committed**: it's a
build product, it's large, and a stale copy in a diff is noise. Instead it's regenerated on demand
(`prisma generate`, `npm run codegen`) and on `npm install`. We git-ignore the Codegen output when
we add it.

---

## 3.3 TypeScript config that matters

Open `tsconfig.json`. `create-next-app` already turned on the big one — `"strict": true` — which
bundles `noImplicitAny`, `strictNullChecks`, and a dozen others. That's the baseline from Part 1.

Add two things to `compilerOptions`:

```jsonc
{
  "compilerOptions": {
    // ...what create-next-app generated...
    "strict": true,
    "noUncheckedIndexedAccess": true,   // add this
    "noFallthroughCasesInSwitch": true  // and this
  }
}
```

### `noUncheckedIndexedAccess`

Without it, indexing an array or record is a lie:

```ts
const steps: string[] = ["Brown the beef"];
const second = steps[1];        // typed as string — but it's actually undefined
second.toUpperCase();           // compiles; crashes at runtime
```

With it, `steps[1]` is `string | undefined`, and you're forced to handle the gap:

```ts
const second = steps[1];
if (second) second.toUpperCase();   // narrowed to string
```

This matters constantly in a data app — array access on query results, `params` lookups, splitting
strings. Turn it on now, before there's code to retrofit.

### `noFallthroughCasesInSwitch`

We lean on `switch` over discriminated unions (the reducer in §2.3, resolver dispatch later). This
flags a `case` that's missing its `break`/`return` — a classic silent bug.

### Path aliases

Already configured by the scaffold:

```jsonc
"paths": {
  "@/*": ["./*"]
}
```

Leave it. If you'd said "yes" to `src/`, this would be `["./src/*"]` — one reason we skipped it.

### `verbatimModuleSyntax` (optional, recommended)

Adding `"verbatimModuleSyntax": true` forces `import type { Foo }` for type-only imports. It makes
the value/type boundary explicit, which pays off once Prisma and Codegen are generating both. If
it's not in the generated config, adding it is a safe call — the ESLint autofix will insert the
`type` keywords for you.

### ESLint

`create-next-app` gives you `eslint-config-next`, which already includes the React and
`react-hooks` rules mentioned in Part 2 (rules of hooks, `exhaustive-deps`). No change needed now;
Part 6 adds the GraphQL plugin. Just confirm it runs:

```bash
npm run lint
```

---

## 3.4 Postgres in Docker

Rather than installing a PostgreSQL server on your machine, we run one in a container. It's
disposable, versioned, and identical for everyone following along. Create `docker-compose.yml` at
the project root:

```yaml
services:
  db:
    image: postgres:17-alpine
    container_name: cookbook-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: cookbook
      POSTGRES_PASSWORD: cookbook
      POSTGRES_DB: cookbook
    ports:
      - "5432:5432"
    volumes:
      - cookbook-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cookbook -d cookbook"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  cookbook-db-data:
```

What each part does:

- **`image: postgres:17-alpine`** — a pinned major version on the small Alpine base. Pin it so an
  image refresh doesn't jump you to a new Postgres major. (We stay on 17 deliberately: the
  Postgres **18** image moved its data directory and expects the volume mounted at
  `/var/lib/postgresql`, not `/var/lib/postgresql/data` — a needless snag for a tutorial. 17 is
  supported for years yet.)
- **`environment`** — on first start, Postgres creates this user, password, and database. Fine to
  use `cookbook`/`cookbook` locally; this database never leaves your machine.
- **`ports: "5432:5432"`** — maps the container's Postgres port to `localhost:5432` so Prisma
  (running on your host, not in Docker) can reach it. If you already have something on 5432, change
  the left number: `"5433:5432"`, and update `DATABASE_URL` to match.
- **`volumes: cookbook-db-data`** — a **named volume** that persists the data across container
  restarts. Without it, every `docker compose down` would wipe the database.
- **`healthcheck`** — lets `docker compose up --wait` block until Postgres is actually accepting
  connections, not just until the process started.

### Running it

```bash
docker compose up -d          # start in the background
docker compose ps             # check status — "healthy" once ready
docker compose logs -f db     # tail the logs (Ctrl-C to stop tailing)
docker compose stop           # stop the container, keep the data
docker compose start          # start it again
docker compose down           # remove the container, keep the named volume
docker compose down -v        # remove the container AND delete all data
```

Day to day you'll run `docker compose up -d` when you sit down to work and leave it running. Reach
for `down -v` only when you want a truly clean slate (we do this once in Part 4 to demonstrate
`migrate reset`).

### The connection string

Prisma reads the database URL from an environment variable. Create `.env` at the project root:

```bash
# .env
DATABASE_URL="postgresql://cookbook:cookbook@localhost:5432/cookbook?schema=public"
```

Anatomy of that URL:

```
postgresql://cookbook:cookbook@localhost:5432/cookbook?schema=public
           └── user ──┘└ pass ┘ └─ host ─┘ port └─ db ─┘ └── namespace ──┘
```

The scaffold's `.gitignore` has `.env*`, which ignores **every** env file. Commit a placeholder so
the next person knows which keys to set — add an un-ignore line for it:

```bash
# .gitignore
.env*
!.env.example
```

```bash
# .env.example  — committed
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/DATABASE?schema=public"
```

> **Why not `.env.local`?** Next.js loads `.env.local` for its own code, but the Prisma CLI only
> reads `.env`. Keeping everything in `.env` means one file feeds both. Never commit it.

---

## 3.5 Adding Prisma

This tutorial uses **Prisma 6**. Pin it explicitly — Prisma 7 moved the database config into a
`prisma.config.ts` file and switched generators, and at the time of writing the `latest` npm tag
points at a Prisma 8 release candidate:

```bash
npm install -D prisma@6
npm install @prisma/client@6
```

Initialize:

```bash
npx prisma init --datasource-provider postgresql
```

Recent Prisma 6 releases generate a `prisma.config.ts` and a schema that uses the newer
`prisma-client` generator. We want the classic setup, so:

1. **Delete `prisma.config.ts`.** Without it, the Prisma CLI auto-loads `.env` on its own — you'll
   see `Environment variables loaded from .env` on every command.
2. `prisma init` also tried to add a `DATABASE_URL` to `.env`; it'll warn that one already exists
   (from §3.4) and leave yours alone. Good.

### The schema file

Open `prisma/schema.prisma` and set it to exactly this:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- **`generator client`** — Prisma reads your models and generates a typed query client. The
  classic `prisma-client-js` generator writes it into `node_modules/@prisma/client`, so there's
  nothing new to git-ignore and you import it as `@prisma/client`.
- **`datasource db`** — which database, and where to find it. `env("DATABASE_URL")` pulls from
  `.env`.

Models come in Part 4. For now the schema has none.

### The Prisma Client singleton

Next.js's dev server hot-reloads your code on every save. A naive `new PrismaClient()` at module
scope would create a **new client — and a new database connection pool — on every reload**, and
you'd exhaust Postgres's connection limit within a minute. The fix is to cache the instance on
`globalThis`, which survives hot reloads. Create `lib/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Read it top to bottom:

1. **`globalForPrisma`** — `globalThis` retyped so TypeScript lets us stash a `prisma` property on
   it. The `as unknown as { ... }` is the one deliberate type assertion in the file.
2. **`prisma`** — reuse the cached client if it exists (`??`), otherwise create one. The `log`
   option prints SQL in dev, which is instructive while you're learning what Prisma emits.
3. **The `if`** — in dev, save the client back to the global so the next hot reload finds it. In
   production there are no reloads, so we skip it and keep the global clean.

Every file that needs the database imports this one instance:

```ts
import { prisma } from "@/lib/prisma";
```

Never `new PrismaClient()` anywhere else.

### Generating the client

`prisma generate` writes the client into `node_modules/@prisma/client`. It runs automatically
after `npm install` (via Prisma's `postinstall`) and after every `prisma migrate`. To run it by
hand:

```bash
npx prisma generate
```

Do this now so `@prisma/client` resolves and `lib/prisma.ts` type-checks. With no models yet, the
generated `PrismaClient` simply has no table methods on it — that's expected.

---

## Checkpoint — the app boots and connects

You should be able to run all of this cleanly:

```bash
# 1. Database up and healthy
docker compose up -d
docker compose ps                 # STATUS shows "healthy"

# 2. Prisma can reach the database. With no models yet this reports
#    "Already in sync, no schema change" — that's the success case.
#    Real migrations start in Part 4.
npx prisma migrate dev

# 3. Prisma Studio connects and opens (no tables yet — that's fine)
npx prisma studio                 # opens http://localhost:5555

# 4. The app builds with the stricter tsconfig, and runs
npm run build
npm run dev                       # http://localhost:3000 still renders
```

If step 2 errors with `Can't reach database server`, the container isn't up or ready — check
`docker compose ps` and `docker compose logs db`.

**What you have now:**

- A Next.js App Router project in TypeScript, with `strict` + `noUncheckedIndexedAccess` on.
- The `@/*` import alias and the directory layout for the whole tutorial.
- A pinned PostgreSQL running in Docker, with persistent storage and a healthcheck.
- Prisma 6 installed, a schema file, a verified database connection, and the hot-reload-safe
  client singleton.

Commit and tag:

```bash
git add -A
git commit -m "Part 3 — project setup: Next.js, Docker Postgres, Prisma"
git tag part-03-complete
```

---

## What's next

**Part 4 — Modeling the data.** We design the domain — `User`, `Recipe`, `Ingredient` and the
join row that carries quantity, `Step`, `Tag`, `Favorite` — write it as a Prisma schema with real
relations and constraints, run migrations, and seed a database full of recipes to build against.
