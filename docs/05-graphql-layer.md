# Part 5 — The GraphQL layer

Part 4 gave you a database with a schema and real rows in it. This Part puts an API in front of
it: a GraphQL schema defined in TypeScript with Pothos, served by GraphQL Yoga from a single
Next.js route handler, with queries to read recipes and mutations to create, update, and delete
them.

Still no frontend. By the end you'll have exercised every query and mutation by hand in GraphiQL,
the in-browser explorer Yoga ships with — so when Part 6 builds the UI, the API underneath it is
already known to work.

> **Follow along.** Continues from `part-04-complete` — a migrated, seeded database. Run
> `docker compose up -d` if Postgres isn't running (and open Docker Desktop first if `docker`
> can't find its socket). If your data has drifted, `npx prisma migrate reset` puts it back to the
> seed. The repo is committed and tagged `part-05-complete` at the end.

---

## 5.1 A GraphQL crash course

If you've built against REST APIs, most of GraphQL is a rearrangement of things you already know.
This section is the minimum vocabulary for the rest of the Part.

### One endpoint, a typed schema

A REST API is many URLs, each returning whatever shape its handler decides. A GraphQL API is **one
URL** (`/api/graphql` here) backed by a **schema** — a type system describing every piece of data
the API can return and every operation it accepts. Here's a slice of the schema you'll have by the
end of this Part, written in GraphQL's own *Schema Definition Language* (SDL):

```graphql
type Recipe {
  id: ID!
  title: String!
  description: String
  author: User!
  steps: [Step!]!
}

type User {
  id: ID!
  name: String!
  recipes: [Recipe!]!
}

type Query {
  recipes: [Recipe!]!
  recipe(id: ID!): Recipe
}
```

Read it like TypeScript with the punctuation moved around:

- **`String!`** — the `!` means *non-null*. `title` is always a string. `description` has no `!`,
  so it's `string | null`. This is the **opposite** of TypeScript's `?`: in GraphQL, fields are
  nullable unless marked otherwise.
- **`[Step!]!`** — a non-null list of non-null `Step`s. The list itself is always present (maybe
  empty) and never contains a `null`.
- **`ID`** — a scalar that serializes as a string, used for identifiers. Semantically "opaque —
  don't do arithmetic on it."
- **`recipe(id: ID!)`** — fields can take **arguments**. Here, a required ID.

### `Query` and `Mutation` are the entry points

Two types are special. **`Query`** holds the fields a client can start a read from; **`Mutation`**
holds the operations that write. Everything else — `Recipe`, `User`, `Step` — is only reachable by
walking from one of those roots.

That's where the *graph* in GraphQL comes from. `Query.recipes` returns `Recipe`s; a `Recipe` has
an `author`, which is a `User`; that `User` has `recipes`… The schema is a graph of types connected
by fields, and a query is a path through it.

### The client picks the fields

A client sends a **query document** — a string — naming exactly the fields it wants:

```graphql
query {
  recipes {
    title
    author {
      name
    }
  }
}
```

And gets back JSON in exactly that shape:

```json
{
  "data": {
    "recipes": [
      { "title": "Weeknight Chili", "author": { "name": "Sam" } }
    ]
  }
}
```

No `id`, no `description`, no steps — they weren't asked for. The recipe list page and the recipe
detail page can hit the same endpoint and each get precisely what they render. That's the headline
feature: the **client** decides the response shape, within the bounds the **schema** allows.

### Resolvers do the work

The schema only declares shapes. Every field is backed by a **resolver** — a function that
produces its value. `Query.recipes`'s resolver calls Prisma and returns rows. `Recipe.author`'s
resolver takes one recipe (its *parent*) and returns that recipe's user. The server walks the
query, calling the resolver for each field requested and nothing else.

Every resolver has the same four arguments, which you'll see throughout this Part:

| Argument | What it is |
|---|---|
| `parent` | The object this field belongs to — the `Recipe` when resolving `Recipe.author`. For root `Query`/`Mutation` fields it's empty. |
| `args` | The field's arguments — `{ id: "..." }` for `recipe(id:)`. |
| `context` | A per-request object every resolver can read — the current user lives here. |
| `info` | Metadata about the query being run. You'll rarely touch it; the Pothos Prisma plugin uses it heavily (§5.7). |

### Mutations

A mutation is a `Mutation` field. Syntactically it's identical to a query field — arguments in, an
object out — the difference is convention and execution: mutation fields may write, and when a
document contains several, they run one after another rather than in parallel.

```graphql
mutation {
  deleteRecipe(id: "clx...")
}
```

That's enough vocabulary. The rest of GraphQL — fragments, variables, directives — shows up when
you need it.

---

## 5.2 Code-first vs. schema-first

There are two ways to build that schema on the server.

**Schema-first:** you write the SDL above by hand in a `.graphql` file, then write resolvers
separately in TypeScript and wire them up by name. The schema is the source of truth, and the
TypeScript has to be kept in agreement with it — by discipline, or by running a code generator that
produces resolver types from the SDL.

**Code-first:** you write the schema *in TypeScript*, and the SDL is an output. With Pothos,
defining `Recipe` looks like this (you'll write exactly this in §5.5):

```ts
builder.prismaObject("Recipe", {
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    description: t.exposeString("description", { nullable: true }),
  }),
});
```

This tutorial uses code-first with Pothos, for one reason: **there is one source of truth, and the
type checker enforces it.** In the snippet above:

- `"Recipe"` is checked against your Prisma models — a typo is a compile error.
- `t.exposeString("title")` is checked against the `Recipe` model's fields — exposing a field that
  doesn't exist, or exposing an `Int` as a `String`, is a compile error.
- Drop `{ nullable: true }` from `description` and it's a compile error, because the database
  column is nullable and you just promised GraphQL clients it never would be.
- Resolvers' `args` are typed from the arguments you declared, and their return type is checked
  against the field's type.

The cost is that the SDL is no longer something you read in a file — it's generated. Yoga's
GraphiQL has a schema browser, and in Part 6 GraphQL Code Generator reads the schema straight from
the running server, so in practice you rarely miss it.

> **Pothos's defaults for nullability.** Pothos flips GraphQL's defaults to something safer:
> **output fields are non-null** unless you say `nullable: true`, and **arguments and input fields
> are optional** unless you say `required: true`. You'll see both flags a lot.

---

## 5.3 Wiring GraphQL Yoga into Next.js

Install the server, the schema builder, and its Prisma plugin:

```bash
npm install graphql@16 graphql-yoga @pothos/core @pothos/plugin-prisma
```

`graphql` is the reference implementation everything else builds on — the parser, validator, and
executor. It's pinned to v16 because v17 is recent, and v16 is the version every tool in this stack
(including Part 6's client-side tooling) supports without caveats.

Here's how the files for this Part fit together, matching the layout sketched in §3.2:

```
graphql/
├── builder.ts            the Pothos SchemaBuilder, configured once (§5.4)
├── context.ts            builds the per-request context (§5.4)
├── errors.ts             helpers for errors the client should see (§5.9)
├── schema.ts             imports every type file, exports the finished schema
└── types/
    ├── user.ts
    ├── recipe.ts         the Recipe type and its queries (§5.5–5.7)
    ├── recipe-parts.ts   Step, RecipeIngredient, Ingredient, Tag, the Unit enum (§5.7)
    └── recipe-mutations.ts  create/update/delete (§5.8)
app/
└── api/graphql/
    └── route.ts          mounts Yoga at /api/graphql
```

Start from the outside in — the route handler. Create `app/api/graphql/route.ts`:

```ts
import { createYoga } from "graphql-yoga";
import { createContext } from "@/graphql/context";
import { schema } from "@/graphql/schema";

const { handleRequest } = createYoga({
  schema,
  context: createContext,
  // Yoga needs to know the path it's mounted at, since Next.js decided it, not Yoga.
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Response },
});

export async function GET(request: Request) {
  return handleRequest(request, {});
}

export async function POST(request: Request) {
  return handleRequest(request, {});
}
```

What's happening:

- **A route handler** is a file named `route.ts` under `app/` that exports functions named after
  HTTP methods. Next.js serves this one at `/api/graphql`. There's no page, no React — it's a plain
  `Request` in, `Response` out.
- **`createYoga`** builds a server around the schema. Its `handleRequest` is itself a
  `Request → Response` function, so the route handlers just delegate to it. That's why Yoga fits
  Next.js so cleanly: both speak the standard Fetch API.
- **`POST`** is how clients send queries and mutations. **`GET`** serves two things: queries sent as
  URL parameters, and — when you open the URL in a browser — **GraphiQL**, Yoga's built-in
  explorer.
- **`context: createContext`** — Yoga calls this once per request, and whatever it returns is the
  `context` argument every resolver receives. You'll write it in §5.4.

This file won't compile yet — `@/graphql/schema` and `@/graphql/context` don't exist. The next
section builds them.

---

## 5.4 The Pothos builder

### Generating Pothos's Prisma types

The Prisma plugin needs to know your models — their fields, relations, and types — at compile time
(for type-checking) and at runtime (to plan queries). It gets both from a Prisma **generator**, the
same mechanism that produces the Prisma client. Add a second generator to `prisma/schema.prisma`,
below the existing `generator client`:

```prisma
generator pothos {
  provider = "prisma-pothos-types"
}
```

Then regenerate:

```bash
npx prisma generate
```

This writes Pothos's types into `node_modules/@pothos/plugin-prisma/generated`. Like the Prisma
client, it's generated code in `node_modules` — never committed, and rebuilt by every
`prisma generate` (which `migrate dev` and `migrate reset` both run for you). If you ever see
Pothos errors claiming a model doesn't exist, a stale generation is the first suspect.

### The builder

Create `graphql/builder.ts`:

```ts
import SchemaBuilder from "@pothos/core";
import PrismaPlugin from "@pothos/plugin-prisma";
import type PrismaTypes from "@pothos/plugin-prisma/generated";
import { getDatamodel } from "@pothos/plugin-prisma/generated";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type Context = {
  currentUser: User | null;
};

export const builder = new SchemaBuilder<{
  PrismaTypes: PrismaTypes;
  Context: Context;
  Scalars: {
    ID: { Input: string; Output: string };
    DateTime: { Input: Date; Output: Date };
  };
}>({
  plugins: [PrismaPlugin],
  prisma: {
    client: prisma,
    dmmf: getDatamodel(),
    // Warn in dev when a resolver forgets to pass Pothos's `query` through to Prisma (§5.6).
    onUnusedQuery: process.env.NODE_ENV === "production" ? null : "warn",
  },
});

builder.scalarType("DateTime", {
  serialize: (date) => date.toISOString(),
  parseValue: (value) => {
    if (typeof value !== "string") {
      throw new TypeError("DateTime must be an ISO-8601 string");
    }
    return new Date(value);
  },
});

builder.queryType({});
builder.mutationType({});
```

The generic argument to `SchemaBuilder` is where the type safety comes from — it's a single object
type describing everything the builder needs to know:

- **`PrismaTypes`** — the generated model types, so `prismaObject("Recipe", …)` knows what
  `Recipe` has.
- **`Context`** — the shape of the per-request context. Every resolver's `ctx` is typed as this.
- **`Scalars`** — the TypeScript types behind each scalar. By default Pothos types incoming `ID`s as
  `string | number` (GraphQL allows both on the wire); since every ID in this schema is a `cuid()`
  string, narrowing it to `string` saves a `String(args.id)` in every resolver. `DateTime` is a
  **custom scalar** — GraphQL has no built-in date type, so you declare one: a `Date` on the server,
  an ISO string on the wire. `serialize` handles the outgoing direction, `parseValue` the incoming
  one.

The runtime options: `client` is the Prisma singleton from §3.5, and `dmmf` is Prisma's description
of your data model — the plugin reads it to translate GraphQL selections into Prisma `include`s.

Finally, `queryType({})` and `mutationType({})` create the two root types *empty*. Each type file
adds its own fields to them with `builder.queryFields` / `builder.mutationFields`, so no single
file has to know about every operation.

### The context

Create `graphql/context.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { Context } from "./builder";

// TEMPORARY (Part 5): there's no login yet, so every request acts as the oldest user in the
// database — Sam, from the seed. Part 7 replaces this with the user from the session cookie.
export async function createContext(): Promise<Context> {
  const currentUser = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  return { currentUser };
}
```

`createRecipe` needs an author, and authors come from "who is making this request" — which is
exactly what the context is for. Rather than make the mutation take an `authorId` argument now and
rip it out in Part 7, the context pretends a user is logged in. Resolvers are written against
`ctx.currentUser` from day one, and Part 7 only changes *how* it's filled in. (Yoga passes the
context function the incoming `request`; this version doesn't need it yet, but Part 7 reads the
session cookie from it.)

### Assembling the schema

Create `graphql/schema.ts`:

```ts
import { builder } from "./builder";

import "./types/user";
import "./types/recipe";
import "./types/recipe-parts";
import "./types/recipe-mutations";

export const schema = builder.toSchema();
```

The type files don't export anything — importing them runs their `builder.…` calls, registering
types and fields as a side effect. `toSchema()` then assembles everything registered into a
`GraphQLSchema`. That's why the imports must come **before** `toSchema()`: a type file imported
after it would register into a schema that's already been built.

Create the four files under `graphql/types/` empty for now, so the imports resolve. The next
sections fill them in.

---

## 5.5 The first object type

Open `graphql/types/recipe.ts`:

```ts
import { builder } from "../builder";

builder.prismaObject("Recipe", {
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    description: t.exposeString("description", { nullable: true }),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    updatedAt: t.expose("updatedAt", { type: "DateTime" }),
  }),
});
```

- **`builder.prismaObject("Recipe", …)`** — a GraphQL object type backed by the Prisma `Recipe`
  model. The name defaults to the model's.
- **`fields: (t) => ({ … })`** — a function, not an object, so that types can reference each other
  regardless of which file loads first. `t` is the *field builder*.
- **`t.exposeString("title")`** — "expose the model's `title` column as a `String` field." The
  `expose*` helpers are for fields whose value is just the column, no logic. They're shorthand for
  a resolver that returns `parent.title`.
- **`t.expose("createdAt", { type: "DateTime" })`** — the generic form, for custom scalars.

Notice what's *not* here: `authorId`. A foreign key is a database detail; the graph exposes the
relation (`author`) instead, in §5.7.

Now `graphql/types/user.ts`:

```ts
import { builder } from "../builder";

builder.prismaObject("User", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
  }),
});
```

`email` is deliberately left off. Anything you expose, any client can query about any user — and
emails aren't public. Part 7 adds it back behind a check that only lets you see your own.

---

## 5.6 Queries

Add to `graphql/types/recipe.ts`:

```ts
import { prisma } from "@/lib/prisma";

builder.queryFields((t) => ({
  recipes: t.prismaField({
    type: ["Recipe"],
    resolve: (query) =>
      prisma.recipe.findMany({
        ...query,
        orderBy: { createdAt: "desc" },
      }),
  }),

  recipe: t.prismaField({
    type: "Recipe",
    nullable: true,
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (query, _parent, args) =>
      prisma.recipe.findUnique({
        ...query,
        where: { id: args.id },
      }),
  }),
}));
```

- **`type: ["Recipe"]`** — an array in `type` means a list: `[Recipe!]!`.
- **`recipe` is `nullable: true`** because a lookup by ID can legitimately find nothing, and
  `findUnique` returns `null` in that case. Pothos checks this: leave `nullable` off and the
  resolver's `Recipe | null` return type is a compile error. "Not found" on a read is represented
  as `null`, not as an error — the client asked a question and the answer is "there isn't one."
- **`t.arg.id({ required: true })`** — the `id: ID!` argument. `args.id` is typed `string`, thanks
  to the `Scalars` config in §5.4.
- **`t.prismaField`** rather than `t.field` — the difference is that first `query` argument, which
  plain fields don't get. Keep reading.

### The `query` argument

Every `prismaField` resolver receives a `query` object as its first argument and must spread it
into the Prisma call: `findMany({ ...query, orderBy })`. The plugin builds `query` by looking at
what the client's GraphQL document asked for *underneath* this field. For `{ recipes { title } }`,
it's `{}`. For `{ recipes { title author { name } } }`, it's `{ include: { author: true } }`.

That's how one resolver can serve every shape of query efficiently — it doesn't know or care which
relations the client wants; `query` carries that in. Forget to spread it and the query still
*works* (the plugin falls back to loading relations separately), but less efficiently — which is
what the `onUnusedQuery: "warn"` option in the builder catches.

### Try it

Start the dev server:

```bash
npm run dev
```

Open <http://localhost:3000/api/graphql>. That's GraphiQL. Run:

```graphql
query {
  recipes {
    id
    title
    description
    createdAt
  }
}
```

You should see the seeded Weeknight Chili. Copy its `id`, then try the single lookup:

```graphql
query {
  recipe(id: "PASTE-ID-HERE") {
    title
  }
}
```

And with a made-up ID — `recipe` should come back `null`, with no `errors`.

Open GraphiQL's **Docs** panel (the book icon, top left). That's the SDL Pothos generated from your
TypeScript — `recipe(id: ID!): Recipe`, `description: String`, `createdAt: DateTime!`, exactly as
§5.1 described.

---

## 5.7 Exposing relations

A recipe without its author, steps, and ingredients isn't much use. Relations are one line each.
Add to the `fields` of `Recipe` in `graphql/types/recipe.ts`:

```ts
    author: t.relation("author"),
    steps: t.relation("steps", {
      query: { orderBy: { order: "asc" } },
    }),
    ingredients: t.relation("ingredients"),
    tags: t.relation("tags", {
      query: { orderBy: { name: "asc" } },
    }),
    favoriteCount: t.relationCount("favoritedBy"),
```

And to `User`:

```ts
    recipes: t.relation("recipes", {
      query: { orderBy: { createdAt: "desc" } },
    }),
```

- **`t.relation("author")`** — exposes a Prisma relation field as a GraphQL field. Its type
  (`User!`, `[Step!]!`) is inferred from the Prisma schema.
- **`query: { orderBy: … }`** — merged into the Prisma query whenever this relation is loaded.
  Steps come back in step order; without this, the database returns them in whatever order it
  likes.
- **`t.relationCount("favoritedBy")`** — an `Int!` computed with a SQL `COUNT`, not by loading
  every favorite and measuring the array. It's the `♥ 12` on the recipe list wireframe in Part 0.

`t.relation` only works if the *target* type exists in the graph too. `Recipe.steps` needs a
`Step` type, `Recipe.ingredients` needs `RecipeIngredient`, and so on. Fill in
`graphql/types/recipe-parts.ts`:

```ts
import { Unit } from "@prisma/client";
import { builder } from "../builder";

export const UnitEnum = builder.enumType(Unit, { name: "Unit" });

builder.prismaObject("Step", {
  fields: (t) => ({
    id: t.exposeID("id"),
    order: t.exposeInt("order"),
    text: t.exposeString("text"),
  }),
});

builder.prismaObject("RecipeIngredient", {
  fields: (t) => ({
    quantity: t.exposeFloat("quantity"),
    unit: t.expose("unit", { type: UnitEnum }),
    ingredient: t.relation("ingredient"),
  }),
});

builder.prismaObject("Ingredient", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
  }),
});

builder.prismaObject("Tag", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
  }),
});
```

- **`builder.enumType(Unit, …)`** — Prisma generates `Unit` as a real JavaScript object
  (`{ GRAM: "GRAM", … }`), and Pothos turns it into a GraphQL `enum Unit`. The database, the Prisma
  client, and the API now share one list of units; add one to `schema.prisma`, migrate, and it
  appears in the API with no other change. It's exported because the mutation inputs in §5.8 need
  it.
- **`RecipeIngredient` has no `id`** — its primary key is the `(recipeId, ingredientId)` pair, and
  there's no need to expose either half; the client reaches it through `Recipe.ingredients` and
  gets the `Ingredient` from there.

Notice the shape this gives the API: `recipe.ingredients` is a list of *"this much of that
ingredient"*, not a list of ingredients. The explicit join model from §4.2 shows up in the graph
too, because the quantity and unit genuinely belong to it.

Now a real query:

```graphql
query {
  recipes {
    title
    favoriteCount
    author { name }
    tags { name }
    steps { order text }
    ingredients {
      quantity
      unit
      ingredient { name }
    }
  }
}
```

### The N+1 problem, and why you don't have it

Look at the terminal running `npm run dev`. `lib/prisma.ts` logs every SQL query in development
(§3.5), so you can see exactly what that GraphQL query cost.

To see why that matters, picture the naive way to implement `Recipe.author` — a resolver that runs
once *per recipe*:

```ts
// What you'd write without the Prisma plugin
author: t.field({
  type: User,
  resolve: (recipe) => prisma.user.findUnique({ where: { id: recipe.authorId } }),
}),
```

GraphQL resolves fields one parent at a time. A list of 50 recipes means 1 query for the list,
then 50 separate queries for 50 authors — **N+1** queries, where N is the number of rows. Add steps
and ingredients and it's 1 + 50 + 50 + 50. The page gets slower in direct proportion to how much
data there is, and nothing in the code looks wrong.

The Prisma plugin avoids this by working from the top down instead. When `Query.recipes` runs, the
plugin inspects the whole GraphQL selection underneath it, and builds a single nested `include` —
`{ author: true, tags: …, steps: …, ingredients: { include: { ingredient: true } } }` — that
arrives as the `query` argument. Prisma then fetches each relation with **one query for all
parents** (`WHERE "id" IN (…)`), not one per parent. By the time `Recipe.author` "resolves," the
author is already sitting on the recipe object.

So the query count in your terminal is one per *relation in the query*, not one per *row*. Seed ten
more recipes and the log for that GraphQL query stays the same length. That property — cost scales
with the shape of the query, not the size of the data — is the thing to keep an eye on for the rest
of the tutorial, and the `query` spread in every `prismaField` is what keeps it true.

---

## 5.8 Mutations

Three mutations: `createRecipe`, `updateRecipe`, `deleteRecipe`. They all go in
`graphql/types/recipe-mutations.ts`, and they need two things that don't exist yet: an input type
and some validation.

### Input types

A mutation that creates a recipe with its steps, ingredients, and tags has a lot of arguments.
Rather than a dozen top-level arguments, GraphQL groups them into an **input type** — like an object
type, but for data coming *in*:

```ts
import { builder } from "../builder";
import { UnitEnum } from "./recipe-parts";

const IngredientInput = builder.inputType("IngredientInput", {
  fields: (t) => ({
    name: t.string({ required: true }),
    quantity: t.float({ required: true }),
    unit: t.field({ type: UnitEnum, required: true }),
  }),
});

const RecipeInput = builder.inputType("RecipeInput", {
  fields: (t) => ({
    title: t.string({ required: true }),
    description: t.string(),
    steps: t.stringList({ required: true }),
    ingredients: t.field({ type: [IngredientInput], required: true }),
    tags: t.stringList({ required: true }),
  }),
});
```

Some deliberate choices in that shape:

- **Steps are plain strings.** The `order` column exists to keep steps in sequence, but the client
  already expresses sequence — it's the order of the array. The server derives `order` from the
  index, so a client can never send two step 3s or skip step 2. Derive, don't store twice.
- **Ingredients and tags are referenced by name**, not ID. A user typing "onion" into a form
  doesn't know or care whether "onion" already exists in the `Ingredient` table. The server works
  that out (`connectOrCreate`, below).
- **`updateRecipe` takes the same `RecipeInput`** — the whole recipe, replacing what's there,
  rather than a patch of just the changed fields. The edit form in Part 6 always has the full
  recipe in hand anyway, and "replace the steps" is far simpler to get right than "work out which
  steps were inserted, removed, and reordered."

### Validation

The GraphQL layer already validates *types* — a missing `title` or a `quantity: "lots"` is rejected
before any resolver runs. What it can't know are the rules that are about meaning: a title that's
just spaces, a negative quantity, the same ingredient listed twice (which would violate
`RecipeIngredient`'s composite primary key and blow up in Postgres with an unhelpful error).

Those checks belong in the resolver. First, a helper for reporting them, in `graphql/errors.ts`:

```ts
import { GraphQLError } from "graphql";

export function badInput(message: string, field?: string) {
  return new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT", field },
  });
}
```

(§5.9 explains why this returns a `GraphQLError` in particular, and adds two more helpers.)

Then, in `recipe-mutations.ts`, a function that checks the input and returns a cleaned-up copy:

```ts
import { badInput } from "../errors";

type RecipeInputData = typeof RecipeInput.$inferInput;

function validateRecipeInput(input: RecipeInputData) {
  const title = input.title.trim();
  if (!title) throw badInput("Title is required", "title");
  if (title.length > 120) throw badInput("Title must be 120 characters or fewer", "title");

  const steps = input.steps.map((step) => step.trim()).filter(Boolean);
  if (steps.length === 0) throw badInput("Add at least one step", "steps");

  const ingredients = input.ingredients.map((ingredient) => ({
    ...ingredient,
    name: ingredient.name.trim(),
  }));
  if (ingredients.length === 0) throw badInput("Add at least one ingredient", "ingredients");

  const seen = new Set<string>();
  for (const { name, quantity } of ingredients) {
    if (!name) throw badInput("Every ingredient needs a name", "ingredients");
    if (!(quantity > 0)) throw badInput(`Quantity for "${name}" must be positive`, "ingredients");

    const key = name.toLowerCase();
    if (seen.has(key)) throw badInput(`"${name}" is listed more than once`, "ingredients");
    seen.add(key);
  }

  const tags = [...new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];

  return {
    title,
    description: input.description?.trim() || null,
    steps,
    ingredients,
    tags,
  };
}
```

- **`typeof RecipeInput.$inferInput`** — Pothos exposes the TypeScript type of an input object on
  its ref, so this function's parameter is always in sync with the GraphQL input definition.
- **Throw on the first problem.** Collecting every error at once is friendlier, and Part 8 does it
  with a shared zod schema that the form uses too. For now, one message at a time keeps the
  resolver readable.
- **Tags are normalized, duplicates collapsed.** `"Dinner "` and `"dinner"` are the same tag; the
  unique constraint on `Tag.name` would otherwise treat them as two.

### Translating input into Prisma writes

Three small functions turn the validated input into the nested-write shapes Prisma expects — the
same shapes `seed.ts` used by hand in Part 4, with `connectOrCreate` swapped in for "look it up by
name, create it if it's new":

```ts
type ValidRecipe = ReturnType<typeof validateRecipeInput>;

const stepCreates = (steps: ValidRecipe["steps"]) =>
  steps.map((text, index) => ({ order: index + 1, text }));

const ingredientCreates = (ingredients: ValidRecipe["ingredients"]) =>
  ingredients.map(({ name, quantity, unit }) => ({
    quantity,
    unit,
    ingredient: {
      connectOrCreate: { where: { name }, create: { name } },
    },
  }));

const tagConnects = (tags: ValidRecipe["tags"]) =>
  tags.map((name) => ({ where: { name }, create: { name } }));
```

### `createRecipe`

```ts
import { prisma } from "@/lib/prisma";
import { badInput, unauthenticated } from "../errors";

builder.mutationFields((t) => ({
  createRecipe: t.prismaField({
    type: "Recipe",
    args: {
      input: t.arg({ type: RecipeInput, required: true }),
    },
    resolve: async (query, _parent, args, ctx) => {
      if (!ctx.currentUser) throw unauthenticated();
      const recipe = validateRecipeInput(args.input);

      return prisma.recipe.create({
        ...query,
        data: {
          title: recipe.title,
          description: recipe.description,
          author: { connect: { id: ctx.currentUser.id } },
          steps: { create: stepCreates(recipe.steps) },
          ingredients: { create: ingredientCreates(recipe.ingredients) },
          tags: { connectOrCreate: tagConnects(recipe.tags) },
        },
      });
    },
  }),
}));
```

(`unauthenticated` is added to `errors.ts` in §5.9. In Part 5 `currentUser` is always Sam unless
the database is empty; in Part 7 it becomes real.)

That one `prisma.recipe.create` call inserts the recipe, its steps, its `RecipeIngredient` rows,
any `Ingredient`s and `Tag`s that didn't exist yet, and the tag join rows. **A single nested write
runs in a single transaction** — if the fourth ingredient fails, none of it is saved. You never end
up with half a recipe.

The mutation returns the new `Recipe`, and because it's a `prismaField` with `...query` spread in,
the client can select whatever it wants from the result — including relations — in the same round
trip.

### `updateRecipe`

Replacing a recipe's contents is the same nested write with two twists. Add it inside the same
`builder.mutationFields` call:

```ts
  updateRecipe: t.prismaField({
    type: "Recipe",
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: RecipeInput, required: true }),
    },
    resolve: async (query, _parent, args) => {
      const recipe = validateRecipeInput(args.input);

      try {
        return await prisma.$transaction(async (tx) => {
          const tags = await Promise.all(
            recipe.tags.map((name) =>
              tx.tag.upsert({ where: { name }, create: { name }, update: {} }),
            ),
          );

          return tx.recipe.update({
            ...query,
            where: { id: args.id },
            data: {
              title: recipe.title,
              description: recipe.description,
              steps: { deleteMany: {}, create: stepCreates(recipe.steps) },
              ingredients: { deleteMany: {}, create: ingredientCreates(recipe.ingredients) },
              tags: { set: tags.map((tag) => ({ id: tag.id })) },
            },
          });
        });
      } catch (error) {
        if (isRecordNotFound(error)) throw notFound("Recipe");
        throw error;
      }
    },
  }),
```

- **`deleteMany: {}` then `create`** — "delete every step belonging to this recipe, then create
  the new ones." That's the replace strategy from the input-type section, in one line. The empty
  `{}` is a `where` that matches all of *this recipe's* steps, not all steps in the table — nested
  writes are always scoped to the parent.
- **Tags use `set`**, which replaces a many-to-many's whole membership with the given list. `set`
  only takes existing records, so the tags are upserted first.
- **`prisma.$transaction(async (tx) => …)`** — that makes this *two* statements (upsert tags, then
  update), and a single nested write's atomicity only covers one. An interactive transaction wraps
  both: every query made through `tx` commits together or not at all. Note that the resolver uses
  `tx.recipe.update`, not `prisma.recipe.update` — a query through `prisma` would run outside the
  transaction.
- **The `try`/`catch`** turns "no recipe with that ID" into a clean error the client can act on;
  §5.9 covers it.

> **Anyone can edit anything, for now.** There's no ownership check — any request can update any
> recipe. Part 7 adds "only the author may edit or delete" once there's a real user to check
> against. It's a gap on purpose, not an oversight.

### `deleteRecipe`

```ts
  deleteRecipe: t.field({
    type: "ID",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args) => {
      try {
        await prisma.recipe.delete({ where: { id: args.id } });
        return args.id;
      } catch (error) {
        if (isRecordNotFound(error)) throw notFound("Recipe");
        throw error;
      }
    },
  }),
```

This one is a plain `t.field` returning the deleted recipe's `ID`, not a `prismaField` returning a
`Recipe`. Once the row is gone there's nothing meaningful to select from it — its steps and
ingredients were cascade-deleted along with it (§4.2's `onDelete: Cascade`). The ID is all the
client needs, to remove the recipe from whatever it's displaying.

---

## 5.9 Errors

Every error in this API falls into one of two groups, and they deserve opposite treatment:

- **Expected errors** — the request was understood, but it can't be done: invalid input, a
  recipe that doesn't exist, not logged in. These aren't bugs. The client caused them, the client
  can fix them, and the client should be told exactly what went wrong so the UI can say so.
- **Unexpected errors** — bugs. A typo'd column name, the database being down, a `null` where
  there shouldn't be one. The client can't do anything about these, and the details (stack traces,
  SQL, table names) are the last thing you want to send to a browser.

### How Yoga tells them apart

When a resolver throws, the field resolves to `null` and the error goes into the response's
`errors` array — alongside, not instead of, any `data` that did resolve:

```json
{
  "data": null,
  "errors": [
    {
      "message": "Title is required",
      "path": ["createRecipe"],
      "extensions": { "code": "BAD_USER_INPUT", "field": "title" }
    }
  ]
}
```

Yoga applies **error masking**: if what was thrown is a `GraphQLError`, its message and
`extensions` go to the client as-is. If it's *anything else* — a plain `Error`, a Prisma exception,
a `TypeError` — the client gets only `"Unexpected error."`, and the real error is logged on the
server. In development, Yoga also attaches the original error to the response for convenience;
in production it doesn't.

So the whole strategy is: **expected errors are `GraphQLError`s; everything else is left to
propagate.** Masking handles the rest. You never have to remember to scrub a stack trace.

### `extensions.code`

The `message` is for humans. `extensions` is an open-ended object for machines, and `code` is the
conventional key for "what kind of error is this" — so Part 6's form can check
`code === "BAD_USER_INPUT"` and highlight `extensions.field` rather than parse English. The codes
used in this tutorial:

| Code | Meaning |
|---|---|
| `BAD_USER_INPUT` | The input failed validation. `field` says which input. |
| `NOT_FOUND` | The thing being acted on doesn't exist. |
| `UNAUTHENTICATED` | You need to be logged in. |
| `FORBIDDEN` | You're logged in, but it isn't yours (Part 7). |

### The rest of `errors.ts`

The complete file:

```ts
import { Prisma } from "@prisma/client";
import { GraphQLError } from "graphql";

export function badInput(message: string, field?: string) {
  return new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT", field },
  });
}

export function notFound(what: string) {
  return new GraphQLError(`${what} not found`, {
    extensions: { code: "NOT_FOUND" },
  });
}

export function unauthenticated() {
  return new GraphQLError("You must be logged in", {
    extensions: { code: "UNAUTHENTICATED" },
  });
}

// Prisma throws P2025 when an update or delete matches no row.
export function isRecordNotFound(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}
```

Import `notFound` and `isRecordNotFound` into `recipe-mutations.ts` alongside the others.

`isRecordNotFound` is the one place an unexpected-looking error becomes an expected one. Prisma
throws a `PrismaClientKnownRequestError` with code `P2025` when `update` or `delete` finds nothing
to act on. Left alone, masking would turn that into `"Unexpected error."` — technically safe, but
useless to a client that just needs to know the recipe is gone. The mutations catch *that one
code*, translate it, and re-throw everything else untouched. Catching broadly (`catch { throw
notFound() }`) would be a bug: a database outage would be reported as "Recipe not found."

Note the asymmetry with §5.6: a *query* for a missing recipe returns `null`, but a *mutation* on one
is an error. Reading something that isn't there is a valid answer; changing something that isn't
there is a failed request.

---

## 5.10 Exploring the API

Before any frontend exists, run every operation by hand. This is the habit worth building: when
the UI misbehaves in Part 6, you'll want to know whether the API does the right thing on its own,
and GraphiQL answers that in seconds.

With `npm run dev` running, open <http://localhost:3000/api/graphql> and work through these.

**1. Variables.** Rather than pasting values into the query string, declare them as typed
**variables** and supply them in GraphiQL's *Variables* pane. This is how every query in Part 6 will
be written:

```graphql
query RecipeDetail($id: ID!) {
  recipe(id: $id) {
    title
    author { name }
    steps { order text }
  }
}
```

```json
{ "id": "PASTE-ID-HERE" }
```

`RecipeDetail` is the **operation name** — optional, but it shows up in logs and dev tools, and
Part 6's code generator names types after it.

**2. Create a recipe.**

```graphql
mutation CreateRecipe($input: RecipeInput!) {
  createRecipe(input: $input) {
    id
    title
    author { name }
    steps { order text }
    ingredients { quantity unit ingredient { name } }
    tags { name }
  }
}
```

```json
{
  "input": {
    "title": "Lemon Tart",
    "description": "Sharp, sweet, and worth the effort.",
    "steps": ["Blind-bake the pastry case.", "Whisk the filling.", "Bake until just set."],
    "ingredients": [
      { "name": "Lemon", "quantity": 4, "unit": "PIECE" },
      { "name": "Onion", "quantity": 0.5, "unit": "PIECE" }
    ],
    "tags": ["Baking", "dessert"]
  }
}
```

Check: steps numbered 1–3, tags lowercased, author is Sam. In Prisma Studio, `Lemon` is a new
`Ingredient` but `Onion` isn't — it was connected to the existing row from the seed. (It's a strange
tart. It proves the point.)

**3. Break the validation.** Rerun with each of these, one at a time, and read the `errors`
array — each should be a `BAD_USER_INPUT` with a helpful message:

- `"title": "   "`
- `"steps": []`
- a `quantity` of `-1`
- `"Lemon"` listed twice
- `"unit": "HANDFUL"` — notice this one is rejected by GraphQL itself, before your resolver runs,
  because `HANDFUL` isn't in the `Unit` enum.

**4. Update it.** Using the new recipe's ID, remove the onion and fix the steps:

```graphql
mutation UpdateRecipe($id: ID!, $input: RecipeInput!) {
  updateRecipe(id: $id, input: $input) {
    title
    updatedAt
    steps { order text }
    ingredients { ingredient { name } }
  }
}
```

Send the same input as before minus the onion, with a step added. The steps should be renumbered
from 1, and `updatedAt` should have moved.

**5. Delete it**, then try to delete it again:

```graphql
mutation DeleteRecipe($id: ID!) {
  deleteRecipe(id: $id)
}
```

The first returns the ID. The second returns a `NOT_FOUND` error — not `"Unexpected error."`.

**6. Watch the query count.** Run the big nested query from §5.7 and count the SQL lines logged in
the terminal. Then create two or three more recipes and run it again. The number of queries
shouldn't change.

When you're done, `npx prisma migrate reset` puts the database back to the seed.

---

## Checkpoint — a complete read/write GraphQL API for recipes

Your `graphql/` directory:

```
graphql/
├── builder.ts
├── context.ts
├── errors.ts
├── schema.ts
└── types/
    ├── recipe.ts
    ├── recipe-mutations.ts
    ├── recipe-parts.ts
    └── user.ts
```

Plus `app/api/graphql/route.ts`, and the `generator pothos` block in `prisma/schema.prisma`.

You should be able to:

```bash
# 1. Type-check and lint cleanly — Pothos's type safety only helps if tsc runs
npx tsc --noEmit
npm run lint

# 2. Start the server and open GraphiQL
npm run dev
# → http://localhost:3000/api/graphql
```

And in GraphiQL:

- `recipes` returns the seeded recipe with its author, ordered steps, ingredients with units, tags,
  and `favoriteCount: 1`.
- `recipe(id:)` returns one recipe, or `null` for an unknown ID.
- `createRecipe` creates a full recipe in one call, reusing existing ingredients and tags by name.
- Invalid input comes back as `BAD_USER_INPUT` errors with readable messages.
- `updateRecipe` replaces a recipe's contents; `deleteRecipe` removes it; both report `NOT_FOUND`
  for an unknown ID.
- The Prisma query log shows a fixed number of queries per GraphQL query, regardless of row count.

**What you have now:**

- A code-first GraphQL schema where the database, the TypeScript types, and the API's types all
  come from one place — change a Prisma model and the compiler tells you which GraphQL fields care.
- Queries that load exactly the relations a client asks for, in a constant number of SQL queries.
- Mutations that validate their input and write whole recipes atomically.
- An error strategy where expected failures are informative and unexpected ones are safe.

**Known gaps, on purpose:** there's no login — every request is Sam (Part 7). Anyone can edit or
delete any recipe (Part 7). `recipes` returns every recipe, unfiltered and unpaginated (Part 8).

Commit and tag:

```bash
git add -A
git commit -m "Part 5 — GraphQL layer: Pothos schema, Yoga route, recipe queries and mutations"
git tag part-05-complete
```

---

## What's next

Part 6 connects a frontend to this API: urql as the client, GraphQL Code Generator to turn the
query strings in your components into fully typed documents, and the recipe list, detail, and
create pages — built on the exact queries and mutations you just ran by hand.
