# Part 1 — TypeScript from the ground up

This Part teaches TypeScript from scratch, but with a bias: the goal is to get you productive in
*this* codebase, not to tour every feature of the language. By the end you'll be able to read the
types that Prisma, Pothos, and urql generate, and write your own with confidence.

Every example uses the recipe domain from Part 0, so the concepts land where you'll actually use
them.

> **Follow along.** You don't need the project scaffolded yet. Create a scratch folder and use the
> TypeScript Playground (<https://www.typescriptlang.org/play>) or a local setup:
>
> ```bash
> mkdir ts-practice && cd ts-practice
> npm init -y
> npm install -D typescript tsx
> npx tsc --init
> ```
>
> Put code in `scratch.ts` and run it with `npx tsx scratch.ts`.

---

## 1.1 What TypeScript is and how it runs

TypeScript is JavaScript plus a **type layer**. You write annotations describing the shape of your
data; a type checker verifies your code is consistent with them; then the annotations are
**erased** and what runs is plain JavaScript.

```ts
// This is TypeScript
function greet(name: string): string {
  return `Hello, ${name}`;
}
```

```js
// This is what actually runs after compilation — the types are gone
function greet(name) {
  return `Hello, ${name}`;
}
```

Three consequences of "types are erased":

1. **Types never affect runtime behavior.** A TypeScript type can't validate user input, guard
   against a malformed API response, or exist as a value you inspect at runtime. If you need
   runtime checks, you write runtime code (we use `zod` for that in Part 8).
2. **Type errors don't stop your code from running.** `tsc` will *report* errors, but with the
   default dev setup the JavaScript still executes. The errors are a signal, not a gate — though
   in CI you'd make them a gate.
3. **The type checker is a separate step from execution.** Your editor runs it continuously (the
   red squiggles). `tsc --noEmit` runs it in CI. Tools like `tsx`, Next.js, and Vite strip types
   and run the result *without* type-checking, for speed.

### The two things TypeScript does for you

- **Catches mistakes as you type.** Misspelled property, wrong argument order, forgetting that a
  value might be `null` — you see it immediately, in the editor, on the exact line.
- **Powers autocomplete.** Because the editor knows a variable is a `Recipe`, it can offer you
  `.title`, `.author`, `.steps` and nothing else. In a large codebase this is the feature you'll
  miss most if you go back to plain JS.

### `tsconfig.json`

`npx tsc --init` creates this file. It controls how strict the checker is and what JavaScript
version to target. We'll go through the settings that matter in Part 3 (§3.3). For now, the one
thing to know: **`"strict": true` should always be on.** Every example in this tutorial assumes it.

---

## 1.2 The basic types

### Primitives

```ts
let title: string = "Weeknight Chili";
let servings: number = 4;
let isPublished: boolean = true;
```

### Inference — usually you don't annotate

TypeScript figures out the type from the value. This is idiomatic; don't annotate when you don't
need to.

```ts
let title = "Weeknight Chili"; // inferred as string
let servings = 4;              // inferred as number

title = 42; // ✖ Type 'number' is not assignable to type 'string'
```

**When to annotate:**

- Function parameters — inference can't see the call sites, so you almost always annotate these.
- When you declare a variable without initializing it.
- When you want a *wider* or *narrower* type than what's inferred (more on this in §1.5).
- Function return types when you want the compiler to verify what you return (optional but often
  worth it).

### Arrays

```ts
let tags: string[] = ["dinner", "quick"];
let ratings: number[] = [5, 4, 5, 3];

// Alternative syntax, identical meaning:
let tags2: Array<string> = ["dinner", "quick"];
```

### `null` and `undefined`

With `strict` on, these are their own types and are **not** assignable to other types unless you
opt in.

```ts
let author: string = null; // ✖ Type 'null' is not assignable to type 'string'

let author2: string | null = null; // ✔ explicitly allowed (a union — §1.5)
```

This is the single most valuable thing strict mode does: it forces you to acknowledge every place
a value might be missing. "Cannot read properties of undefined" becomes a compile error instead of
a production incident.

### `any` — the escape hatch (avoid it)

```ts
let whatever: any = "hello";
whatever = 42;          // fine
whatever.foo.bar.baz;   // fine — no checking at all
whatever();             // fine — until it explodes at runtime
```

`any` turns off type checking for that value and everything derived from it. It's occasionally
necessary, but every `any` is a hole in your safety net. §1.3 covers what to use instead.

---

## 1.3 `any`, `unknown`, and `never`

### `unknown` — the safe `any`

`unknown` means "I don't know the type yet." Unlike `any`, you can't *do* anything with an
`unknown` value until you've proven what it is.

```ts
function parseRecipe(json: string) {
  const data: unknown = JSON.parse(json); // JSON.parse returns any; we narrow it to unknown

  data.title; // ✖ 'data' is of type 'unknown'

  if (typeof data === "object" && data !== null && "title" in data) {
    // inside here, TypeScript knows a bit more about data
    console.log((data as { title: string }).title);
  }
}
```

Use `unknown` for anything coming from outside your program — `JSON.parse`, `fetch` responses,
`catch` clauses — then narrow it (§1.5) or validate it with `zod`.

```ts
try {
  await publishRecipe();
} catch (err) {
  // err is 'unknown' — you must check before using it
  if (err instanceof Error) {
    console.error(err.message);
  }
}
```

### `never` — the type with no values

`never` is the type of something that can never happen. You'll see it in two places:

```ts
// 1. A function that never returns normally
function fail(message: string): never {
  throw new Error(message);
}

// 2. The "impossible" branch of an exhaustive check (very useful — see §1.5)
```

You rarely write `never` yourself, but recognizing it helps you read compiler errors.

---

## 1.4 Object shapes

Most of your types describe the shape of an object. There are two syntaxes.

### `type` alias

```ts
type Recipe = {
  id: string;
  title: string;
  description: string;
  servings: number;
  isPublished: boolean;
};

const chili: Recipe = {
  id: "rec_1",
  title: "Weeknight Chili",
  description: "A fast, one-pot chili.",
  servings: 4,
  isPublished: true,
};
```

### `interface`

```ts
interface Recipe {
  id: string;
  title: string;
  description: string;
  servings: number;
  isPublished: boolean;
}
```

### `type` vs `interface` — which to use

For plain object shapes they're nearly interchangeable. The practical differences:

| | `type` | `interface` |
|---|---|---|
| Object shapes | ✔ | ✔ |
| Unions, tuples, primitives (`type Id = string`) | ✔ | ✖ |
| Can be "reopened" and added to elsewhere | ✖ | ✔ (declaration merging) |
| Error messages | sometimes shows the expanded shape | usually shows the name |

**This tutorial's convention:** use `type` everywhere by default. Reach for `interface` only when
you specifically want declaration merging (rare in app code; common in library typings). This is a
common choice in modern codebases — consistency matters more than the tiny differences.

### Optional and readonly properties

```ts
type Recipe = {
  id: string;
  title: string;
  description?: string;      // optional — string | undefined
  readonly createdAt: Date;  // can't be reassigned after creation
};

const r: Recipe = { id: "rec_1", title: "Chili", createdAt: new Date() };
r.description; // string | undefined
r.createdAt = new Date(); // ✖ Cannot assign to 'createdAt' because it is read-only
```

### Nested shapes

```ts
type Ingredient = {
  name: string;
  quantity: number | null;
  unit: string | null;
};

type Step = {
  order: number;
  instruction: string;
};

type RecipeWithDetails = {
  id: string;
  title: string;
  author: {
    id: string;
    name: string;
  };
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
};
```

This is roughly the shape a GraphQL query will return. By Part 6, Code Generator writes types like
this *for you* from your queries — but you need to be able to read them.

### Index signatures

For objects used as dictionaries, where you don't know the keys ahead of time:

```ts
type RatingsByRecipeId = {
  [recipeId: string]: number;
};

const ratings: RatingsByRecipeId = {
  rec_1: 4.5,
  rec_2: 3.8,
};

ratings.rec_99; // typed as number (TypeScript can't know it's actually missing — see §1.10)
```

---

## 1.5 Unions, literal types, and narrowing

### Union types

A union (`|`) means "one of these types."

```ts
type Id = string | number;

let value: string | null;
value = "hello"; // ok
value = null;    // ok
value = 42;      // ✖
```

### Literal types

A type can be a *specific value*, not just a category:

```ts
type Unit = "g" | "kg" | "ml" | "l" | "tsp" | "tbsp" | "cup" | "piece";

let unit: Unit = "tbsp"; // ok
let unit2: Unit = "spoonful"; // ✖ not one of the allowed literals
```

This is how you model a fixed set of options — far safer than a bare `string`. GraphQL enums and
Prisma enums both surface in TypeScript as literal unions like this.

### Narrowing

When you have a union, TypeScript won't let you use it as one specific member until you've *proven*
which one it is. Proving it is called **narrowing**, and you do it with ordinary JavaScript
checks.

```ts
function describeQuantity(quantity: number | null): string {
  if (quantity === null) {
    return "to taste";
  }
  // TypeScript now knows quantity is 'number' here
  return `${quantity} units`;
}
```

Narrowing tools:

```ts
// typeof — for primitives
if (typeof x === "string") { /* x is string */ }

// === / !== against a literal or null
if (x === null) { /* ... */ }
if (status !== "draft") { /* ... */ }

// 'in' — does the object have this property?
if ("author" in recipe) { /* ... */ }

// instanceof — for classes
if (err instanceof Error) { /* err is Error */ }

// truthiness — careful: 0 and "" are falsy
if (description) { /* description is string, not undefined — but also not "" */ }
```

### Discriminated unions

The most useful pattern in the language. Give each member of a union a common "tag" property with
a distinct literal type, and TypeScript can narrow the *whole object* by checking that one field.

```ts
type LoadingState = { status: "loading" };
type ErrorState = { status: "error"; message: string };
type SuccessState = { status: "success"; recipes: Recipe[] };

type FetchState = LoadingState | ErrorState | SuccessState;

function render(state: FetchState): string {
  switch (state.status) {
    case "loading":
      return "Loading…";
    case "error":
      return `Error: ${state.message}`; // 'message' is available — narrowed to ErrorState
    case "success":
      return `${state.recipes.length} recipes`; // 'recipes' is available
  }
}
```

You'll see this exact shape when you use urql's `useQuery` — it returns `{ fetching, error, data }`
and you narrow on which is set.

### Exhaustiveness checking with `never`

Add a `default` branch that assigns to `never`. If someone later adds a fourth state to the union
and forgets to handle it, this line becomes a compile error.

```ts
function render(state: FetchState): string {
  switch (state.status) {
    case "loading": return "Loading…";
    case "error":   return `Error: ${state.message}`;
    case "success": return `${state.recipes.length} recipes`;
    default: {
      const _exhaustive: never = state; // ✖ if a case is unhandled
      return _exhaustive;
    }
  }
}
```

---

## 1.6 Functions

### Parameter and return types

```ts
function totalTime(prep: number, cook: number): number {
  return prep + cook;
}

// Arrow function form
const totalTime2 = (prep: number, cook: number): number => prep + cook;
```

Annotate parameters (inference can't help there). Return types are optional — inference is usually
right — but annotating them means the compiler checks that your function body actually returns what
you claim. Worth it for anything non-trivial.

### Optional and default parameters

```ts
function formatIngredient(name: string, quantity?: number, unit = "piece"): string {
  //                                    ^ optional        ^ default (type inferred as string)
  if (quantity === undefined) return name;
  return `${quantity} ${unit} ${name}`;
}

formatIngredient("salt");                 // "salt"
formatIngredient("flour", 200, "g");      // "200 g flour"
formatIngredient("egg", 2);               // "2 piece egg"
```

Optional parameters must come after required ones.

### Rest parameters

```ts
function combineTags(...tags: string[]): string[] {
  return [...new Set(tags)];
}

combineTags("dinner", "quick", "dinner"); // ["dinner", "quick"]
```

### Typing a function itself (callbacks)

When a function takes another function as an argument:

```ts
type RecipePredicate = (recipe: Recipe) => boolean;

function filterRecipes(recipes: Recipe[], predicate: RecipePredicate): Recipe[] {
  return recipes.filter(predicate);
}

filterRecipes(all, (r) => r.isPublished); // 'r' is inferred as Recipe — no annotation needed
```

Notice you don't annotate `r` at the call site. TypeScript propagates the parameter type *into*
the callback. This "contextual typing" is everywhere in React (event handlers) and in the GraphQL
libraries.

### `void`

A function that doesn't return a useful value:

```ts
function logRecipe(recipe: Recipe): void {
  console.log(recipe.title);
}
```

---

## 1.7 Generics

Generics are the feature that makes Prisma, Pothos, and urql work. If §1.7 is the only section you
study carefully, that's the right choice.

### The problem generics solve

Say you want a function that returns the first element of an array. Without generics:

```ts
function first(arr: any[]): any {
  return arr[0];
}

const r = first(recipes); // typed as 'any' — we've lost all type information
r.titlee; // no error, even though it's a typo
```

With a generic, the function *remembers* what type of array it was given:

```ts
function first<T>(arr: T[]): T {
  return arr[0];
}

const r = first(recipes); // typed as Recipe
const t = first(tags);    // typed as string
r.titlee; // ✖ Property 'titlee' does not exist on type 'Recipe'
```

`<T>` declares a **type parameter** — a placeholder for a type that gets filled in when the
function is called. `T` is a convention; you could call it `<Item>`. TypeScript infers it from the
argument, so you rarely pass it explicitly.

### Generic types

Types can take type parameters too:

```ts
type ApiResponse<TData> = {
  data: TData;
  errors: string[];
  requestId: string;
};

type RecipeResponse = ApiResponse<Recipe>;
// = { data: Recipe; errors: string[]; requestId: string }

type RecipeListResponse = ApiResponse<Recipe[]>;
// = { data: Recipe[]; errors: string[]; requestId: string }
```

You've already used generic types: `Array<string>` is one. So is `Promise<Recipe>` — a promise
that resolves to a `Recipe`.

```ts
async function fetchRecipe(id: string): Promise<Recipe> {
  const res = await fetch(`/api/recipes/${id}`);
  return res.json(); // (in real code you'd validate this)
}
```

### Constraints with `extends`

Sometimes a generic function needs to *know something* about `T`. `T extends SomeType` means "T
can be anything, as long as it's assignable to `SomeType`."

```ts
// T must at least have an 'id' string property
function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) {
    out[item.id] = item; // ok — we know 'item.id' exists and is a string
  }
  return out;
}

const byId = indexById(recipes); // Record<string, Recipe>
indexById([1, 2, 3]); // ✖ number doesn't have an 'id' property
```

### Why this matters for the stack

When you write:

```ts
const recipe = await prisma.recipe.findUnique({
  where: { id },
  include: { author: true, steps: true },
});
```

Prisma uses generics to make the **return type depend on the `include` you passed**. Ask for
`steps`, and `recipe.steps` is typed. Don't ask for it, and accessing `recipe.steps` is a compile
error. There's no `any` anywhere. That's generics doing the work.

---

## 1.8 The utility types you'll actually use

TypeScript ships helper types that transform other types. These come up constantly in real code.
All examples use:

```ts
type Recipe = {
  id: string;
  title: string;
  description: string;
  servings: number;
  authorId: string;
};
```

### `Partial<T>` — make every property optional

```ts
type RecipeUpdate = Partial<Recipe>;
// { id?: string; title?: string; description?: string; servings?: number; authorId?: string }

function updateRecipe(id: string, changes: Partial<Recipe>) { /* ... */ }
updateRecipe("rec_1", { title: "New Title" }); // ok — only the fields you're changing
```

### `Required<T>` — the opposite; make every property required

```ts
type FullyPopulated = Required<RecipeUpdate>;
```

### `Pick<T, Keys>` — keep only some properties

```ts
type RecipeCard = Pick<Recipe, "id" | "title">;
// { id: string; title: string }
```

### `Omit<T, Keys>` — drop some properties

```ts
type RecipeInput = Omit<Recipe, "id" | "authorId">;
// { title: string; description: string; servings: number }
// exactly what a "create recipe" form needs — the server assigns id and authorId
```

### `Record<Keys, ValueType>` — build a dictionary type

```ts
type RecipesById = Record<string, Recipe>;         // { [key: string]: Recipe }
type CountByTag = Record<"dinner" | "vegan", number>; // { dinner: number; vegan: number }
```

### `ReturnType<T>` and `Awaited<T>` — extract types from functions

```ts
function makeRecipe() {
  return { id: "rec_1", title: "Chili" };
}
type MadeRecipe = ReturnType<typeof makeRecipe>; // { id: string; title: string }

async function loadRecipe() {
  return { id: "rec_1", title: "Chili" };
}
type LoadedRecipe = Awaited<ReturnType<typeof loadRecipe>>; // unwraps the Promise
```

`Awaited<ReturnType<typeof someFunction>>` is a genuinely common pattern for deriving a type from
a function instead of writing it twice.

### `keyof` — the union of an object type's keys

```ts
type RecipeKey = keyof Recipe; // "id" | "title" | "description" | "servings" | "authorId"

function getField<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key]; // T[K] is "indexed access" — the type of that specific property
}

const t = getField(chili, "title");    // string
const s = getField(chili, "servings"); // number
getField(chili, "nope");               // ✖ not a key of Recipe
```

`keyof` + generics + indexed access (`T[K]`) is the toolkit behind type-safe field selection —
you'll recognize it in Prisma's `select` and Pothos's field builders.

---

## 1.9 Using types from other packages

### Types that come with a package

Most modern packages ship their own type definitions. `npm install @urql/core` and the types are
just there — your editor picks them up automatically. No extra step.

### `@types/*` packages

Older packages (or ones written in plain JS) don't include types. The community maintains them
separately under the `@types` scope:

```bash
npm install express
npm install -D @types/express   # the types, as a dev dependency
```

If you import a package and TypeScript says *"Could not find a declaration file for module
'foo'"*, the fix is almost always `npm install -D @types/foo`. If no `@types/foo` exists, the
package is untyped and imports come in as `any`.

### Reading a library's types to learn its API

This is a skill worth practicing. When you `import { createClient } from "@urql/core"`,
**Cmd/Ctrl-click** `createClient` in VS Code and it jumps to the `.d.ts` file — the type
declarations. You'll see something like:

```ts
export declare function createClient(args: ClientOptions): Client;

export interface ClientOptions {
  url: string;
  exchanges?: Exchange[];
  fetchOptions?: RequestInit | (() => RequestInit);
  // ...
}
```

That tells you exactly what `createClient` expects, without leaving your editor or opening a
browser. For libraries with good types (all the ones in this stack), this is often faster than the
docs.

### `.d.ts` files

A `.d.ts` file contains **only type declarations, no implementation** — `declare` statements that
describe the shape of JavaScript that exists elsewhere. You'll mostly consume them. Occasionally
you'll write a tiny one, e.g. to tell TypeScript about an environment variable or a non-code
import. We'll do that once, in Part 6, for the GraphQL Codegen output.

---

## 1.10 Living with strict mode

`"strict": true` is a bundle of settings. The ones you'll feel day to day:

### `strictNullChecks` — `null` and `undefined` must be handled

Covered in §1.2. The pattern you'll repeat hundreds of times:

```ts
const recipe = recipes.find((r) => r.id === targetId);
// recipe: Recipe | undefined  — .find might not find anything

recipe.title; // ✖ 'recipe' is possibly 'undefined'

if (!recipe) {
  throw new Error(`Recipe ${targetId} not found`);
}
recipe.title; // ✔ narrowed to Recipe
```

### The non-null assertion `!` — use sparingly

`value!` tells the compiler "trust me, this isn't null/undefined here." It does **no runtime
check** — if you're wrong, you get the exact crash strict mode was trying to prevent.

```ts
const recipe = recipes.find((r) => r.id === targetId)!; // "I know it's there"
recipe.title; // no error — but a lie if the recipe is missing
```

Prefer an explicit check that throws a *useful* error. Reserve `!` for cases where you genuinely
can't restructure and you're certain (e.g. `document.getElementById("root")!` in a file that only
runs after the DOM is ready).

### `noUncheckedIndexedAccess` (we turn this on in Part 3)

Not part of `strict` by default, but we enable it. It makes array/dictionary access return
`T | undefined`, because indexing can miss:

```ts
const first = recipes[0]; // Recipe | undefined  (with the flag)
                          // Recipe               (without it — a lie if the array is empty)
```

It's mildly annoying and completely correct. Better a check now than `undefined is not an object`
later.

### Type guards — narrowing you can name and reuse

A function returning `param is Type` is a **type predicate**. It lets you package a narrowing
check:

```ts
function isPublishedRecipe(recipe: Recipe): recipe is Recipe & { publishedAt: Date } {
  return recipe.publishedAt !== null;
}

const published = recipes.filter(isPublishedRecipe);
// published: (Recipe & { publishedAt: Date })[]  — publishedAt is now non-null
```

### Narrowing, not casting

`value as SomeType` (a **type assertion**) overrides the compiler. Like `!` and `any`, it's a
promise you're making with no verification. Sometimes unavoidable at the boundary with untyped
data, but if you find yourself casting inside your own well-typed code, it usually means a type
somewhere upstream is wrong. Fix the source.

```ts
// ✖ casting to silence an error
const recipe = data as Recipe;

// ✔ narrowing, or validating with zod (Part 8)
if (isRecipe(data)) { /* data is Recipe, proven */ }
```

---

## Checkpoint — exercises

Work these in your scratch file with `"strict": true`. Solutions follow.

### Exercise 1 — model the domain

Write types for the recipe domain:

- `Unit` — a literal union of `"g" | "ml" | "tsp" | "tbsp" | "cup" | "piece"`.
- `Ingredient` — `name: string`, `quantity: number | null`, `unit: Unit | null`.
- `Step` — `order: number`, `instruction: string`.
- `Recipe` — `id: string`, `title: string`, `description` (optional), `ingredients: Ingredient[]`,
  `steps: Step[]`, `tags: string[]`, `authorId: string`.

### Exercise 2 — a create-input type

Using `Omit` (and `Partial` where appropriate), derive `NewRecipeInput` from `Recipe`: the same
shape but without `id` (the server assigns it) and without `authorId` (taken from the session).

### Exercise 3 — a generic helper

Write `groupBy<T, K extends string>(items: T[], getKey: (item: T) => K): Record<K, T[]>`. Then use
it to group a `Recipe[]` by their first tag.

### Exercise 4 — narrow a union

Given:

```ts
type QueryResult<T> =
  | { state: "loading" }
  | { state: "error"; error: Error }
  | { state: "ready"; data: T };
```

Write `unwrap<T>(result: QueryResult<T>): T` that returns the data when ready, and throws
otherwise. Add an exhaustiveness check.

### Exercise 5 — fix the errors

```ts
type User = { id: string; name: string; email?: string };

function sendWelcome(user: User) {
  const domain = user.email.split("@")[1].toUpperCase();
  return `Welcome ${user.name} (${domain})`;
}

const users = [{ id: "u1", name: "Sam" }];
const target = users.find((u) => u.id === "u2");
sendWelcome(target);
```

There are three problems. Find and fix them.

---

<details>
<summary><strong>Solutions</strong></summary>

### Exercise 1

```ts
type Unit = "g" | "ml" | "tsp" | "tbsp" | "cup" | "piece";

type Ingredient = {
  name: string;
  quantity: number | null;
  unit: Unit | null;
};

type Step = {
  order: number;
  instruction: string;
};

type Recipe = {
  id: string;
  title: string;
  description?: string;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
  authorId: string;
};
```

### Exercise 2

```ts
type NewRecipeInput = Omit<Recipe, "id" | "authorId">;
// { title: string; description?: string; ingredients: Ingredient[];
//   steps: Step[]; tags: string[] }
```

If you also wanted, say, `tags` to be optional on input:

```ts
type NewRecipeInput = Omit<Recipe, "id" | "authorId" | "tags"> & { tags?: string[] };
```

### Exercise 3

```ts
function groupBy<T, K extends string>(
  items: T[],
  getKey: (item: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const key = getKey(item);
    (out[key] ??= []).push(item);
  }
  return out;
}

const byFirstTag = groupBy(recipes, (r) => r.tags[0] ?? "untagged");
```

(The `{} as Record<K, T[]>` is one of those boundary casts that's hard to avoid when building a
record incrementally — the value is genuinely incomplete until the loop finishes.)

### Exercise 4

```ts
function unwrap<T>(result: QueryResult<T>): T {
  switch (result.state) {
    case "ready":
      return result.data;
    case "loading":
      throw new Error("Query still loading");
    case "error":
      throw result.error;
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
```

### Exercise 5

```ts
type User = { id: string; name: string; email?: string };

function sendWelcome(user: User) {
  // Problem 1: user.email is string | undefined — guard it.
  // Problem 2: .split("@")[1] is string | undefined under noUncheckedIndexedAccess — guard it.
  if (!user.email) {
    return `Welcome ${user.name}`;
  }
  const domain = user.email.split("@")[1]?.toUpperCase();
  return `Welcome ${user.name}${domain ? ` (${domain})` : ""}`;
}

const users: User[] = [{ id: "u1", name: "Sam" }];
const target = users.find((u) => u.id === "u2");

// Problem 3: target is User | undefined — .find might return nothing.
if (target) {
  sendWelcome(target);
}
```

</details>

---

## What's next

**Part 2 — A React refresher.** A fast pass over components, props, hooks, context, and forms —
re-grounded with the TypeScript you just learned — plus the one genuinely new thing: how the
Next.js App Router splits your components into Server and Client Components.
