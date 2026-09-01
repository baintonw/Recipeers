# Full-Stack Tutorial: Building a Recipe Sharing App

An end-to-end tutorial for building a full-stack application with **Next.js (App Router)**,
**TypeScript**, **GraphQL**, **Prisma**, and **PostgreSQL**.

## Who this is for

You know React well enough to build with it, though a refresher on the core concepts is welcome.
TypeScript you're learning from scratch — this tutorial teaches it from the ground up before the
rest of the stack starts leaning on it. You may have never written a GraphQL schema, designed a
database, or built an API. This tutorial fills in the backend half of "full stack" and shows how
the two halves connect with end-to-end type safety.

## What we're building

**Cookbook**, a recipe sharing app. Users can browse recipes, view a recipe with its ingredients and steps,
sign up and log in, publish their own recipes, edit or delete recipes they own, and favorite
recipes from other users.

## The stack (and why)

| Layer | Tool | Why this one |
|---|---|---|
| Framework | Next.js (App Router) | React framework with server + client rendering, routing, and API route handlers in one project |
| Language | TypeScript (strict) | End-to-end types are the whole point of this stack |
| API | GraphQL via GraphQL Yoga | A spec-compliant, lightweight GraphQL server that drops into a Next.js route handler |
| Schema | Pothos (code-first) | Define the schema in TypeScript; types flow from your code instead of being hand-maintained alongside SDL |
| GraphQL client | urql + GraphQL Code Generator | Lighter than Apollo Client, first-class codegen; generates typed hooks from the queries you write |
| ORM | Prisma | Best-in-class migrations, type-safe query client, readable schema language |
| Database | PostgreSQL (Docker locally) | The production default; running it in Docker teaches real connection/migration concerns |
| Auth | JWT in an httpOnly cookie | Simple, stateless, works cleanly with GraphQL context |

## How to use this document

Each **Part** is a set of chapters. The app runs and is committable at the end of every Part —
there are no half-finished states. Topics are ordered so nothing depends on something introduced
later. Commands are shown with `npm`; substitute your package manager of choice.

**Parts 1 and 2 are the language and framework foundation** — TypeScript from scratch and a React
refresher. If you already write TypeScript comfortably, skim them for the specific patterns this
stack relies on (generics, utility types, typing hooks and props) and move on.

Version numbers are pinned when the project is scaffolded (Part 3), not in this outline.

---

## Part 0 — Orientation

- **0.1 What we're building** — a tour of the finished recipe app with a wireframe of each screen
  (recipe list, recipe detail, create/edit form, login, "my recipes", "my favorites").
- **0.2 The stack, piece by piece** — what each tool in the table above is responsible for, and
  where the boundaries between them sit.
- **0.3 How GraphQL fits a Next.js app** — route handler vs. a separate standalone GraphQL server;
  why this tutorial embeds the API as `app/api/graphql/route.ts`.
- **0.4 The request lifecycle** — trace one query from a React component → urql → `/api/graphql`
  → Yoga → a Pothos resolver → Prisma → a SQL query against Postgres, and back.
- **0.5 Prerequisites and environment** — Node version, a package manager, Docker Desktop,
  and recommended editor extensions (Prisma, GraphQL, ESLint). No prior TypeScript is assumed;
  Part 1 covers it.

## Part 1 — TypeScript from the ground up

Taught from scratch, but aimed at getting you productive in *this* codebase rather than covering
every corner of the language.

- **1.1 What TypeScript is and how it runs** — types as a compile-time layer over JavaScript,
  `tsc`, editor feedback, and what "it compiles away to nothing" means.
- **1.2 The basic types** — `string`, `number`, `boolean`, arrays, `null`/`undefined`, type
  inference, and when to annotate vs. let inference work.
- **1.3 `any`, `unknown`, and `never`** — why `any` defeats the point, `unknown` as the safe
  alternative, and where `never` shows up.
- **1.4 Object shapes** — object types, optional and readonly properties, `interface` vs. `type`,
  and index signatures.
- **1.5 Unions, literal types, and narrowing** — modeling "one of these", discriminated unions,
  and how `if`/`typeof`/`in` checks narrow a type.
- **1.6 Functions** — parameter and return types, optional and default parameters, rest params,
  and typing callbacks.
- **1.7 Generics** — the concept, generic functions and types, constraints with `extends`, and
  why every tool in this stack (Prisma, Pothos, urql) is generic-heavy.
- **1.8 The utility types you'll actually use** — `Partial`, `Pick`, `Omit`, `Record`,
  `ReturnType`, `Awaited`, plus `keyof` and indexed access types.
- **1.9 Using types from other packages** — `@types/*` packages, `.d.ts` files, and reading a
  library's type signatures to learn its API.
- **1.10 Living with strict mode** — `strictNullChecks`, the non-null assertion `!`, type guards,
  and narrowing instead of casting.
- **Checkpoint:** a set of small typing exercises (model a recipe, type a function, fix the
  errors) with solutions.

## Part 2 — A React refresher

A fast pass over the React you already know, re-grounded with TypeScript and brought up to date
with the Next.js App Router.

- **2.1 Components and props** — function components, typing props, `children`, and composition.
- **2.2 State and effects** — `useState` with inferred and explicit types, `useEffect`, cleanup,
  dependency arrays, and the rules of hooks.
- **2.3 Context and reducers** — `useContext` for app-wide state (we'll use it for auth),
  `useReducer`, and writing a typed custom hook.
- **2.4 Lists, keys, and forms** — rendering collections, controlled inputs, typing form and
  change events.
- **2.5 Data fetching in plain React** — the `useEffect` + `fetch` pattern, its rough edges
  (races, loading/error state, caching), and why a GraphQL client removes most of it.
- **2.6 Server vs. Client Components** — what the App Router renders where, the `"use client"`
  boundary, and which of our components need to be which.
- **Checkpoint:** a small typed component that fetches and renders a list, built the manual way
  (replaced by urql in Part 6).

## Part 3 — Project setup

- **3.1 Scaffolding the app** — `create-next-app` with TypeScript, ESLint, and the App Router;
  a walk through the generated files.
- **3.2 Project structure for this tutorial** — where the schema, resolvers, generated types,
  Prisma schema, and shared `lib/` code will live; the import-alias convention.
- **3.3 TypeScript config that matters** — `strict`, `noUncheckedIndexedAccess`, path aliases,
  and why we turn these on now rather than later.
- **3.4 Postgres in Docker** — a `docker-compose.yml` for a local Postgres, starting and stopping
  it, and the `DATABASE_URL` connection string in `.env`.
- **3.5 Adding Prisma** — `prisma init`, the `schema.prisma` file, and the Prisma Client
  singleton pattern that survives Next.js dev-server hot reloads.
- **Checkpoint:** the app boots, connects to an empty database, and `prisma studio` opens.

## Part 4 — Modeling the data

- **4.1 The domain model** — `User`, `Recipe`, `Ingredient`, `RecipeIngredient` (the join row that
  also carries quantity and unit), `Step`, `Tag`, and `Favorite`; an entity-relationship diagram.
- **4.2 Writing the Prisma schema** — scalar fields, `@id`/`@default`/`@updatedAt`, one-to-many
  relations (recipe → steps), many-to-many with an explicit join model (recipe ↔ ingredients),
  many-to-many implicit (recipe ↔ tags), enums, unique constraints, and indexes.
- **4.3 Migrations** — `prisma migrate dev`, what lives in a migration folder, when to add a new
  migration vs. `migrate reset`, and how migrations differ from `db push`.
- **4.4 Seeding** — a `prisma/seed.ts` that inserts a handful of users and realistic recipes so
  every later chapter has data to work with.
- **4.5 Inspecting your data** — Prisma Studio for browsing, and a short `psql` primer for looking
  at the actual tables and running ad-hoc SQL.
- **Checkpoint:** a fully migrated schema and a seeded database.

## Part 5 — The GraphQL layer (code-first with Pothos)

- **5.1 GraphQL crash course** — for REST and React developers: the schema as a type system, the
  root `Query`/`Mutation` types, resolvers, arguments, the graph, and how a client asks for exactly
  the fields it needs.
- **5.2 Code-first vs. schema-first** — why Pothos: the schema is derived from TypeScript, so there
  is one source of truth and resolver arguments/return types are checked against it.
- **5.3 Wiring GraphQL Yoga into Next.js** — creating the Yoga instance and exporting it as the
  `GET`/`POST` handlers from `app/api/graphql/route.ts`; the built-in GraphiQL explorer.
- **5.4 The Pothos builder** — configuring the schema builder, adding the Prisma plugin, and
  generating Pothos's Prisma types.
- **5.5 The first object type** — defining `Recipe` with its scalar fields exposed to the graph.
- **5.6 Queries** — `recipes` (list) and `recipe(id: ID!)` (single); resolvers that call the
  Prisma client; nullability and the `ID` type.
- **5.7 Exposing relations** — `Recipe.author`, `Recipe.ingredients`, `Recipe.steps`,
  `Recipe.tags`; a plain-language look at the N+1 query problem and how the Pothos Prisma plugin
  avoids it for you.
- **5.8 Mutations** — `createRecipe`, `updateRecipe`, `deleteRecipe`; defining input types,
  nested writes (creating a recipe with its steps and ingredients in one call), and input
  validation.
- **5.9 Errors** — distinguishing expected errors (not found, invalid input) from bugs; returning
  messages a client can show a user.
- **5.10 Exploring the API** — using GraphiQL to run every query and mutation by hand before any
  frontend exists.
- **Checkpoint:** a complete read/write GraphQL API for recipes, exercised through GraphiQL.

## Part 6 — Connecting the frontend

- **6.1 Setting up urql** — installing the client, the `<Provider>`, choosing the fetch exchange
  and cache exchange, and where the provider goes in the App Router tree.
- **6.2 GraphQL Code Generator** — the `codegen.ts` config, the `client` preset, the `graphql()`
  document function, and running codegen in watch mode alongside `next dev`.
- **6.3 The daily workflow** — write a query string in a component, save, let codegen produce the
  typed document and result types, consume them with `useQuery`.
- **6.4 The recipe list page** — a client component that runs the `recipes` query and renders
  loading, error, empty, and success states.
- **6.5 The recipe detail page** — a dynamic route (`app/recipes/[id]/page.tsx`) that fetches one
  recipe with its author, ingredients, and steps.
- **6.6 Server-rendered first paint** — fetching the initial data in a Server Component and
  handing it to urql so the first render isn't a spinner; the tradeoffs.
- **6.7 Mutations from the UI** — the "create recipe" form, `useMutation`, handling validation
  errors from the server, and updating or refetching the list afterward.
- **6.8 Optimistic updates** — a light introduction using the favorite button as the example
  (revisited fully in Part 7).
- **Checkpoint:** browse recipes and create a recipe entirely through the UI.

## Part 7 — Authentication & authorization

- **7.1 The auth design** — credential signup and login, password hashing with argon2, a signed
  JWT stored in an httpOnly, SameSite cookie, and why this fits GraphQL.
- **7.2 Auth mutations** — `signup`, `login`, and `logout`; setting and clearing the cookie from
  a Next.js route handler context.
- **7.3 The GraphQL context** — reading the cookie on every request, verifying the JWT, loading
  the user, and putting `currentUser` (or `null`) on the Yoga context; typing the context.
- **7.4 Protected resolvers** — requiring an authenticated user for `createRecipe`,
  `updateRecipe`, `deleteRecipe`, and `favoriteRecipe`; a reusable "must be logged in" helper.
- **7.5 Field-level authorization** — using Pothos auth scopes so `User.email` is visible only to
  that user.
- **7.6 Ownership checks** — only a recipe's author may edit or delete it; returning a clean
  "forbidden" error otherwise.
- **7.7 Auth on the frontend** — an auth context/provider backed by a `me` query, the login and
  signup forms, showing/hiding UI based on auth state, and redirecting away from protected pages.
- **7.8 Capstone: favorites end-to-end** — the `favoriteRecipe`/`unfavoriteRecipe` mutations,
  the `Recipe.isFavoritedByMe` field, the optimistic toggle button, and a "my favorites" page.
- **Checkpoint:** a logged-in user can publish, manage their own recipes, and favorite others'.

## Part 8 — Filling out the app

- **8.1 Search and filtering** — filter recipes by tag, by ingredient, and by a text query;
  passing filter arguments through the `recipes` query to a Prisma `where`.
- **8.2 Pagination** — cursor-based pagination for the recipe list, and an infinite-scroll or
  "load more" UI in urql.
- **8.3 Tag management** — a UI for adding and removing tags on a recipe.
- **8.4 "My recipes" and "My favorites"** — user-scoped list pages reusing the components from
  Part 6.
- **8.5 Shared validation** — defining input schemas with zod once and using them in both the
  resolver and the form.
- **8.6 Polish** — loading skeletons, empty states, and React error boundaries around data.
- **Checkpoint:** a feature-complete recipe app.

## Part 9 — Further reading

Pointers rather than full chapters — enough to know what to search for.

- **9.1 Testing** — Vitest for resolver unit tests, integration tests against a throwaway
  Postgres, and Playwright for end-to-end flows.
- **9.2 Deployment** — a production Dockerfile, deploying to Vercel with a hosted Postgres
  (Neon or Supabase), and running `prisma migrate deploy` in CI.
- **9.3 Advanced GraphQL** — how DataLoader batching works under the hood, subscriptions for
  real-time updates, persisted queries, and response caching.
- **9.4 Observability** — structured logging, and tracing a slow resolver down to its SQL.

## Appendix

- **A. Command reference** — dev server, `prisma migrate`/`studio`/`generate`, `codegen`,
  Docker Compose up/down.
- **B. Troubleshooting** — common errors (Prisma client out of sync, codegen not running, cookie
  not set in dev, CORS) and their fixes.
- **C. Glossary** — resolver, schema, SDL, migration, hydration, exchange, scope, generic, and
  other terms used throughout.
- **D. Official documentation** — links for Next.js, TypeScript, GraphQL, Pothos, GraphQL Yoga,
  urql, GraphQL Code Generator, Prisma, and PostgreSQL.
