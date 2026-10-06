# The backend, big picture

A companion to Parts 4 and 5. Those Parts walk through the backend one file at a time. This page
steps back and explains **what each tool is, why it's here, and how a request travels through all
of them.** Read it when the pieces stop fitting together in your head.

No new code here. Everything below describes what's already in `app/`.

---

## The one-paragraph version

Your data lives in **Postgres**, a database running inside **Docker**. **Prisma** describes the
tables in one file (`schema.prisma`), creates them in Postgres, and gives you a typed TypeScript
client to read and write them. **GraphQL** is the language the frontend will use to ask the backend
for data. **Pothos** is how you define the GraphQL API in TypeScript, reusing Prisma's types so the
two can't drift apart. **GraphQL Yoga** is the HTTP server that receives GraphQL requests and runs
them against that API. **Next.js** hosts Yoga at one URL, `/api/graphql`, alongside the React app.

---

## The layers

Every request goes down through these layers, and the response comes back up through them:

```
  Browser / GraphiQL / (Part 6: React app)
          │   POST /api/graphql   { "query": "{ recipes { title } }" }
          ▼
┌──────────────────────────────────────────────────────────────┐
│ Next.js route handler        app/app/api/graphql/route.ts    │  "this URL exists"
├──────────────────────────────────────────────────────────────┤
│ GraphQL Yoga                 createYoga({ schema, context }) │  HTTP ⇄ GraphQL
├──────────────────────────────────────────────────────────────┤
│ The GraphQL schema           built by Pothos                 │  what can be asked
│   + resolvers                app/graphql/types/*.ts          │  how to answer it
├──────────────────────────────────────────────────────────────┤
│ Prisma Client                app/lib/prisma.ts               │  TypeScript ⇄ SQL
├──────────────────────────────────────────────────────────────┤
│ PostgreSQL in Docker         app/docker-compose.yml          │  where data lives
└──────────────────────────────────────────────────────────────┘
```

Each layer only talks to the one directly below it. Yoga never touches the database, Prisma has no
idea GraphQL exists, and Postgres doesn't know about TypeScript. That separation means you can
understand, and debug, one layer at a time.

---

## The tools, one at a time

For each tool: what it is, what problem it solves, and where it lives in this repo.

### PostgreSQL (in Docker)

**What it is.** A relational database: data stored in tables of rows and columns, with
relationships between tables (a `Recipe` row points to its `User` row via `authorId`).

**Why Docker.** Installing Postgres directly on your Mac means managing versions, services and
data directories. Docker runs it in an isolated container with one command, and every developer on
a project gets the identical version. `docker-compose.yml` says "run Postgres 17, call the
database `cookbook`, expose it on port 5432, keep the data in a volume so it survives restarts."

**Where.** `app/docker-compose.yml`. Started with `docker compose up -d`. The app finds it via
`DATABASE_URL` in `app/.env`.

**When it breaks.** "Can't reach database server" almost always means the container isn't running.
On this machine Docker Desktop doesn't start automatically, so run `open -a Docker` first.

### Prisma

Prisma is really **four tools that share one file**, `prisma/schema.prisma`.

| Piece | Command | What it does |
|---|---|---|
| **Schema** | (you edit it) | Describes your models (`User`, `Recipe`, `Step`…), their fields, and how they relate. The single source of truth for your data's shape. |
| **Migrate** | `npx prisma migrate dev` | Compares the schema to the database, writes the SQL needed to make them match (`prisma/migrations/…/migration.sql`), and runs it. |
| **Client** | `npx prisma generate` | Generates a TypeScript library, `@prisma/client`, with a method for every model: `prisma.recipe.findMany(...)`, `prisma.user.create(...)`. Fully typed from your schema. |
| **Studio / seed** | `npx prisma studio`, `npx prisma db seed` | A GUI for browsing rows, and a hook that runs `prisma/seed.ts` to fill the database with sample data. |

**What problem it solves.** Without Prisma, you'd write SQL strings by hand
(`SELECT * FROM "Recipe" WHERE id = $1`). They'd return untyped results, and nothing would warn
you when a column was renamed. With Prisma:

```ts
const recipe = await prisma.recipe.findUnique({
  where: { id },
  include: { author: true },
});
// recipe is typed: { id: string; title: string; ...; author: User } | null
```

A typo in a field name is a compile error, and the result type follows from what you asked for.

**Where.** `app/prisma/schema.prisma` (the models), `app/prisma/migrations/` (the SQL history,
committed), `app/prisma/seed.ts` (sample data), and `app/lib/prisma.ts` (the one shared client
instance, called a *singleton*, so hot reloads in dev don't open a new database connection each
time).

**The generated code matters.** `@prisma/client` lives in `node_modules` and is *produced* by
`prisma generate`. If you change `schema.prisma` and don't regenerate (`migrate dev` regenerates
for you), your TypeScript still sees the old models.

### GraphQL (the idea, and `graphql`, the package)

**What it is.** A query language for APIs. Instead of many REST URLs (`/recipes`,
`/recipes/:id`, `/users/:id/recipes`), there is **one URL**. The client sends a query saying
exactly which fields it wants:

```graphql
{
  recipes {
    title
    author { name }
  }
}
```

The response has exactly that shape, no more and no less:

```json
{ "data": { "recipes": [{ "title": "Weeknight Chili", "author": { "name": "Sam" } }] } }
```

**Why use it here.** The frontend (Part 6) will have pages that need very different slices of the
same data: a list page wants titles and favorite counts, a detail page wants steps and ingredients.
With GraphQL, each page asks for what it needs in one request, and you don't write a new endpoint
per page. The schema is also typed, so in Part 6 the frontend can generate TypeScript types from it.

**The two halves of a GraphQL server:**
- **The schema** declares what exists: `type Recipe { title: String! ... }`,
  `type Query { recipes: [Recipe!]! }`. It's a contract.
- **Resolvers** are functions that produce each field's value. `Query.recipes` calls Prisma.
  `Recipe.title` just reads `.title` off the row.

**The `graphql` npm package** is the reference engine: it parses the query text, checks it against
the schema, and calls the resolvers. You rarely call it directly. Pothos and Yoga are both built on
it, which is why its version is pinned to `graphql@16` (everything in the stack agrees on that one).

### Pothos (with its Prisma plugin)

**What it is.** A library for writing your GraphQL schema **in TypeScript code**, rather than in a
separate `.graphql` file. This is called *code-first*.

**What problem it solves.** In the other approach, *schema-first*, you'd maintain three
descriptions of a recipe that must agree by hand:

1. the Prisma model (`schema.prisma`),
2. the GraphQL type (`schema.graphql`),
3. the resolvers (`.ts`).

Pothos collapses 2 and 3 into one place and **type-checks them against 1**:

```ts
builder.prismaObject("Recipe", {          // "Recipe" must be a real Prisma model
  fields: (t) => ({
    title: t.exposeString("title"),       // must be a real String column on Recipe
    description: t.exposeString("description", { nullable: true }), // nullable column → must say so
    author: t.relation("author"),         // must be a real relation; type User is inferred
  }),
});
```

Each of those comments describes a mistake that becomes a red squiggle in your editor rather than a
runtime bug.

**The Prisma plugin** (`@pothos/plugin-prisma`) does two jobs:
1. **Types:** it knows your Prisma models, so `prismaObject`, `t.relation` and friends can check
   your fields. This is why `schema.prisma` has a second generator, `generator pothos`.
2. **Efficient queries:** it looks at the *whole* incoming GraphQL query and builds one Prisma
   query with the right `include`s, which arrives in your resolver as the `query` argument. That's
   how `{ recipes { author { name } } }` costs two SQL queries (all recipes, then all their authors
   at once) instead of one per recipe, avoiding the "N+1 problem" from §5.7.

**Where.** `app/graphql/builder.ts` creates the builder once, with all the shared settings. Each
file in `app/graphql/types/` adds types and fields to it. `app/graphql/schema.ts` imports every
type file and calls `builder.toSchema()` to produce the finished schema.

> **Why the imports in `schema.ts` matter.** A type file doesn't export anything. Importing it
> *runs* its `builder.prismaObject(...)` calls, which register the types. Forget an import and
> those types silently don't exist. That's the `ObjectRef<Step> has not been implemented` error you
> hit.

### GraphQL Yoga

**What it is.** A GraphQL **server**: the piece that speaks HTTP.

**What problem it solves.** A schema is only a data structure in memory. Something has to:
- accept an HTTP POST, pull the query and variables out of the JSON body,
- build a fresh **context** for this request (who's the current user?),
- hand everything to the `graphql` engine to execute,
- turn the result, or errors, into an HTTP response with the right status and headers,
- serve **GraphiQL**, the in-browser query explorer, when you visit the URL in a browser,
- hide internal error details from clients (you saw this as `"Unexpected error."`).

That's all Yoga. You give it a schema and a context function, and it gives back a
`handleRequest(request) → response` function.

**Where.** `app/app/api/graphql/route.ts`, about ten lines.

### Next.js (the route handler)

**What it is.** The framework the whole app runs in. Part 6 uses it for React pages. Here it's
used for one thing: **giving Yoga a URL.**

**How.** Next.js maps folders to URLs. A file at `app/app/api/graphql/route.ts` that exports `GET`
and `POST` functions *becomes* the endpoint `/api/graphql`. Those functions pass the request
straight to Yoga.

**Why not a separate server?** You could run Yoga as its own Node server on another port. Keeping
it inside Next.js means one `npm run dev`, one deploy, and the same origin for the frontend and the
API (so no CORS setup, and cookies just work in Part 7).

> **The folder name is the URL.** The 404 you hit was because the route file was in `app/api/`,
> outside the inner `app/` folder that Next.js scans, and the folder was spelled `grapqhl`. Next.js
> never found it.

### The context

Not a tool, but the piece that's easiest to overlook. The **context** is an object created
**once per request** and handed to every resolver as `ctx`. It holds request-scoped things, mainly
*who is asking*.

**Where.** `app/graphql/context.ts`. For now it fakes a login by picking the oldest user (Sam).
Part 7 replaces that with the real user from a session cookie, and no resolver has to change,
because they all just read `ctx.currentUser`.

---

## Following one request end to end

You type this into GraphiQL and press run:

```graphql
{
  recipes {
    title
    author { name }
  }
}
```

1. **Browser → Next.js.** GraphiQL sends `POST /api/graphql` with the query in the JSON body.
   Next.js matches the URL to `app/app/api/graphql/route.ts` and calls its `POST` function.
2. **Next.js → Yoga.** `POST` calls `handleRequest(request)`. Yoga reads the body and pulls out
   the query string.
3. **Yoga builds the context.** It calls `createContext()`, which runs one Prisma query to find
   Sam. `ctx = { currentUser: Sam }`.
4. **Parse and validate.** The `graphql` engine parses the text and checks it against the schema.
   Does `Query` have a `recipes` field? Does `Recipe` have `title` and `author`? If not, it fails
   here with a validation error and no resolver runs.
5. **Execute: the root field.** The engine calls the resolver for `Query.recipes` (in
   `types/recipe.ts`). Before that runs, the Pothos Prisma plugin has looked at the whole selection,
   seen `author { name }`, and prepared `query = { include: { author: true } }`.
6. **Resolver → Prisma.** The resolver runs
   `prisma.recipe.findMany({ ...query, orderBy: { createdAt: "desc" } })`.
7. **Prisma → Postgres.** Prisma turns that into SQL. The dev terminal logs it: one `SELECT` for
   the recipes, one `SELECT ... WHERE id IN (...)` for all their authors.
8. **Back up: the nested fields.** The engine walks each returned recipe. `Recipe.title` reads
   `.title`. `Recipe.author` finds the author *already loaded* (from step 5) and returns it.
   `User.name` reads `.name`.
9. **Yoga → response.** Yoga wraps the result as `{ "data": { ... } }`, serializes it to JSON, and
   returns it. Fields you didn't ask for (`description`, `createdAt`) were never sent.

If anything throws along the way, Yoga catches it. Errors you throw deliberately as `GraphQLError`
(§5.9) are passed to the client as-is. Anything else becomes `"Unexpected error."`, so internals
like SQL messages don't leak.

---

## The chain of types: why everything agrees

The biggest payoff of this stack is that **the data's shape is written once**, and every other
layer derives its types from it:

```
schema.prisma ──migrate──▶ Postgres tables
      │
      └──generate──▶ @prisma/client types ──▶ Pothos checks your GraphQL types against them
                      + Pothos's Prisma types                          │
                                                                       ▼
                                                       GraphQL schema (generated by toSchema)
                                                                       │
                                                  Part 6: GraphQL Code Generator reads it
                                                                       ▼
                                                          TypeScript types in the React app
```

Rename `Recipe.title` in `schema.prisma`, run `migrate dev`, and the compiler points at every
place in the backend that used it. In Part 6, the frontend joins that chain too.

The **generated** steps are where things go stale. Run `npx prisma generate` (or `migrate dev`,
which runs it) after changing `schema.prisma`. The `Can't resolve
'@pothos/plugin-prisma/generated'` error came from this step being misconfigured: it produced the
types but not the runtime code, so `tsc` passed and the server still couldn't start.

---

## "Where do I make this change?"

| I want to… | Touch |
|---|---|
| Add a column or table | `prisma/schema.prisma` → `npx prisma migrate dev --name <what>` |
| Change the sample data | `prisma/seed.ts` → `npx prisma migrate reset` (wipes and reseeds) |
| Expose a field to the API | `graphql/types/<thing>.ts`: add it to that type's `fields` |
| Add a whole new GraphQL type | new file in `graphql/types/` **and import it in `graphql/schema.ts`** |
| Add a query | `builder.queryFields(...)` in the relevant type file |
| Add a mutation | `builder.mutationFields(...)`, in `recipe-mutations.ts` for recipes |
| Change what every resolver can see | `graphql/context.ts` (and the `Context` type in `builder.ts`) |
| Change builder-wide settings (scalars, nullability, plugins) | `graphql/builder.ts` |
| Change the URL or server options | `app/api/graphql/route.ts` |

## Command cheat sheet

| Command (run in `app/`) | What it does |
|---|---|
| `open -a Docker` | Start Docker Desktop (it doesn't auto-start here) |
| `docker compose up -d` | Start Postgres in the background |
| `npx prisma migrate dev --name x` | Apply schema changes to the database, and regenerate the client |
| `npx prisma generate` | Regenerate `@prisma/client` and Pothos's types without touching the DB |
| `npx prisma migrate reset` | Drop everything, re-run all migrations, re-seed |
| `npx prisma studio` | Browse and edit rows in a GUI |
| `npm run dev` | Start Next.js, so the API is at <http://localhost:3000/api/graphql> |

## When something breaks: which layer?

| Symptom | Layer | Likely cause |
|---|---|---|
| 404 at `/api/graphql` | Next.js | `route.ts` not under `app/app/api/graphql/` |
| `Module not found` / `Cannot find module '@prisma/client'` | Generated code | Run `npx prisma generate`; check generator config |
| Error mentioning a type "not implemented" or "must define one or more fields" | Pothos / schema | Missing import in `schema.ts`, or an empty root type |
| GraphiQL shows a validation error before anything runs | GraphQL | The query asks for a field the schema doesn't have |
| `"Unexpected error."` | Your resolver or below | Look at the dev server terminal for the real error |
| `Can't reach database server` | Postgres / Docker | Container not running |
