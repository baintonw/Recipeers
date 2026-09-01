# Part 2 — A React refresher

You already know React. This Part is a fast pass to re-ground it with the TypeScript from Part 1
and bring it up to date with current React (function components, hooks, no legacy class stuff) and
the Next.js App Router. The one genuinely new idea is at the end: **Server vs. Client Components**.

If you write React with TypeScript every day, skim to §2.6 and move on.

> **Follow along.** The examples run in any React 18+/19 setup. You still don't need the tutorial
> project scaffolded — a fresh `npm create vite@latest -- --template react-ts` works, or just read.
> By Part 3 we start building the real thing.

---

## 2.1 Components and props

A component is a function that takes a **props** object and returns JSX.

```tsx
type RecipeCardProps = {
  title: string;
  authorName: string;
  favoriteCount: number;
};

function RecipeCard({ title, authorName, favoriteCount }: RecipeCardProps) {
  return (
    <article className="recipe-card">
      <h3>{title}</h3>
      <p>by {authorName} · ♥ {favoriteCount}</p>
    </article>
  );
}
```

Notes for the TypeScript-fluent:

- **Type the props object, destructure in the signature.** `({ title, authorName }: RecipeCardProps)`
  is the standard form.
- **Don't use `React.FC`.** It used to be common; it's now discouraged (it complicates generics and
  historically forced an implicit `children`). A plain function with a typed parameter is the
  current recommendation.
- The return type is inferred. You don't annotate it.

### `children` and other special props

`children` is whatever you put between the component's tags. Type it with `React.ReactNode`.

```tsx
type PanelProps = {
  heading: string;
  children: React.ReactNode;
};

function Panel({ heading, children }: PanelProps) {
  return (
    <section>
      <h2>{heading}</h2>
      {children}
    </section>
  );
}

// usage
<Panel heading="Ingredients">
  <ul>{/* ... */}</ul>
</Panel>
```

### Optional props and defaults

```tsx
type BadgeProps = {
  label: string;
  tone?: "neutral" | "success" | "warning"; // optional literal union
};

function Badge({ label, tone = "neutral" }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}
```

### Composition over configuration

If a component is sprouting boolean props (`isEditable`, `showActions`, `compact`), that's usually
a sign to split it or pass elements as props instead. Keep components small; compose them.

---

## 2.2 State and effects

### `useState`

```tsx
function FavoriteButton({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount); // inferred: number
  const [isFavorited, setIsFavorited] = useState(false); // inferred: boolean

  function toggle() {
    setIsFavorited((prev) => !prev);
    setCount((prev) => (isFavorited ? prev - 1 : prev + 1));
  }

  return (
    <button onClick={toggle} aria-pressed={isFavorited}>
      ♥ {count}
    </button>
  );
}
```

- **Inference handles most cases.** `useState(0)` is `number`, `useState("")` is `string`.
- **Annotate when the initial value doesn't tell the whole story** — usually a value that starts
  `null` or a union:

  ```tsx
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  ```

- **Use the updater form** (`setCount(prev => ...)`) whenever the next value depends on the
  previous one. It avoids stale-closure bugs.

### `useEffect`

An effect runs *after* render, for things outside React's world: subscriptions, timers, manual DOM
work, and — historically — data fetching (see §2.5 for why we move away from that).

```tsx
function RecipeTitle({ recipeId }: { recipeId: string }) {
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/recipes/${recipeId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setTitle(data.title);
      });

    return () => {
      cancelled = true; // cleanup — runs before the next effect and on unmount
    };
  }, [recipeId]); // dependency array — re-run when recipeId changes

  return <h1>{title ?? "Loading…"}</h1>;
}
```

The three rules that cause 90% of effect bugs:

1. **Every value from component scope that the effect uses must be in the dependency array.** The
   ESLint rule `react-hooks/exhaustive-deps` enforces this — don't silence it without a reason.
2. **Return a cleanup function** for anything that needs tearing down (subscriptions, timers) or
   that could resolve after the component moved on (the `cancelled` flag above).
3. **An empty array `[]` means "run once after mount."** No array means "run after every render"
   (rarely what you want).

### Rules of hooks

- Only call hooks at the **top level** of a component or another hook — never inside a condition,
  loop, or nested function.
- Only call hooks from **React functions** — components or custom hooks (named `useSomething`).

The ESLint plugin `eslint-plugin-react-hooks` catches violations. Part 3 sets it up.

### Deriving, not storing

If a value can be computed from props or existing state, compute it during render — don't put it
in `useState` and sync it with an effect.

```tsx
// ✖ redundant state + effect
const [fullName, setFullName] = useState("");
useEffect(() => setFullName(`${first} ${last}`), [first, last]);

// ✔ just derive it
const fullName = `${first} ${last}`;
```

---

## 2.3 Context and reducers

### `useContext` — app-wide values without prop drilling

We'll use context for the current user (the auth state) in Part 7. The shape:

```tsx
type AuthUser = { id: string; name: string; email: string };

type AuthContextValue = {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const value: AuthContextValue = {
    user,
    login: async (email, password) => {
      /* call the login mutation, then setUser(...) */
    },
    logout: async () => {
      /* call the logout mutation, then setUser(null) */
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

### Wrap the raw context in a custom hook

This is the pattern to internalize. It gives you a friendlier API *and* removes the `| null` at
every call site:

```tsx
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx; // narrowed — no null
}
```

Now components just do `const { user } = useAuth();`.

### `useReducer` — when state transitions get complicated

For a handful of independent values, multiple `useState` calls are fine. When updates are
interrelated — like a recipe form with a dynamic list of ingredients and steps — a reducer keeps
the logic in one place and makes each transition explicit.

```tsx
type Ingredient = { name: string; quantity: number | null; unit: string | null };

type FormState = {
  title: string;
  ingredients: Ingredient[];
};

type FormAction =
  | { type: "setTitle"; value: string }
  | { type: "addIngredient" }
  | { type: "updateIngredient"; index: number; patch: Partial<Ingredient> }
  | { type: "removeIngredient"; index: number };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "setTitle":
      return { ...state, title: action.value };
    case "addIngredient":
      return {
        ...state,
        ingredients: [...state.ingredients, { name: "", quantity: null, unit: null }],
      };
    case "updateIngredient":
      return {
        ...state,
        ingredients: state.ingredients.map((ing, i) =>
          i === action.index ? { ...ing, ...action.patch } : ing,
        ),
      };
    case "removeIngredient":
      return {
        ...state,
        ingredients: state.ingredients.filter((_, i) => i !== action.index),
      };
  }
}

// in the component:
const [state, dispatch] = useReducer(formReducer, { title: "", ingredients: [] });
dispatch({ type: "addIngredient" });
```

That `FormAction` discriminated union (from §1.5) is what makes `dispatch` type-safe — the wrong
payload for an action type is a compile error.

---

## 2.4 Lists, keys, and forms

### Rendering lists

```tsx
function IngredientList({ ingredients }: { ingredients: Ingredient[] }) {
  return (
    <ul>
      {ingredients.map((ing) => (
        <li key={ing.id}>
          {ing.quantity} {ing.unit} {ing.name}
        </li>
      ))}
    </ul>
  );
}
```

- **`key` must be a stable, unique identifier** — a database `id`, not the array index. Index keys
  cause subtle bugs when the list reorders or items are inserted/removed.
- `ing` is inferred as `Ingredient` inside `.map` — no annotation needed (contextual typing from
  §1.6).

### Controlled inputs

The React value is the source of truth; the input reflects it.

```tsx
function TitleField() {
  const [title, setTitle] = useState("");

  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder="Recipe title"
    />
  );
}
```

### Typing events

Let contextual typing do the work — inside a JSX `onChange`/`onClick`/`onSubmit`, the event
parameter is already typed. You only write the type explicitly when you extract the handler:

```tsx
function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  // ...
}

function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
  console.log(e.target.value);
}

<form onSubmit={handleSubmit}>
  <input onChange={handleChange} />
</form>
```

Common event types: `React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>`,
`React.FormEvent<HTMLFormElement>`, `React.MouseEvent<HTMLButtonElement>`,
`React.KeyboardEvent<HTMLInputElement>`.

### Forms

For the tutorial's forms we'll keep it simple: controlled inputs (or `useReducer` for the complex
recipe form), plus `zod` for validation (Part 8), submitting via a GraphQL mutation (Part 6). We
won't pull in a form library — the point is to see the data flow plainly.

---

## 2.5 Data fetching in plain React

Here's the recipe list, fetched the manual way — `useEffect` + `fetch` + hand-rolled state:

```tsx
type Recipe = { id: string; title: string; authorName: string };

function RecipeList() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    fetch("/api/recipes")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Recipe[]) => {
        if (!cancelled) setRecipes(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error("Unknown error"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Something went wrong: {error.message}</p>;
  if (recipes.length === 0) return <p>No recipes yet.</p>;

  return (
    <ul>
      {recipes.map((r) => (
        <li key={r.id}>{r.title} — {r.authorName}</li>
      ))}
    </ul>
  );
}
```

That's ~35 lines for one list, and it still doesn't handle:

- **Caching** — navigate away and back, it refetches from scratch.
- **Deduplication** — two components asking for the same data make two requests.
- **Refetching after a mutation** — favorite a recipe, and the count on the list is now stale.
- **Race conditions beyond the simple `cancelled` flag** — rapid param changes.
- **The response type is a lie** — `data: Recipe[]` is an assertion; nothing checks the server
  actually sent that shape.

Every GraphQL client — urql, which we use — exists to handle all of this. In Part 6 the component
above becomes:

```tsx
function RecipeList() {
  const [{ data, fetching, error }] = useQuery({ query: RecipesDocument });

  if (fetching) return <p>Loading…</p>;
  if (error) return <p>Something went wrong: {error.message}</p>;
  if (!data || data.recipes.length === 0) return <p>No recipes yet.</p>;

  return (
    <ul>
      {data.recipes.map((r) => (
        <li key={r.id}>{r.title} — {r.author.name}</li>
      ))}
    </ul>
  );
}
```

`data` is **fully typed from the query** (via Code Generator), caching and dedup are automatic, and
a mutation elsewhere can tell urql to refresh this. Keep the manual version in mind — it's what the
client is doing for you.

---

## 2.6 Server vs. Client Components

This is the part that's genuinely different from "React you already know." The Next.js App Router
splits components into two kinds.

### Server Components (the default)

Every component under `app/` is a **Server Component** unless it says otherwise. It runs **only on
the server** — during the request, before HTML is sent — and never ships to the browser.

```tsx
// app/recipes/[id]/page.tsx  — a Server Component
import { prisma } from "@/lib/prisma";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipe = await prisma.recipe.findUnique({ where: { id } });

  if (!recipe) return <p>Not found.</p>;

  return <h1>{recipe.title}</h1>;
}
```

What's new and what it enables:

- **The component is `async`.** You can `await` directly in the body.
- **It can touch server-only resources** — the database, the filesystem, secrets — because this
  code never reaches the client.
- **No `useState`, `useEffect`, or event handlers.** There's no interactivity; it renders once, on
  the server.
- **Its code and its imports stay out of the JS bundle.** Big libraries used only for rendering
  cost the user nothing.

### Client Components (opt in with `"use client"`)

Put `"use client"` at the top of a file and that component (and the ones it imports) runs in the
browser too — it hydrates and becomes interactive. This is "React you already know."

```tsx
"use client";

import { useState } from "react";

export function FavoriteButton({ recipeId, initialCount }: {
  recipeId: string;
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);
  return <button onClick={() => setCount((c) => c + 1)}>♥ {count}</button>;
}
```

You need `"use client"` for anything using: `useState`, `useEffect`, `useContext`, event handlers,
browser APIs, or a library that uses those internally (urql's hooks, for instance).

### How they fit together

The mental model: **Server Components render the page and its data; Client Components are islands
of interactivity within it.**

```tsx
// app/recipes/[id]/page.tsx  — Server Component
import { prisma } from "@/lib/prisma";
import { FavoriteButton } from "./favorite-button"; // Client Component

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: { _count: { select: { favorites: true } } },
  });
  if (!recipe) return <p>Not found.</p>;

  return (
    <article>
      <h1>{recipe.title}</h1>
      <p>{recipe.description}</p>
      {/* the interactive island, handed data from the server */}
      <FavoriteButton recipeId={recipe.id} initialCount={recipe._count.favorites} />
    </article>
  );
}
```

Rules of thumb:

- A Server Component **can** render a Client Component and pass it props (props must be
  serializable — no functions, no class instances).
- A Client Component **cannot** import a Server Component, but it **can** accept one as
  `children` (a Server Component passed through from above).
- Push `"use client"` **down** the tree — make the leaf button a Client Component, not the whole
  page.

### Where GraphQL fits

The tutorial uses both paths (Part 6 covers this in full):

- **Client Components** use urql's `useQuery` / `useMutation` hooks — the interactive, "click and
  something changes" flows.
- **Server Components** can fetch the initial data directly (from Prisma, or by calling the GraphQL
  schema server-side) so the first paint isn't a spinner.

We lean **client-components-first** for data — it's the more transferable GraphQL skill — and add
server fetching where the first-load experience benefits.

---

## Checkpoint — build it the manual way

Build a small app (Vite + React + TS, or a scratch Next.js page). No GraphQL — that's the point;
you'll replace this in Part 6 and feel the difference.

**Requirements:**

1. A `useRecipes()` custom hook that fetches from a mock endpoint (use a local JSON file or
   `https://dummyjson.com/recipes`) and returns a discriminated union:
   `{ status: "loading" } | { status: "error"; error: Error } | { status: "ready"; recipes: Recipe[] }`.
2. A `<RecipeList>` Client Component that calls the hook and renders loading / error / empty /
   list states by `switch`ing on `status`.
3. A `<RecipeCard>` component with typed props for one recipe.
4. A `<FavoriteButton>` Client Component with local `useState` count (no persistence).
5. Correct `key`s (use the recipe id), an ESLint pass with `react-hooks` rules on, and no `any`.

**Stretch:** a `useReducer`-driven "add ingredient / remove ingredient" mini-form using the
`FormAction` union from §2.3.

When this works and type-checks cleanly, you have every frontend prerequisite for the rest of the
tutorial.

---

## What's next

**Part 3 — Project setup.** We scaffold the real Cookbook app: `create-next-app`, the folder
structure, `tsconfig` settings that matter, PostgreSQL in Docker, and Prisma. From here on there's
one evolving codebase, committed and tagged at every checkpoint.
