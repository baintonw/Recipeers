# Part 6 — Connecting the frontend

Part 5 gave you a GraphQL API you've exercised by hand in GraphiQL. This Part puts a React UI on
top of it: a recipe list, a recipe detail page, and a form that creates recipes. All three talk to
the same `/api/graphql` endpoint you've been using, with the same queries.

Two tools do most of the work:

- **urql** is a GraphQL *client* for React. It's what GraphiQL has been for you so far: it sends
  queries and mutations to the server and hands back the results, plus a cache and React hooks.
- **GraphQL Code Generator** ("codegen") reads your API's schema and every query in your
  components, and generates TypeScript types for each one. A typo in a field name becomes a
  compile error in the component, the same safety Pothos gave you on the server.

> **Follow along.** Continues from `part-05-complete`: a working GraphQL API at `/api/graphql`.
> Start Docker (`open -a Docker`), then `docker compose up -d`. If your data has drifted,
> `npx prisma migrate reset` puts it back to the seed. You'll run **two terminals** for most of
> this Part: one for `npm run dev`, one for codegen. The repo is committed and tagged
> `part-06-complete` at the end.

---

## 6.1 Setting up urql

```bash
npm install urql @urql/next
```

`urql` is the client. `@urql/next` adds what's needed to render urql queries on the server too;
you won't use it until §6.6, but installing both now saves a step later.

### The client

Create `lib/urql.ts`:

```ts
import { cacheExchange, createClient, fetchExchange } from "urql";

export function makeClient() {
  return createClient({
    url: "/api/graphql",
    exchanges: [cacheExchange, fetchExchange],
  });
}
```

- **`url`** is relative. In the browser, `/api/graphql` means "this site's `/api/graphql`", which
  is the Yoga route from Part 5. The frontend and API share one Next.js server, so there's no CORS
  to configure.
- **Exchanges** are urql's plugin pipeline. Every operation flows through them in order, like
  middleware:
  - `cacheExchange` checks the cache first. If this exact query with these exact variables already
    has a result, it's returned without a request.
  - `fetchExchange` sends what the cache couldn't answer to the server over HTTP.

This cache is urql's *document cache*: it stores whole results keyed by query + variables. That's
simple, and enough for this Part. §6.7 covers how it knows when a result is out of date.

### The provider

React components get the client from context, so something has to put it there. Create
`app/providers.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Provider } from "urql";
import { makeClient } from "@/lib/urql";

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser tab, created once — not on every render.
  const [client] = useState(makeClient);
  return <Provider value={client}>{children}</Provider>;
}
```

**Why `"use client"`?** Everything under `app/` is a **Server Component** by default. It runs only
on the server, can be `async`, and never ships its code to the browser. But React context,
`useState`, and hooks like `useQuery` need to run in the browser, so they only work in **Client
Components**, which start with `"use client"`. That line marks a *boundary*: this file and
everything it imports runs in the browser too.

**Why `useState(makeClient)`?** Passing the function (not `makeClient()`) means it only runs on
the first render. Create the client inline and every re-render would make a new one, with an
empty cache.

### Where it goes in the tree

The provider has to wrap every component that runs a query, so it goes in the root layout. Replace
`app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cookbook",
  description: "Recipes, shared.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <header className="site-header">
          <Link href="/">Cookbook</Link>
          <Link href="/recipes/new">New recipe</Link>
        </header>
        <main className="site-main">
          <Providers>{children}</Providers>
        </main>
      </body>
    </html>
  );
}
```

The layout itself is still a Server Component. It renders `<Providers>`, a Client Component, and
passes the page in as `children`. The page doesn't become a Client Component just because it's
rendered inside one. Only files that say `"use client"` (and what *they* import) do. This is the
standard App Router pattern: keep the client boundary as low as you can, and pass server-rendered
content through it as `children`.

The header gives you links to the two pages you'll build. Neither exists yet, so they 404 for now.

---

## 6.2 GraphQL Code Generator

Without codegen, `useQuery` returns `data: any`. You'd write `data.recipes[0].titel` and find out
in the browser. Codegen fixes that by generating a TypeScript type for every query you write.

```bash
npm install -D @graphql-codegen/cli @graphql-codegen/client-preset @parcel/watcher
```

- `@graphql-codegen/cli` is the `graphql-codegen` command.
- `@graphql-codegen/client-preset` is the recommended setup for frontend apps. It generates a
  typed `graphql()` function (below).
- `@parcel/watcher` lets codegen watch your files and regenerate on save (§6.3).

### `codegen.ts`

Create `codegen.ts` in the project root (next to `package.json`):

```ts
import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  // Introspect the running dev server — the schema Pothos built is the source of truth.
  schema: "http://localhost:3000/api/graphql",
  // Every file that might contain a graphql(`...`) call.
  documents: ["app/**/*.tsx", "components/**/*.tsx"],
  ignoreNoDocuments: true,
  generates: {
    "./lib/generated/": {
      preset: "client",
      config: {
        scalars: { DateTime: "string" },
        enumsAsTypes: true,
      },
    },
  },
};

export default config;
```

- **`schema`** is where codegen gets the API's types. It asks the running dev server for its schema
  using a standard GraphQL feature called *introspection*: the same thing GraphiQL's Docs panel
  does. So **`npm run dev` has to be running** when you run codegen. The Pothos code in `graphql/`
  stays the single source of truth; codegen reads its output.
- **`documents`** are the files codegen scans for queries, mutations, and fragments.
- **`generates`** writes everything into `lib/generated/`, using the client preset.
- **`scalars: { DateTime: "string" }`.** Your custom `DateTime` scalar (§5.4) is a `Date` on the
  server, but over the wire it's an ISO string, and urql doesn't convert it back. This tells
  codegen the truth: on the client, a `DateTime` is a `string`.
- **`enumsAsTypes: true`** makes GraphQL enums like `Unit` plain string-union types
  (`"GRAM" | "CUP" | …`) instead of TypeScript `enum`s.

### Scripts, `.gitignore`, and ESLint

Add two scripts to `package.json`:

```json
"codegen": "graphql-codegen",
"codegen:watch": "graphql-codegen --watch"
```

Generated code isn't committed (§3.2), so add it to `.gitignore`:

```gitignore
# GraphQL Code Generator output (Part 6)
/lib/generated/
```

And tell ESLint to skip it. The generated files contain lint-disable comments ESLint would warn
about, and they're not yours to fix anyway. In `eslint.config.mjs`, add to the `globalIgnores`
list:

```js
    // GraphQL Code Generator output (Part 6).
    "lib/generated/**",
```

### First run

With `npm run dev` running in one terminal, run in another:

```bash
npm run codegen
```

You'll get `lib/generated/` with four files. The one you'll import from is `index.ts`, which
exports:

- **`graphql()`** is the function you'll wrap every query in. You pass it a query string, and it
  returns a *typed document*: the query, plus the TypeScript types of its variables and result.
  urql reads those types, so `useQuery` knows the exact shape of `data`.
- **`useFragment()`** and **`FragmentType`**, for fragments (§6.4).

`graphql.ts` holds the types themselves. There's nothing in it about your queries yet, because you
haven't written any.

---

## 6.3 The daily workflow

From here on, keep **two terminals** open:

```bash
npm run dev             # terminal 1: the app and the API
npm run codegen:watch   # terminal 2: regenerates types whenever you save
```

The loop looks like this:

1. In a component, write a query inside `` graphql(`…`) ``.
2. Save. Codegen (terminal 2) spots the change, validates the query against the schema, and
   regenerates `lib/generated/`. This takes a second or two.
3. Use the result. `data` is now fully typed, and autocomplete knows every field you selected.

Codegen also catches mistakes before the browser does. Ask for `titel` instead of `title` and
terminal 2 prints:

```
Cannot query field "titel" on type "Recipe". Did you mean "title"?
One or more errors occurred, no files were generated.
```

Until you fix it, the previous generated files stay as they were, so the types won't include your
latest change.

**If types look stale or missing:** check terminal 2 first. Codegen needs the dev server running
to read the schema; if it isn't, it fails with `Failed to load schema from
http://localhost:3000/api/graphql … ECONNREFUSED`. Start `npm run dev`, then restart codegen.

**When the schema changes** (you edit a file in `graphql/`), two things need a nudge:

1. **Restart `npm run dev`.** Hot reload re-runs the type file you edited, but not `builder.ts`,
   so the type gets registered on the same builder a second time. The API then fails every request
   with an error like `PothosSchemaError: Duplicate field id on User` until you restart. This
   applies to any edit under `graphql/`, not just in this Part.
2. **Save any component, or run `npm run codegen`.** Codegen fetches the schema fresh each time it
   regenerates, but watch mode only regenerates when a component changes.

---

## 6.4 The recipe list page

The home page (`/`) shows every recipe as a card, like the wireframe in Part 0. It's made of two
components:

- `RecipeList` runs the query and handles loading, error, and empty states.
- `RecipeCard` renders one recipe.

They live in a new top-level `components/` folder. Files under `app/` are for routes; shared UI
goes outside it.

### Fragments: each component asks for its own data

`RecipeCard` needs a recipe's title, author, favorite count, and tags. You could write all of that
in `RecipeList`'s query and pass it down, but then the list has to know what the card displays.
Change the card and you'd have to remember to change the query too.

GraphQL has a better tool for this: a **fragment**, a named, reusable piece of a query. The card
declares the fields it needs as a fragment, and the list's query includes it with `...RecipeCard`.

Create `components/recipe-card.tsx`:

```tsx
import Link from "next/link";
import { graphql, useFragment, type FragmentType } from "@/lib/generated";

export const RecipeCardFragment = graphql(`
  fragment RecipeCard on Recipe {
    id
    title
    favoriteCount
    author {
      name
    }
    tags {
      id
      name
    }
  }
`);

type Props = {
  recipe: FragmentType<typeof RecipeCardFragment>;
};

export function RecipeCard(props: Props) {
  const recipe = useFragment(RecipeCardFragment, props.recipe);

  return (
    <article className="card">
      <h2>
        <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
      </h2>
      <p>
        by {recipe.author.name} · ♥ {recipe.favoriteCount}
      </p>
      <p className="tags">
        {recipe.tags.map((tag) => (
          <span key={tag.id}>#{tag.name}</span>
        ))}
      </p>
    </article>
  );
}
```

- **`fragment RecipeCard on Recipe { … }`** means "these fields, from a `Recipe`."
- **`FragmentType<typeof RecipeCardFragment>`** is the prop type. It's deliberately *opaque*: you
  can't read `props.recipe.title` directly. TypeScript only lets you through after
  `useFragment(RecipeCardFragment, props.recipe)` "unmasks" it. This is called **fragment
  masking**: each component can only read the fields it asked for itself, so nothing quietly
  depends on fields another component happened to request.
- **`useFragment` isn't really a hook.** It doesn't fetch anything or hold state. It only narrows
  the type. The name is a client-preset convention.
- There's no `"use client"` here. `RecipeCard` has no state or effects, and it's only imported by a
  Client Component, which makes it run in the browser too.

### The list

Create `components/recipe-list.tsx`:

```tsx
"use client";

import { useQuery } from "urql";
import { graphql } from "@/lib/generated";
import { RecipeCard } from "./recipe-card";

const RecipesQuery = graphql(`
  query Recipes {
    recipes {
      id
      ...RecipeCard
    }
  }
`);

export function RecipeList() {
  const [{ data, fetching, error }] = useQuery({ query: RecipesQuery });

  if (fetching) return <p>Loading recipes…</p>;
  if (error) return <p role="alert">Couldn&apos;t load recipes: {error.message}</p>;

  const recipes = data?.recipes ?? [];
  if (recipes.length === 0) return <p>No recipes yet.</p>;

  return (
    <ul className="recipe-grid">
      {recipes.map((recipe) => (
        <li key={recipe.id}>
          <RecipeCard recipe={recipe} />
        </li>
      ))}
    </ul>
  );
}
```

- **`...RecipeCard`** spreads the card's fragment into the query. Codegen combines them, so the
  query sent to the server includes the card's fields.
- **`useQuery`** returns `[result, reexecute]`. The result's three fields cover every state, in
  the same order you handled them with the discriminated union in Part 2:
  - `fetching` is `true` until the first result arrives;
  - `error` is set if the request failed or the server returned errors;
  - `data` is the typed result. Hover over `data` in your editor: it's
    `RecipesQuery | undefined`, with `recipes` as a typed array.
- **`recipe={recipe}`** passes the *masked* recipe to the card. `RecipeList` can read `recipe.id`
  (it asked for `id` itself) but not `recipe.title`, which only `RecipeCard` asked for.

### The page

Replace `app/page.tsx`. The scaffolded Next.js welcome page goes, and you can delete
`app/page.module.css`, which only it used:

```tsx
import { RecipeList } from "@/components/recipe-list";

export default function HomePage() {
  return (
    <>
      <h1>Recipes</h1>
      <RecipeList />
    </>
  );
}
```

The page is a Server Component that renders a Client Component. That's the pattern from §6.1
again: the page itself sends no JavaScript to the browser, only `RecipeList` and what it imports
do.

### A little CSS

The tutorial keeps styling minimal, but a grid of cards is easier to check than an unstyled list.
Append this to `app/globals.css`. It covers every page in this Part:

```css
/* Cookbook (Part 6) — just enough layout to be readable. */
.site-header {
  display: flex;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid color-mix(in srgb, var(--foreground) 15%, transparent);
  font-weight: 600;
}

.site-main {
  width: 100%;
  max-width: 60rem;
  margin: 0 auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.site-main a {
  text-decoration: underline;
}

.recipe-grid {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: 1rem;
}

.card {
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--foreground) 15%, transparent);
  border-radius: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tags {
  display: flex;
  gap: 0.5rem;
  opacity: 0.7;
}

.recipe {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.recipe-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1.5rem;
}

.recipe-columns ul,
.recipe-columns ol {
  padding-left: 1.25rem;
}

.recipe-form,
.recipe-form fieldset {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.recipe-form fieldset {
  padding: 0.75rem;
}

.recipe-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.recipe-form input,
.recipe-form textarea,
.recipe-form select,
.recipe-form button,
.favorite button {
  font: inherit;
  padding: 0.375rem 0.5rem;
}

.ingredient-row {
  display: flex;
  gap: 0.5rem;
}

.form-error {
  color: #c62828;
}
```

### Try it

With both terminals running, open <http://localhost:3000>. You should see the seed's Weeknight
Chili (plus anything you created in §5.10). Open your browser's dev tools, go to the Network tab,
and reload: you'll see a request to `/api/graphql` carrying the `Recipes` query. urql sends
queries as `GET` requests with the query in the URL by default, which is why it looks different
from GraphiQL's `POST`s.

Now try the failure states:

- Stop the database (`docker compose stop`) and reload. Within a few seconds you get "Couldn't
  load recipes: [GraphQL] Unexpected error." That's Yoga hiding the real cause from the client
  (§5.9). The real error, a Prisma connection failure, is in terminal 1. Start the database again
  with `docker compose start`.
- Briefly change the `if (recipes.length === 0)` check to `if (true)` to see the empty state.

---

## 6.5 The recipe detail page

Each card links to `/recipes/<id>`. That's a **dynamic route**: one page file that handles every
recipe ID.

### The route

Create `app/recipes/[id]/page.tsx`. The square brackets are part of the folder name:

```tsx
import { RecipeDetail } from "@/components/recipe-detail";

export default async function RecipePage({ params }: PageProps<"/recipes/[id]">) {
  const { id } = await params;
  return <RecipeDetail id={id} />;
}
```

- **`[id]`** in the folder name makes `id` a route parameter. `/recipes/abc123` renders this page
  with `id` set to `"abc123"`.
- **`params` is a `Promise`.** Since Next.js 15, route parameters are async, and as of Next.js 16
  you *must* `await` them. That's why the page is an `async` function.
- **`PageProps<"/recipes/[id]">`** is a type Next.js generates from your folder structure, so
  `params` is typed as `Promise<{ id: string }>`. It's global, so there's nothing to import. Next
  generates it when `npm run dev` starts; if your editor says it can't find `PageProps`, run
  `npx next typegen`.
- The page passes `id` to a Client Component, which does the fetching. Same split as the list.

### The component

Create `components/recipe-detail.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useQuery } from "urql";
import { graphql } from "@/lib/generated";

const RecipeDetailQuery = graphql(`
  query RecipeDetail($id: ID!) {
    recipe(id: $id) {
      id
      title
      description
      favoriteCount
      updatedAt
      author {
        name
      }
      tags {
        id
        name
      }
      ingredients {
        quantity
        unit
        ingredient {
          id
          name
        }
      }
      steps {
        id
        order
        text
      }
    }
  }
`);

export function RecipeDetail({ id }: { id: string }) {
  const [{ data, fetching, error }] = useQuery({
    query: RecipeDetailQuery,
    variables: { id },
  });

  if (fetching) return <p>Loading recipe…</p>;
  if (error) return <p role="alert">Couldn&apos;t load this recipe: {error.message}</p>;

  const recipe = data?.recipe;
  if (!recipe) {
    return (
      <>
        <h1>Recipe not found</h1>
        <Link href="/">← Back to recipes</Link>
      </>
    );
  }

  return (
    <article className="recipe">
      <Link href="/">← Back</Link>
      <h1>{recipe.title}</h1>
      <p>
        by {recipe.author.name} · ♥ {recipe.favoriteCount} · updated{" "}
        {new Date(recipe.updatedAt).toLocaleDateString()}
      </p>
      <p className="tags">
        {recipe.tags.map((tag) => (
          <span key={tag.id}>#{tag.name}</span>
        ))}
      </p>
      {recipe.description && <p>{recipe.description}</p>}

      <div className="recipe-columns">
        <section>
          <h2>Ingredients</h2>
          <ul>
            {recipe.ingredients.map(({ quantity, unit, ingredient }) => (
              <li key={ingredient.id}>
                {quantity} {unit.toLowerCase()} {ingredient.name}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Steps</h2>
          <ol>
            {recipe.steps.map((step) => (
              <li key={step.id}>{step.text}</li>
            ))}
          </ol>
        </section>
      </div>
    </article>
  );
}
```

- **`variables: { id }`** is the same as filling in GraphiQL's Variables pane. Codegen typed
  `variables` from `$id: ID!`, so leaving it out is a compile error.
- **`recipe` can be `null`.** `Query.recipe` is nullable (§5.6) because an unknown ID finds
  nothing, and the generated type says so. TypeScript makes you handle that case before you can
  touch `recipe.title`.
- **`updatedAt` is a string** (the `scalars` setting in §6.2), so it's turned into a `Date` for
  display.
- **`unit.toLowerCase()`** works because `unit` is typed as the `Unit` union, which is all strings.

### Try it

Click a card on the home page. Then change a character in the URL's ID: you should get "Recipe not
found", not a crash.

---

## 6.6 Server-rendered first paint

Reload the home page and watch closely: for a moment it says "Loading recipes…". Now view the
page's source (**View → Developer → View Source** in Chrome). The HTML the server sent contains
"Loading recipes…" and no recipes at all.

Here's why. Next.js *does* render Client Components on the server, to produce the first HTML. But
urql only starts its request once the page is running in the browser. So the server renders the
loading state, the browser downloads and runs the JavaScript, *then* the query goes out, and only
then do the recipes appear. That's one wasted round trip on every page load, and search engines
and link previews only ever see "Loading recipes…".

The fix: run the query **during** the server render, put the result in the HTML, and hand that
same result to urql in the browser so it doesn't fetch it again. That's what `@urql/next` does.

### Switching to `@urql/next`

Replace `lib/urql.ts`:

```ts
import { cacheExchange, createClient, fetchExchange, ssrExchange } from "@urql/next";

// In the browser a relative URL is fine. During server rendering there is no
// "current page" to be relative to, so the server needs the full address.
const GRAPHQL_URL =
  typeof window === "undefined"
    ? `${process.env.APP_URL ?? "http://localhost:3000"}/api/graphql`
    : "/api/graphql";

export function makeClient() {
  const ssr = ssrExchange({ isClient: typeof window !== "undefined" });
  const client = createClient({
    url: GRAPHQL_URL,
    exchanges: [cacheExchange, ssr, fetchExchange],
    suspense: true,
  });
  return { client, ssr };
}
```

Three things changed:

- **The URL is absolute on the server.** In the browser, a relative URL works because there's a
  current page to resolve it against. On the server there isn't, so it needs the full address.
  `typeof window === "undefined"` is the standard way to ask "am I on the server?". `APP_URL` is
  an environment variable you can set later for production; in development the fallback is right.
- **`ssrExchange`** is the handoff. On the server it records every result urql receives. Those
  results are embedded in the HTML, and in the browser the same exchange reads them back and
  answers the first queries from them, with no network request. It sits after `cacheExchange` and
  before `fetchExchange`, so it can answer whatever the cache can't.
- **`suspense: true`** changes how `useQuery` waits. Instead of returning `fetching: true`, it
  *suspends*: it tells React "I'm not ready yet", and React shows the nearest `<Suspense>`
  fallback. On the server, React waits for suspended components to finish before sending their
  HTML. That's what gets real data into the first response.

Replace `app/providers.tsx`:

```tsx
"use client";

import { useState } from "react";
import { UrqlProvider } from "@urql/next";
import { makeClient } from "@/lib/urql";

export function Providers({ children }: { children: React.ReactNode }) {
  const [{ client, ssr }] = useState(makeClient);
  return (
    <UrqlProvider client={client} ssr={ssr}>
      {children}
    </UrqlProvider>
  );
}
```

`UrqlProvider` is `@urql/next`'s version of `Provider`. It also takes the `ssr` exchange, so it
can pass the results recorded on the server to the browser.

### Updating the components

In both `components/recipe-list.tsx` and `components/recipe-detail.tsx`:

1. Import `useQuery` from `"@urql/next"` instead of `"urql"`.
2. Delete the `if (fetching) …` line and remove `fetching` from the destructuring. With suspense,
   the component doesn't render at all until the data is there, so that branch never runs.

The loading UI moves out of the components and into a `<Suspense>` boundary around them, in the
pages. Replace `app/page.tsx`:

```tsx
import { Suspense } from "react";
import { connection } from "next/server";
import { RecipeList } from "@/components/recipe-list";

export default async function HomePage() {
  // Render per request, not once at build time — otherwise `next build` would bake
  // today's recipe list into static HTML.
  await connection();

  return (
    <>
      <h1>Recipes</h1>
      <Suspense fallback={<p>Loading recipes…</p>}>
        <RecipeList />
      </Suspense>
    </>
  );
}
```

And `app/recipes/[id]/page.tsx`:

```tsx
import { Suspense } from "react";
import { RecipeDetail } from "@/components/recipe-detail";

export default async function RecipePage({ params }: PageProps<"/recipes/[id]">) {
  const { id } = await params;
  return (
    <Suspense fallback={<p>Loading recipe…</p>}>
      <RecipeDetail id={id} />
    </Suspense>
  );
}
```

**`await connection()`** needs explaining. When you run `next build`, Next.js renders every page
it can **once, at build time**, and serves that HTML to every visitor afterwards. That's ideal for
pages that never change. The home page has no route parameters or cookies, so Next would treat it
that way, and with server rendering now fetching real data, `next build` would bake *that day's*
recipe list into static HTML. `connection()` tells Next.js "wait for an actual request before
rendering this", so the list is fetched fresh on every visit. The detail page doesn't need it,
because `await params` already makes it per-request.

You won't see this problem in development (`next dev` always renders per request), which is
exactly why it's worth knowing about now. When you run `next build`, the route table at the end
should show `ƒ /`, where `ƒ` means dynamic. A `○` would mean static.

### Try it

Restart `npm run dev` (it was serving the old client), reload the home page, and view source again.
The recipe titles are in the HTML now, and the Network tab shows no `Recipes` request on the first
load, because the browser got its answer from the HTML.

You may still see "Loading recipes…" in the source too. React *streams* the page: it sends the
Suspense fallback first, then the real content in the same response once it's ready, and swaps it
in. It all arrives in one response, so the user never sees a spinner.

### The tradeoffs

- **The server calls itself.** During server rendering, urql makes an HTTP request from the
  Next.js server to the Next.js server's own `/api/graphql`. It's fast on one machine, but it's a
  real request with real overhead. The alternative is for a Server Component to call the schema
  or Prisma directly and pass the data down as props. That's faster, but then the same data is
  fetched two different ways, and urql's cache doesn't know about it. One client and one way to
  fetch is the simpler model to learn; it's a reasonable choice to revisit later.
- **Slow queries hold up the HTML** for whatever is inside their `<Suspense>` boundary. Boundaries
  are how you control this: wrap the slow part on its own, and the rest of the page streams out
  without it.
- **The server needs its own address** (`APP_URL`). In production you'd set it to the deployed
  site's URL.

---

## 6.7 Mutations from the UI

The last page is `/recipes/new`, a form that calls `createRecipe`.

### The page

Create `app/recipes/new/page.tsx`:

```tsx
import { RecipeForm } from "@/components/recipe-form";

export default function NewRecipePage() {
  return (
    <>
      <h1>New recipe</h1>
      <RecipeForm />
    </>
  );
}
```

`/recipes/new` and `/recipes/[id]` don't conflict: a folder with a fixed name (`new`) always takes
priority over a dynamic one (`[id]`).

### The form

Create `components/recipe-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, type CombinedError } from "@urql/next";
import { graphql } from "@/lib/generated";
import type { Unit } from "@/lib/generated/graphql";

const CreateRecipeMutation = graphql(`
  mutation CreateRecipe($input: RecipeInput!) {
    createRecipe(input: $input) {
      id
    }
  }
`);

const UNITS: Unit[] = [
  "GRAM",
  "KILOGRAM",
  "MILLILITER",
  "LITER",
  "TEASPOON",
  "TABLESPOON",
  "CUP",
  "PIECE",
];

type IngredientRow = { name: string; quantity: string; unit: Unit };

const emptyRow = (): IngredientRow => ({ name: "", quantity: "", unit: "GRAM" });

export function RecipeForm() {
  const router = useRouter();
  const [{ fetching, error }, createRecipe] = useMutation(CreateRecipeMutation);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [tags, setTags] = useState("");
  const [ingredients, setIngredients] = useState<IngredientRow[]>([emptyRow()]);

  function updateRow(index: number, patch: Partial<IngredientRow>) {
    setIngredients((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = await createRecipe({
      input: {
        title,
        description: description || null,
        steps: steps.split("\n"),
        ingredients: ingredients.map((row) => ({
          name: row.name,
          quantity: Number(row.quantity),
          unit: row.unit,
        })),
        tags: tags.split(","),
      },
    });

    if (result.data) {
      router.push(`/recipes/${result.data.createRecipe.id}`);
    }
  }


  return (
    <form onSubmit={handleSubmit} className="recipe-form">
      {error && (
        <p role="alert" className="form-error">
          {getValidationMessage(error) ?? "Something went wrong. Please try again."}
        </p>
      )}

      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <fieldset>
        <legend>Ingredients</legend>
        {ingredients.map((row, index) => (
          <div key={index} className="ingredient-row">
            <input
              aria-label="Ingredient"
              placeholder="Onion"
              value={row.name}
              onChange={(e) => updateRow(index, { name: e.target.value })}
            />
            <input
              aria-label="Quantity"
              type="number"
              step="any"
              placeholder="1"
              value={row.quantity}
              onChange={(e) => updateRow(index, { quantity: e.target.value })}
            />
            <select
              aria-label="Unit"
              value={row.unit}
              onChange={(e) => updateRow(index, { unit: e.target.value as Unit })}
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit.toLowerCase()}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIngredients((rows) => rows.filter((_, i) => i !== index))}
              disabled={ingredients.length === 1}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setIngredients((rows) => [...rows, emptyRow()])}>
          Add ingredient
        </button>
      </fieldset>

      <label>
        Steps <small>(one per line)</small>
        <textarea rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} />
      </label>

      <label>
        Tags <small>(comma-separated)</small>
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>

      <button type="submit" disabled={fetching}>
        {fetching ? "Saving…" : "Create recipe"}
      </button>
    </form>
  );
}

// The server's validation errors (§5.8) arrive as GraphQL errors with
// extensions.code === "BAD_USER_INPUT", and their messages are written for users.
// Anything else is unexpected, and its message isn't for users.
function getValidationMessage(error: CombinedError | undefined) {
  const validationError = error?.graphQLErrors.find(
    (e) => e.extensions.code === "BAD_USER_INPUT",
  );
  return validationError?.message ?? null;
}
```

This is long, but most of it is ordinary React form state. The GraphQL parts:

- **`useMutation(CreateRecipeMutation)`** returns `[state, execute]`. Unlike `useQuery`, nothing
  happens until you call `execute`, here `createRecipe(...)`, with the variables. `state.fetching`
  is `true` while it's in flight, which drives the "Saving…" button.
- **The variables are typed from `RecipeInput`.** Codegen generated an input type from the
  schema's `RecipeInput`, so `createRecipe({ input: … })` is checked: misspell `ingredients`, send
  `quantity` as a string, or use a unit that isn't in `Unit`, and it doesn't compile.
- **`UNITS: Unit[]`** is the list for the dropdown. `Unit` is just a type, which doesn't exist at
  runtime, so the values are listed out. The `Unit[]` annotation still catches a misspelled one.
- **`await createRecipe(...)`** resolves to the result, so the form can act on it: when `data` is
  there, `router.push` navigates to the new recipe's page.
- **The form sends raw input.** The steps are split on newlines and the tags on commas, but nothing
  is trimmed or checked here. That's deliberate: `validateRecipeInput` on the server (§5.8) already
  trims, drops blank lines, lowercases tags, and rejects bad values, and it's the check that can't
  be skipped. Part 8 adds client-side checks that share the server's rules, for instant feedback.

### Showing server errors

When validation fails, the server responds with a `GraphQLError` whose `extensions.code` is
`"BAD_USER_INPUT"` (§5.8–5.9). urql wraps every error from a request in a **`CombinedError`**:
`error.graphQLErrors` holds the errors the server returned, and `error.networkError` is set if the
request itself failed.

`getValidationMessage` looks for a `BAD_USER_INPUT` error and returns its message, because those
messages were written for users: "Title is required", "Add at least one step". Anything else gets
a generic message. An unexpected error's message is `"Unexpected error."` at best, and it's not
something to show a user.

### How the list knows there's a new recipe

Create a recipe, then click **Cookbook** to go back to the list. The new recipe is there, but urql
had a cached result for the `Recipes` query from your earlier visit. Why wasn't that stale result
shown?

Because the document cache invalidates by **type**. urql adds `__typename` to every query and
mutation it sends, so it knows every result's types. The cached `Recipes` result contains objects
of type `Recipe`. When a mutation result comes back containing a `Recipe` (here, `createRecipe`'s
`{ id, __typename: "Recipe" }`), urql marks every cached result containing a `Recipe` as stale.
The next time the list renders, it refetches.

That rule has one hole: **an empty list**. If `recipes` came back `[]`, the cached result has no
`Recipe` objects in it, so urql doesn't know it's related, and creating a recipe wouldn't refresh
it. If you ever need that, tell urql explicitly which types a query depends on:

```tsx
const context = useMemo(() => ({ additionalTypenames: ["Recipe"] }), []);
const [{ data, error }] = useQuery({ query: RecipesQuery, context });
```

`useMemo` keeps `context` the same object between renders. A new object every render would make
urql think the query had changed. The seed guarantees at least one recipe, so the tutorial doesn't
need this.

### Try it

1. Submit the form with a blank title. You should see "Title is required" from the server.
2. Fill it in properly and submit. You should land on the new recipe's page.
3. Click **Cookbook**. The new recipe is at the top of the list.

---

## 6.8 Optimistic updates

The favorite count on the wireframe is a button: click ♡ and it becomes ♥ and the count goes up.
If the button waits for the server before changing, every click feels sluggish. An **optimistic
update** shows the result immediately, assuming the request will succeed, and undoes it if the
request fails.

There's no favorite mutation yet. Favoriting needs to know *who* is favoriting, and that's Part 7.
So this section uses a stand-in function that waits a second and sometimes fails, to show the
pattern. Part 7 swaps in the real mutation.

React 19 has a hook built for this: **`useOptimistic`**. Create `components/favorite-button.tsx`:

```tsx
"use client";

import { useOptimistic, useState, useTransition } from "react";

// Stand-in for the real favoriteRecipe mutation, which arrives in Part 7 once
// there's a logged-in user to favorite *as*. Slow, and fails one time in four,
// so you can watch the optimistic value appear — and roll back.
async function fakeFavoriteRequest(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (Math.random() < 0.25) throw new Error("Network hiccup");
}

type Props = { initialCount: number };

export function FavoriteButton({ initialCount }: Props) {
  // What the server has confirmed.
  const [favorited, setFavorited] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);

  // What the user sees: the confirmed state, with any in-flight change applied on top.
  const [optimistic, setOptimistic] = useOptimistic(
    { favorited, count },
    (current, next: boolean) => ({
      favorited: next,
      count: current.count + (next ? 1 : -1),
    }),
  );
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !optimistic.favorited;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      try {
        await fakeFavoriteRequest();
        startTransition(() => {
          setFavorited(next);
          setCount((c) => c + (next ? 1 : -1));
        });
      } catch {
        setError("Couldn't save — try again.");
      }
    });
  }

  return (
    <span className="favorite">
      <button type="button" onClick={toggle} disabled={isPending} aria-pressed={optimistic.favorited}>
        {optimistic.favorited ? "♥" : "♡"} {optimistic.count}
      </button>
      {error && <small role="status">{error}</small>}
    </span>
  );
}
```

Read it as two layers of state:

- **Confirmed state** (`favorited`, `count`) holds what the server agreed to. It only changes
  after a request succeeds.
- **Optimistic state** (`optimistic`) is what the user sees. `useOptimistic` takes the confirmed
  state plus an update function. While an update is in flight, it returns the confirmed state with
  that update applied. Once the transition finishes, it goes back to showing the confirmed state.

So in `toggle`:

1. `setOptimistic(next)` inside `startTransition` makes the button flip immediately.
2. The request runs. While it's pending, `isPending` is `true` and the button is disabled, so the
   user can't stack up clicks.
3. **On success**, the confirmed state is updated to match. When the transition ends, the
   optimistic layer disappears, and there's no visible change because the two now agree.
4. **On failure**, the confirmed state is left alone. When the transition ends, the button falls
   back to it, which undoes the optimistic change on its own, and the error message explains why.

Notice there's no "undo" code. Rollback is the default: optimistic values only last while the
transition is running.

Use it in `components/recipe-detail.tsx`. Import it:

```tsx
import { FavoriteButton } from "./favorite-button";
```

and replace the `<h1>` and the line under it with:

```tsx
      <h1>
        {recipe.title} <FavoriteButton initialCount={recipe.favoriteCount} />
      </h1>
      <p>
        by {recipe.author.name} · updated{" "}
        {new Date(recipe.updatedAt).toLocaleDateString()}
      </p>
```

### Try it

Open a recipe and click ♡ a few times. It should flip immediately and settle a second later. About
one click in four "fails": you'll see the heart revert and "Couldn't save — try again." Reload the
page and the count is back to the real one, because nothing was saved.

> **Optimistic updates and the urql cache.** Here only the button knows about the change. In
> Part 7, a successful favorite should also update the ♥ count on the list page. urql's document
> cache can't patch one field across cached results; its answer is to refetch. For truly
> optimistic, cache-wide updates, urql has a second cache, **Graphcache**, that stores data as
> individual objects. Part 7 decides whether favorites need it.

---

## Checkpoint — browse recipes and create one entirely through the UI

New files:

```
app/
├── layout.tsx                 now wraps pages in <Providers> (replaced)
├── page.tsx                   the recipe list (replaced)
├── providers.tsx              UrqlProvider
├── globals.css                + Part 6 styles
└── recipes/
    ├── [id]/page.tsx          recipe detail
    └── new/page.tsx           create form
components/
├── favorite-button.tsx
├── recipe-card.tsx
├── recipe-detail.tsx
├── recipe-form.tsx
└── recipe-list.tsx
lib/
├── urql.ts                    the urql client
└── generated/                 codegen output (git-ignored)
codegen.ts
```

Plus the `codegen` scripts in `package.json`, `/lib/generated/` in `.gitignore`, the
`lib/generated/**` ESLint ignore, and `app/page.module.css` deleted.

You should be able to:

```bash
npm run dev                # terminal 1
npm run codegen            # terminal 2, with the dev server up
npx tsc --noEmit           # no errors
npm run lint               # no errors or warnings
```

And in the browser:

- `/` lists every recipe as a card with author, ♥ count, and tags. **View source** shows the recipe
  titles in the HTML.
- Clicking a card opens `/recipes/<id>` with ingredients and numbered steps. A made-up ID shows
  "Recipe not found".
- `/recipes/new` creates a recipe. A blank title shows the server's "Title is required". A valid
  submission lands on the new recipe's page, and the list shows it without a reload.
- The ♡ button flips immediately, and rolls back when the stand-in request fails.

**What you have now:**

- A typed path from database to UI. Rename a field in `schema.prisma` and the compiler follows it
  through Pothos, the GraphQL schema, the generated types, and into the component that renders it.
- Components that declare their own data needs with fragments.
- Pages whose first HTML already contains their data.
- A form that relies on the server's validation and shows its messages.

**Known gaps, on purpose:** every request is still Sam, and there's no editing or deleting from
the UI (Part 7). The favorite button doesn't save (Part 7). The list is unfiltered and unpaginated,
and the form only validates on the server (Part 8).

Commit and tag:

```bash
git add -A
git commit -m "Part 6 — frontend: urql, codegen, list/detail/create pages"
git tag part-06-complete
```

---

## What's next

Part 7 adds real users: sign up and log in, a session cookie that replaces the "every request is
Sam" stub in `graphql/context.ts`, rules for who may edit and delete which recipe, and the real
favorite mutation behind the button you just built.
