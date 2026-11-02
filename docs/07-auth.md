# Part 7 — Authentication & authorization

Until now, every request has been Sam: `graphql/context.ts` has picked the oldest user in the
database since Part 5. This Part replaces that stand-in with real accounts. People sign up and log
in, the server remembers them with a session cookie, and the API decides what each person may do:

- **Authentication** answers *who are you?* That's signup, login, and the session cookie
  (§7.1–7.3).
- **Authorization** answers *what may you do?* That means logged-in-only mutations, fields only
  you can see, and recipes only their author can change (§7.4–7.6).

Then the frontend catches up (§7.7), and favorites get a real mutation behind the button you built
in Part 6 (§7.8).

> **Follow along.** Continues from `part-06-complete`. Start Docker and Postgres as usual (see
> [`pausing-and-resuming.md`](./pausing-and-resuming.md)). **§7.1 resets your database**: the new
> password column means every user needs a password, and the simplest way to give the seed users
> one is to rebuild from the seed. Recipes you've created by hand will be gone. The repo is
> committed and tagged `part-07-complete` at the end.
>
> **Remember:** after editing anything in `graphql/`, restart `npm run dev`. Hot reload registers
> Pothos types twice otherwise (§6.3). This Part edits `graphql/` a lot.

---

## 7.1 The auth design

Before any code, here's the whole design, piece by piece.

**Credentials.** People sign up with a name, an email, and a password, and log in with the email
and password. No third-party login, no magic links: the simplest thing that's genuinely secure.

**Passwords are hashed with argon2.** The database never stores the password itself, only a
*hash*: the output of a one-way function. At login, the server hashes what you typed and compares.
If the database ever leaks, the attacker gets hashes, not passwords. **argon2** is the
current recommended password hashing algorithm. It's deliberately slow and memory-hungry, so
guessing passwords by brute force is expensive even with specialized hardware. (Fast hashes like
SHA-256 are the wrong tool here: being fast is exactly what makes them easy to brute-force.)

**Sessions are a signed JWT in a cookie.** After a successful login, the server needs to remember
you on every later request. It does that with a **JWT** (JSON Web Token), a small piece of JSON
saying "this is user `cmux…`, valid until next Tuesday", plus a *signature*: a hash of that JSON
computed with a secret key only the server knows. Anyone can read a JWT, but nobody can change one
without the signature failing, so the server can trust it without looking anything up.

The token lives in a **cookie**, which the browser sends automatically with every request to this
site. Three cookie settings do the security work:

| Setting | What it prevents |
|---|---|
| `httpOnly` | Page JavaScript can't read the cookie. If an attacker manages to inject a script into your page (XSS), they still can't steal the session. |
| `SameSite=Lax` | The browser won't send the cookie on POST requests that come from *other* sites. A malicious page can't submit a `deleteRecipe` mutation as you (CSRF). |
| `Secure` (in production) | The cookie is only ever sent over HTTPS, so it can't be read off the network. |

**Why this fits GraphQL.** The whole API is one endpoint, and every request already builds a
**context** (§5.4). So authentication becomes one step in building the context: read the cookie,
verify the JWT, load the user, and put them at `ctx.currentUser`. Every resolver then has the
current user, with no per-route auth middleware. And because the browser attaches the cookie
itself, urql needs no changes: no tokens to store, no headers to set.

**The tradeoff.** A JWT is valid until it expires, and the server can't take it back early.
Logging out deletes the cookie from *your* browser, but a copy someone stole would keep working
for up to 7 days. The fix is a sessions table that's checked on each request, which this tutorial
skips. For a recipe app this is a sensible trade. For a bank it wouldn't be.

### Installing

```bash
npm install @node-rs/argon2 jose
```

- **`@node-rs/argon2`** implements argon2 in Rust and ships prebuilt binaries, so there's no
  compiler to set up. Next.js already knows to load it as a native server package, so there's no
  config either.
- **`jose`** signs and verifies JWTs. It's built on the Web Crypto API, which works in every
  JavaScript runtime Next.js uses.

### The signing secret

The JWT signature needs a secret key: a long random string the server keeps private. Generate one:

```bash
openssl rand -base64 32
```

Add it to `.env`:

```bash
SESSION_SECRET="<paste the output here>"
```

And add the key, without a real value, to `.env.example`, which is committed:

```bash
SESSION_SECRET="generate with: openssl rand -base64 32"
```

Anyone with this secret can forge a session for any user, so it's never committed. `.env` is
already git-ignored (§3.4).

### A password column

In `prisma/schema.prisma`, add `passwordHash` to `User`:

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  createdAt    DateTime @default(now())

  recipes   Recipe[]
  favorites Favorite[]
}
```

Now try the usual `npx prisma migrate dev --name add-password-hash`. It refuses:

```
Added the required column `passwordHash` to the `User` table without a default value.
There are 2 rows in this table, it is not possible to execute this step.
```

That's correct: Sam and Alex already exist, and a required column needs a value for every row.
There's no sensible default password, so instead:

1. **Create the migration without applying it:**

   ```bash
   npx prisma migrate dev --name add-password-hash --create-only
   ```

2. **Give the seed users passwords.** In `prisma/seed.ts`, import the hash function:

   ```ts
   import { hash } from "@node-rs/argon2";
   ```

   and replace the two `prisma.user.create` calls:

   ```ts
   // Both seed users log in with the same password: cookbook123
   const passwordHash = await hash("cookbook123");

   const sam = await prisma.user.create({ data: {
     email: "sam@example.com",
     name: "Sam",
     passwordHash,
   } })

   const alex = await prisma.user.create({ data: {
     email: "alex@example.com",
     name: "Alex",
     passwordHash,
   }})
   ```

3. **Rebuild the database from scratch.** This applies every migration, including the new one,
   then runs the seed:

   ```bash
   npx prisma migrate reset
   ```

You can now log in as `sam@example.com` or `alex@example.com`, both with the password
`cookbook123`.

### `lib/auth.ts`

All the password and session code goes in one file. Create `lib/auth.ts`:

```ts
import { cache } from "react";
import { cookies } from "next/headers";
import { hash, verify } from "@node-rs/argon2";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "session";
const SESSION_DAYS = 7;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Add it to .env (see §7.1).");
  }
  return new TextEncoder().encode(secret);
}

// --- Passwords ---------------------------------------------------------------

export function hashPassword(password: string) {
  return hash(password);
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, password);
}

// --- Sessions ----------------------------------------------------------------

// Signs a JWT naming the user and stores it in an httpOnly cookie.
export async function startSession(userId: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true, // page JavaScript can't read it
    sameSite: "lax", // not sent on cross-site POSTs
    secure: process.env.NODE_ENV === "production", // HTTPS-only once deployed
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

// Returns the user ID from a valid session cookie, or null. A missing, tampered-with,
// or expired token all count as "not logged in".
async function getSessionUserId() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// The logged-in user, or null. `cache` means it's looked up once per request, however
// many places ask.
export const getCurrentUser = cache(async () => {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
});
```

Reading it top to bottom:

- **`getSecret`** fails loudly if `SESSION_SECRET` is missing, rather than signing tokens with
  `undefined`.
- **`hashPassword` / `verifyPassword`** wrap argon2. A hash includes its own random salt and
  settings, so `verify` needs only the stored hash and the attempt.
- **`startSession`** signs a JWT whose *subject* (`sub`) is the user's ID, valid for 7 days, and
  sets it as the `session` cookie with the settings from the table above.
- **`cookies()`** comes from `next/headers`. It works in Route Handlers, Server Components, and
  Server Actions. Like `params` (§6.5), it's async in Next.js 16. Calling `.set()` on it adds a
  `Set-Cookie` header to the response, even though the response is built by Yoga rather than by
  you.
- **`getSessionUserId`** returns `null` for *any* problem: no cookie, a bad signature, or an
  expired token. To the rest of the app, all three mean the same thing: not logged in.
- **`getCurrentUser`** is wrapped in React's **`cache`**, which remembers the result for the rest
  of the current request. §7.7 has several places that ask "who's logged in?" while rendering one
  page, and with `cache` that costs one database query instead of several.

---

## 7.2 Auth mutations

Create `graphql/types/auth.ts`:

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { endSession, hashPassword, startSession, verifyPassword } from "@/lib/auth";
import { builder } from "../builder";
import { badInput } from "../errors";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SignupInput = builder.inputType("SignupInput", {
  fields: (t) => ({
    name: t.string({ required: true }),
    email: t.string({ required: true }),
    password: t.string({ required: true }),
  }),
});

builder.queryFields((t) => ({
  // The logged-in user, or null. The frontend's auth state comes from this.
  me: t.prismaField({
    type: "User",
    nullable: true,
    resolve: (query, _parent, _args, ctx) =>
      ctx.currentUser
        ? prisma.user.findUnique({ ...query, where: { id: ctx.currentUser.id } })
        : null,
  }),
}));

builder.mutationFields((t) => ({
  signup: t.prismaField({
    type: "User",
    args: {
      input: t.arg({ type: SignupInput, required: true }),
    },
    resolve: async (query, _parent, { input }, ctx) => {
      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      if (!name) throw badInput("Name is required", "name");
      if (!EMAIL_PATTERN.test(email)) throw badInput("Enter a valid email address", "email");
      if (input.password.length < 8) {
        throw badInput("Password must be at least 8 characters", "password");
      }

      let userId: string;
      try {
        const user = await prisma.user.create({
          data: { name, email, passwordHash: await hashPassword(input.password) },
        });
        userId = user.id;
      } catch (error) {
        // P2002: unique constraint violation, here on User.email.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw badInput("An account with that email already exists", "email");
        }
        throw error;
      }

      await startSession(userId);
      // The cookie only counts from the next request on. Update this request's context
      // too, so the rest of this response (like your own email) sees you as logged in.
      ctx.currentUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      return prisma.user.findUniqueOrThrow({ ...query, where: { id: userId } });
    },
  }),

  login: t.prismaField({
    type: "User",
    args: {
      email: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
    },
    resolve: async (query, _parent, args, ctx) => {
      const user = await prisma.user.findUnique({
        where: { email: args.email.trim().toLowerCase() },
      });

      // The same message whether the email or the password was wrong, so the form
      // doesn't reveal which emails have accounts.
      if (!user || !(await verifyPassword(user.passwordHash, args.password))) {
        throw badInput("Incorrect email or password");
      }

      await startSession(user.id);
      ctx.currentUser = user; // as in signup: count as logged in for the rest of this request
      return prisma.user.findUniqueOrThrow({ ...query, where: { id: user.id } });
    },
  }),

  logout: t.boolean({
    resolve: async () => {
      await endSession();
      return true;
    },
  }),
}));
```

And import it in `graphql/schema.ts`, after `recipe-mutations`:

```ts
import "./types/auth";
```

The parts worth slowing down for:

- **`me`** is a query, not a mutation. It returns the logged-in user, or `null`. It's how anything
  (GraphiQL now, the frontend in §7.7) asks "who am I?".
- **Validation lives in `signup`**, the same way `validateRecipeInput` did in §5.8: trim, check,
  and throw `badInput` with a message written for the user. Emails are lowercased, so
  `Sam@Example.com` and `sam@example.com` are one account.
- **`P2002`** is Prisma's error code for a unique-constraint violation. `User.email` is `@unique`
  (§4.2), so a taken email fails at the database. Catching it, rather than checking first, avoids a
  race between two signups with the same email.
- **`login` gives the same message for a wrong email and a wrong password.** Otherwise the form
  would tell anyone which emails have accounts.
- **`ctx.currentUser = …` after `startSession`.** The cookie only takes effect from the browser's
  *next* request, but the rest of *this* response is still being built. Updating the context means
  fields resolved after the login see you as logged in. Without it, the `email` field in §7.5 would
  come back `null` in the login response.
- **The user is looked up twice**, once without `query` and once with it. Pothos's `query` may
  include a `select` that leaves out `passwordHash` (it's not a GraphQL field), so the password
  check uses its own lookup, and the returned value uses Pothos's.
- **`logout`** returns a plain `Boolean`. There's nothing meaningful to return, but every GraphQL
  field needs a type.

### Try it

Restart `npm run dev` and open GraphiQL. GraphiQL runs on the same site as the API, so it sends
and receives the session cookie like any page would.

```graphql
mutation {
  login(email: "sam@example.com", password: "cookbook123") {
    name
  }
}
```

Open the browser's dev tools, go to **Application → Cookies → localhost:3000**, and there's the
`session` cookie, marked `HttpOnly`. Its value is the JWT: three base64 chunks separated by dots.
Paste the middle chunk into the browser console as `JSON.parse(atob("…"))` and you'll see your
user ID as `sub`, readable but not changeable. (Don't paste real tokens into websites that
"decode JWTs": a token *is* your login.) Run `mutation { logout }` and the
cookie disappears. Try a wrong password too: "Incorrect email or password".

**`me` isn't honest yet.** The context still uses the "always Sam" stand-in, so `{ me { name } }`
says Sam whether you're logged in or not, and `createRecipe` doesn't care either. The cookie is
being set; nothing reads it yet. That's next.

---

## 7.3 The GraphQL context

Replace `graphql/context.ts`:

```ts
import { getCurrentUser } from "@/lib/auth";
import type { Context } from "./builder";

// Runs once per GraphQL request. Every resolver sees the result as `ctx`.
export async function createContext(): Promise<Context> {
  return { currentUser: await getCurrentUser() };
}
```

That's the whole change. On every request:

1. The browser sends the `session` cookie automatically.
2. Yoga calls `createContext()`.
3. `getCurrentUser()` reads the cookie with `cookies()`, verifies the JWT's signature and expiry,
   and loads that user from the database. Any failure means `null`.
4. Every resolver receives the result as `ctx.currentUser`.

**Typing the context.** The `Context` type in `graphql/builder.ts` was already
`{ currentUser: User | null }`, so nothing there changes. That's the payoff of having typed it
honestly in §5.4: `null` was always possible, and every resolver already had to handle it.

### Try it

Restart `npm run dev`. Run `{ me { name } }` logged out (`null`), log in, and run it again (Sam).
Then log in as `alex@example.com`: `me` is Alex. For the first time, the API knows who's asking.

---

## 7.4 Protected resolvers

`createRecipe` already checks `ctx.currentUser` (§5.8). With the stand-in gone, that check
matters, and three more mutations need it: `updateRecipe`, `deleteRecipe`, and §7.8's
favorites. Rather than repeating the `if`, put it in a helper. Create `graphql/guards.ts`:

```ts
import type { User } from "@prisma/client";
import type { Context } from "./builder";
import { unauthenticated } from "./errors";

// Throws UNAUTHENTICATED unless someone is logged in. Returns the user, typed as
// `User` rather than `User | null`, so the caller doesn't need its own null check.
export function requireUser(ctx: Context): User {
  if (!ctx.currentUser) throw unauthenticated();
  return ctx.currentUser;
}
```

The return type is what makes this worth a helper. `ctx.currentUser` is `User | null`, but
`requireUser(ctx)` is `User`: TypeScript knows that if it returned at all, someone is logged in.
So the code after it can use `user.id` without another null check.

In `graphql/types/recipe-mutations.ts`, use it in `createRecipe`:

```ts
      const user = requireUser(ctx);
      const recipe = validateRecipeInput(args.input);
```

with `user.id` in place of `ctx.currentUser.id` in the `author: { connect: … }` line. Import it, and
drop `unauthenticated` from the `errors` import, since nothing in this file uses it directly any
more:

```ts
import { badInput, isRecordNotFound, notFound } from "../errors";
import { requireUser } from "../guards";
```

`updateRecipe` and `deleteRecipe` need more than "logged in": they need "logged in *as the
author*". That's §7.6.

### Try it

Restart `npm run dev`, log out in GraphiQL, and run the `CreateRecipe` mutation from §5.10. You get:

```json
{ "message": "You must be logged in", "extensions": { "code": "UNAUTHENTICATED" } }
```

Log in and it works again.

---

## 7.5 Field-level authorization

Some data is fine to show anyone except for one field. `User.email` is the example: a recipe's
author name is public, but their email address should only be visible to them.

You could check that inside a resolver, but Pothos has a plugin for declaring it on the field:
**scope auth**.

```bash
npm install @pothos/plugin-scope-auth
```

In `graphql/builder.ts`, import it:

```ts
import ScopeAuthPlugin from "@pothos/plugin-scope-auth";
```

add an `AuthScopes` entry to the `SchemaBuilder` type, after `Context`:

```ts
  // Named permissions that fields can require (§7.5).
  AuthScopes: {
    loggedIn: boolean;
  };
```

and register the plugin, plus a `scopeAuth` option, in the options object:

```ts
  plugins: [ScopeAuthPlugin, PrismaPlugin],
  defaultFieldNullability: false,
  scopeAuth: {
    // Works out, once per request, which scopes the current user has.
    authScopes: async (ctx) => ({
      loggedIn: !!ctx.currentUser,
    }),
  },
```

- **Scopes** are named permissions. `authScopes` runs once per request and says which ones the
  current user has. Here, just `loggedIn`. A field can then require one with
  `authScopes: { loggedIn: true }`.
- **Plugin order matters.** `ScopeAuthPlugin` goes before `PrismaPlugin`, as its docs require, so
  auth checks wrap everything else.

Now expose `email` in `graphql/types/user.ts`:

```ts
import { builder } from "../builder";

builder.prismaObject("User", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    // Only you can see your own email. Everyone else gets null, not an error.
    email: t.exposeString("email", {
      nullable: true,
      authScopes: (user, _args, ctx) => ctx.currentUser?.id === user.id,
      unauthorizedResolver: () => null,
    }),
    recipes: t.relation("recipes", {
      query: { orderBy: { createdAt: "desc" } },
    }),
  }),
});
```

- **`authScopes` can be a function** of the parent object, the arguments, and the context. Here it
  returns `true` only when the user being resolved *is* the current user. That's a rule named
  scopes can't express, because it depends on which user is being looked at.
- **`unauthorizedResolver: () => null`** says what everyone else gets. Without it, the plugin
  throws an error, so one recipe card showing its author would fail the whole list query.
  Returning `null` is quieter, and it's why the field is `nullable: true`.

> **Scopes or guards?** `loggedIn` could protect the mutations from §7.4 too
> (`authScopes: { loggedIn: true }`). This tutorial uses `requireUser` there because it also hands
> back a non-null `User`. Scopes are the better fit for rules about *visibility* like this one,
> declared next to the field they protect.

### Try it

Restart `npm run dev`. Log in as Alex, then:

```graphql
{
  me { name email }
  recipes { title author { name email } }
}
```

`me.email` is Alex's address. Sam's recipe's `author.email` is `null`. Log in as Sam and it's
filled in.

---

## 7.6 Ownership checks

Being logged in isn't enough to edit a recipe: you have to be the person who wrote it. Add a
`FORBIDDEN` error to `graphql/errors.ts`:

```ts
export function forbidden(message: string) {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN" },
  });
}
```

- **`UNAUTHENTICATED`** (§5.9) means *we don't know who you are*. The fix is to log in.
- **`FORBIDDEN`** means *we know who you are, and the answer is no*. Logging in again won't help.

Keeping them distinct lets the frontend react properly: send someone to the login page, or tell
them they can't do that.

Then add a second guard to `graphql/guards.ts`. Here's the whole file:

```ts
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Context } from "./builder";
import { forbidden, notFound, unauthenticated } from "./errors";

// Throws UNAUTHENTICATED unless someone is logged in. Returns the user, typed as
// `User` rather than `User | null`, so the caller doesn't need its own null check.
export function requireUser(ctx: Context): User {
  if (!ctx.currentUser) throw unauthenticated();
  return ctx.currentUser;
}

// Throws unless the logged-in user wrote this recipe.
export async function requireRecipeOwner(ctx: Context, recipeId: string): Promise<User> {
  const user = requireUser(ctx);

  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: { authorId: true },
  });
  if (!recipe) throw notFound("Recipe");
  if (recipe.authorId !== user.id) throw forbidden("Only the recipe's author can change it");

  return user;
}
```

It loads only `authorId`, since that's all the check needs. If the recipe doesn't exist, it's
`NOT_FOUND` (§5.9). If someone else wrote it, it's `FORBIDDEN`.

Use it at the top of `updateRecipe` and `deleteRecipe` in `recipe-mutations.ts`. Both resolvers
need `ctx` now, so add it to their arguments:

```ts
  updateRecipe: t.prismaField({
    // …type and args unchanged…
    resolve: async (query, _parent, args, ctx) => {
      await requireRecipeOwner(ctx, args.id);
      const recipe = validateRecipeInput(args.input);
      // …the rest is unchanged…
```

```ts
  deleteRecipe: t.field({
    // …type and args unchanged…
    resolve: async (_parent, args, ctx) => {
      await requireRecipeOwner(ctx, args.id);
      try {
        await prisma.recipe.delete({ where: { id: args.id } });
      // …the rest is unchanged…
```

and add it to the guards import:

```ts
import { requireRecipeOwner, requireUser } from "../guards";
```

The check comes **before** validation. There's no point telling someone their title is too long
on a recipe they aren't allowed to edit anyway.

### Try it

Restart `npm run dev`. Log in as Alex, get the chili's ID from `{ recipes { id } }`, and run the
`DeleteRecipe` mutation from §5.10 with it:

```json
{ "message": "Only the recipe's author can change it", "extensions": { "code": "FORBIDDEN" } }
```

Log in as Sam and the same mutation works. (Then run `npx prisma migrate reset` to get the chili
back.)

---

## 7.7 Auth on the frontend

The API is done. Now the UI needs to know who's logged in: to show "Log in" or "Hi, Sam" in the
header, to send logged-out visitors away from `/recipes/new`, and to show Edit and Delete only to
a recipe's author.

### The server-rendering problem

Part 6 made pages render on the server: urql runs on the Next.js server, calls `/api/graphql`
over HTTP, and puts the results in the HTML (§6.6). That still works for public data. But that
server-to-server request **doesn't carry the browser's cookie**. The browser sends its cookie to
Next.js, but urql, running inside Next.js, makes a brand-new request without it. So anything
server-rendered through urql sees nobody logged in.

The obvious workaround is to pass the cookie to urql on the server. But urql's client lives in a
Client Component, and anything a Server Component hands to a Client Component is serialized into
the page for the browser to pick up. The cookie would end up in the page's HTML, readable by page
JavaScript, which undoes the point of `httpOnly`.

So this Part splits data by **who it's for**:

| Data | Fetched by | Why |
|---|---|---|
| Public: recipes, authors, tags, counts | urql, as in Part 6 | Same for everyone, so server-rendering it without the cookie is fine |
| Per-user: who's logged in, *my* favorites | **Server Components**, running GraphQL in-process | They can read the cookie directly, and it never leaves the server |

### Running GraphQL in a Server Component

A Server Component doesn't need HTTP to reach the API. It's running in the same process as the
schema, so it can execute a query directly, with a context built from the real cookie. Create
`lib/server-graphql.ts`:

```ts
import { execute } from "graphql";
import type { TypedDocumentNode } from "urql";
import { schema } from "@/graphql/schema";
import { createContext } from "@/graphql/context";

// Runs a GraphQL query inside this server process: no HTTP request, and the context
// (with the user from the session cookie) is built the same way Yoga builds it.
// For Server Components only.
export async function serverQuery<Data, Variables extends Record<string, unknown>>(
  document: TypedDocumentNode<Data, Variables>,
  ...[variables]: Variables extends Record<string, never> ? [] : [Variables]
): Promise<Data> {
  const result = await execute({
    schema,
    document,
    variableValues: variables,
    contextValue: await createContext(),
  });

  if (result.errors?.length) throw result.errors[0];

  // `execute` builds its results from prototype-less objects, which React refuses to pass
  // to Client Components. A JSON round trip turns them into plain objects, exactly the
  // shape a client gets over HTTP, and the shape codegen's types describe.
  return JSON.parse(JSON.stringify(result.data)) as Data;
}
```

- **`execute`** is the `graphql` package's engine, the same one Yoga calls internally (§5.3). Here
  you call it yourself, with the same `schema` and the same `createContext()`. So
  `ctx.currentUser` comes from the session cookie exactly as it does for HTTP requests.
- **It takes codegen's typed documents.** Write a query with `` graphql(`…`) `` in a Server
  Component, and `serverQuery` returns its generated type, the same as `useQuery` does.
- **The `...[variables]` signature** makes the variables argument required when the query
  declares variables, and absent when it doesn't. `serverQuery(MeQuery)` and
  `serverQuery(RecipeQuery, { id })` both type-check, and forgetting `{ id }` doesn't.
- **The JSON round trip** is there for a real reason: `execute` builds results from objects with no
  prototype, and React refuses to pass those from a Server Component to a Client Component. You'd
  see *Only plain objects … can be passed to Client Components*. Round-tripping through JSON also
  makes the result exactly what a client would receive over HTTP: `DateTime`s as strings, as
  codegen's types promise (§6.2).

### Auth state for the whole app

The root layout is a Server Component, so it can ask who's logged in and pass the answer down
through React context. Create `components/auth-provider.tsx`:

```tsx
"use client";

import { createContext, useContext } from "react";
import type { MeQuery } from "@/lib/generated/graphql";

export type CurrentUser = NonNullable<MeQuery["me"]>;

const AuthContext = createContext<CurrentUser | null>(null);

// The root layout looks up the current user on the server and passes it in. After login
// or logout, `router.refresh()` re-runs the layout, which passes in the new value.
export function AuthProvider({
  user,
  children,
}: {
  user: CurrentUser | null;
  children: React.ReactNode;
}) {
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

export function useCurrentUser() {
  return useContext(AuthContext);
}
```

There's no state here, just a value passed down. The layout is the source of truth. After logging
in or out, the forms call `router.refresh()`, which re-runs Server Components (the layout
included) for the current page, so the layout passes in the new user. This is the "useContext for
app-wide state" pattern from §2.3, with the data coming from the server.

The header becomes a Client Component, since it needs the current user and a logout button.
Create `components/site-header.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@urql/next";
import { graphql } from "@/lib/generated";
import { useCurrentUser } from "./auth-provider";

const LogoutMutation = graphql(`
  mutation Logout {
    logout
  }
`);

export function SiteHeader() {
  const user = useCurrentUser();
  const router = useRouter();
  const [{ fetching }, logout] = useMutation(LogoutMutation);

  async function handleLogout() {
    await logout({});
    router.push("/");
    router.refresh();
  }

  return (
    <header className="site-header">
      <Link href="/">Cookbook</Link>
      <nav>
        {user ? (
          <>
            <Link href="/recipes/new">New recipe</Link>
            <Link href="/favorites">My favorites</Link>
            <span>Hi, {user.name}</span>
            <button type="button" onClick={handleLogout} disabled={fetching}>
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Sign up</Link>
          </>
        )}
      </nav>
    </header>
  );
}
```

`logout({})` passes empty variables, since `Logout` takes none. The "My favorites" link goes
nowhere until §7.8.

Now replace `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { graphql } from "@/lib/generated";
import { serverQuery } from "@/lib/server-graphql";
import { AuthProvider } from "@/components/auth-provider";
import { SiteHeader } from "@/components/site-header";
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

const MeQuery = graphql(`
  query Me {
    me {
      id
      name
    }
  }
`);

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Who's logged in, looked up on the server from the session cookie.
  const { me } = await serverQuery(MeQuery);

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <Providers>
          <AuthProvider user={me}>
            <SiteHeader />
            <main className="site-main">{children}</main>
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
```

- **The layout is `async` now**, and runs the `Me` query on the server, cookie and all.
- **The header moved inside `<Providers>`**, because it uses `useMutation`, which needs the urql
  client.
- **Every page is dynamic now.** Reading the cookie means the layout can't be rendered once at
  build time, and neither can anything inside it. `next build` shows `ƒ` for every route. The
  `await connection()` from §6.6 is now redundant, but leave it: it documents that the list must
  never be static, even if the layout changes.

### Sharing the error helper

The login and signup forms show server validation messages the same way the recipe form does. Move
`getValidationMessage` out of `components/recipe-form.tsx` into its own file, `lib/errors.ts`:

```ts
import type { CombinedError } from "@urql/next";

// The server's expected errors (§5.8, §7.2) arrive as GraphQL errors with
// extensions.code === "BAD_USER_INPUT", and their messages are written for users.
// Anything else is unexpected, and its message isn't for users.
export function getValidationMessage(error: CombinedError | undefined) {
  const validationError = error?.graphQLErrors.find(
    (e) => e.extensions.code === "BAD_USER_INPUT",
  );
  return validationError?.message ?? null;
}
```

The recipe form imports it from there, in the new version below.

### Login and signup

Create `components/login-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@urql/next";
import { graphql } from "@/lib/generated";
import { getValidationMessage } from "@/lib/errors";

const LoginMutation = graphql(`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      id
    }
  }
`);

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [{ fetching, error }, login] = useMutation(LoginMutation);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await login({ email, password });
    if (result.data) {
      router.push(next);
      router.refresh(); // re-run the layout so the header knows who you are
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
        Email
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button type="submit" disabled={fetching}>
        {fetching ? "Logging in…" : "Log in"}
      </button>
      <p>
        No account? <Link href={`/signup?next=${encodeURIComponent(next)}`}>Sign up</Link>
      </p>
    </form>
  );
}
```

and `components/signup-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@urql/next";
import { graphql } from "@/lib/generated";
import { getValidationMessage } from "@/lib/errors";

const SignupMutation = graphql(`
  mutation Signup($input: SignupInput!) {
    signup(input: $input) {
      id
    }
  }
`);

export function SignupForm({ next }: { next: string }) {
  const router = useRouter();
  const [{ fetching, error }, signup] = useMutation(SignupMutation);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await signup({ input: { name, email, password } });
    if (result.data) {
      router.push(next);
      router.refresh();
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
        Name
        <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password <small>(at least 8 characters)</small>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button type="submit" disabled={fetching}>
        {fetching ? "Creating account…" : "Sign up"}
      </button>
      <p>
        Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Log in</Link>
      </p>
    </form>
  );
}
```

- **`router.push(next)` then `router.refresh()`.** `push` goes to the next page. `refresh`
  re-renders it, so the layout picks up the new cookie and the header changes to "Hi, Sam". Leave
  out `refresh` and the header still says "Log in" until a full reload.
- **`autoComplete` attributes** tell password managers what each field is. `current-password` on
  login and `new-password` on signup are what make "save password" and "suggest a strong password"
  work.
- **`next`** is where to go afterwards: back to the page that sent you to log in. It's passed
  through to the other form's link, so switching from login to signup keeps it.

The pages are Server Components that read `next` from the URL. First, a small helper file,
`lib/redirects.ts`:

```ts
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

// For pages that need a logged-in user: sends everyone else to /login, with a `next`
// parameter so they come back here afterwards.
export async function requireUserOrRedirect(path: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  return user;
}

// Only follow `next` if it's a path on this site, never a full URL to somewhere else.
export function safeNextPath(next: string | string[] | undefined) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
```

- **`requireUserOrRedirect`** is the page-level twin of `requireUser`: instead of throwing a
  GraphQL error, it redirects to the login page. `redirect()` from `next/navigation` works by
  throwing, so nothing after it runs.
- **`safeNextPath`** guards against an *open redirect*. Without it, a link like
  `/login?next=https://evil.example` would send people to another site right after they log in
  on yours. Only paths starting with a single `/` are allowed.

Create `app/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirects";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);

  return (
    <>
      <h1>Log in</h1>
      <LoginForm next={next} />
    </>
  );
}
```

and `app/signup/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirects";
import { SignupForm } from "@/components/signup-form";

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);

  return (
    <>
      <h1>Sign up</h1>
      <SignupForm next={next} />
    </>
  );
}
```

If you're already logged in, both pages send you straight on to `next`.

### Protecting a page

Only logged-in users can create recipes. The API already enforces that (§7.4), but the page
should send visitors to log in rather than show them a form that can't work. Replace
`app/recipes/new/page.tsx`:

```tsx
import { requireUserOrRedirect } from "@/lib/redirects";
import { RecipeForm } from "@/components/recipe-form";

export default async function NewRecipePage() {
  await requireUserOrRedirect("/recipes/new");

  return (
    <>
      <h1>New recipe</h1>
      <RecipeForm />
    </>
  );
}
```

### Edit and Delete, for the author only

The detail page should show **Edit** and **Delete** to the recipe's author, and nobody else. In
`components/recipe-detail.tsx`:

1. Add `id` to the author in the query:

   ```graphql
         author {
           id
           name
         }
   ```

2. Import the current user hook and a delete button you're about to write:

   ```tsx
   import { DeleteRecipeButton } from "./delete-recipe-button";
   import { useCurrentUser } from "./auth-provider";
   ```

3. Call `const user = useCurrentUser();` at the top of `RecipeDetail`, and add this after the
   "by … · updated …" paragraph:

   ```tsx
         {user?.id === recipe.author.id && (
           <p className="owner-actions">
             <Link href={`/recipes/${recipe.id}/edit`}>Edit</Link>
             <DeleteRecipeButton recipeId={recipe.id} />
           </p>
         )}
   ```

**Hiding a button is not security.** Anyone can send the `deleteRecipe` mutation without your UI.
The real protection is `requireRecipeOwner` on the server (§7.6). Hiding the buttons just keeps
people from clicking something that will fail.

Create `components/delete-recipe-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@urql/next";
import { graphql } from "@/lib/generated";

const DeleteRecipeMutation = graphql(`
  mutation DeleteRecipe($id: ID!) {
    deleteRecipe(id: $id)
  }
`);

export function DeleteRecipeButton({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const [{ fetching, error }, deleteRecipe] = useMutation(DeleteRecipeMutation);

  async function handleClick() {
    if (!window.confirm("Delete this recipe? This can't be undone.")) return;

    // deleteRecipe returns a bare ID, not a Recipe, so urql can't tell on its own that
    // cached recipe lists are now out of date. additionalTypenames tells it (§6.7).
    const result = await deleteRecipe({ id: recipeId }, { additionalTypenames: ["Recipe"] });
    if (!result.error) router.push("/");
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={fetching}>
        {fetching ? "Deleting…" : "Delete"}
      </button>
      {error && <small role="status">Couldn&apos;t delete: {error.graphQLErrors[0]?.message ?? "try again"}</small>}
    </>
  );
}
```

**`additionalTypenames: ["Recipe"]`** comes from §6.7's empty-list caveat. urql's document cache
invalidates cached results by the types in a mutation's result. `deleteRecipe` returns a bare
`ID`, with no `Recipe` in it, so urql wouldn't know the cached list is out of date, and you'd land
back on a list that still shows the deleted recipe. Passing the typename explicitly fixes that.

### Editing reuses the form

The edit form is the create form with values filled in, so `RecipeForm` takes an optional
`recipe` and switches between `createRecipe` and `updateRecipe`. Replace
`components/recipe-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@urql/next";
import { graphql } from "@/lib/generated";
import type { RecipeInput, Unit } from "@/lib/generated/graphql";
import { getValidationMessage } from "@/lib/errors";

const CreateRecipeMutation = graphql(`
  mutation CreateRecipe($input: RecipeInput!) {
    createRecipe(input: $input) {
      id
    }
  }
`);

const UpdateRecipeMutation = graphql(`
  mutation UpdateRecipe($id: ID!, $input: RecipeInput!) {
    updateRecipe(id: $id, input: $input) {
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

// What the edit page passes in to pre-fill the form.
export type ExistingRecipe = { id: string } & RecipeInput;

export function RecipeForm({ recipe }: { recipe?: ExistingRecipe }) {
  const router = useRouter();
  const [createState, createRecipe] = useMutation(CreateRecipeMutation);
  const [updateState, updateRecipe] = useMutation(UpdateRecipeMutation);
  const { fetching, error } = recipe ? updateState : createState;

  const [title, setTitle] = useState(recipe?.title ?? "");
  const [description, setDescription] = useState(recipe?.description ?? "");
  const [steps, setSteps] = useState(recipe?.steps.join("\n") ?? "");
  const [tags, setTags] = useState(recipe?.tags.join(", ") ?? "");
  const [ingredients, setIngredients] = useState<IngredientRow[]>(
    recipe?.ingredients.map((i) => ({ ...i, quantity: String(i.quantity) })) ?? [emptyRow()],
  );

  function updateRow(index: number, patch: Partial<IngredientRow>) {
    setIngredients((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const input: RecipeInput = {
      title,
      description: description || null,
      steps: steps.split("\n"),
      ingredients: ingredients.map((row) => ({
        name: row.name,
        quantity: Number(row.quantity),
        unit: row.unit,
      })),
      tags: tags.split(","),
    };

    const id = recipe
      ? (await updateRecipe({ id: recipe.id, input })).data?.updateRecipe.id
      : (await createRecipe({ input })).data?.createRecipe.id;

    if (id) router.push(`/recipes/${id}`);
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
        {fetching ? "Saving…" : recipe ? "Save changes" : "Create recipe"}
      </button>
    </form>
  );
}
```

What changed from Part 6:

- **Both mutations are always set up**, and `recipe ? updateState : createState` picks whichever
  is relevant. Hooks can't be called conditionally, so you can't write
  `recipe ? useMutation(A) : useMutation(B)`.
- **`ExistingRecipe = { id } & RecipeInput`** reuses the generated `RecipeInput` type, so the form's
  pre-fill shape is exactly what `updateRecipe` will accept.
- **Initial state comes from `recipe` when there is one**: steps joined back into lines, tags into
  a comma list, and quantities into strings for the inputs.
- `getValidationMessage` now comes from `@/lib/errors`.

`updateRecipe` returns a `Recipe`, so urql invalidates the cached detail and list queries on its
own. There's no `additionalTypenames` needed here.

The edit page loads the recipe on the server and checks ownership before showing the form. Create
`app/recipes/[id]/edit/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { graphql } from "@/lib/generated";
import { serverQuery } from "@/lib/server-graphql";
import { requireUserOrRedirect } from "@/lib/redirects";
import { RecipeForm } from "@/components/recipe-form";

const RecipeForEditQuery = graphql(`
  query RecipeForEdit($id: ID!) {
    recipe(id: $id) {
      id
      title
      description
      author {
        id
      }
      steps {
        text
      }
      ingredients {
        quantity
        unit
        ingredient {
          name
        }
      }
      tags {
        name
      }
    }
  }
`);

export default async function EditRecipePage({ params }: PageProps<"/recipes/[id]/edit">) {
  const { id } = await params;
  const user = await requireUserOrRedirect(`/recipes/${id}/edit`);

  const { recipe } = await serverQuery(RecipeForEditQuery, { id });
  if (!recipe) notFound();
  // The API would reject someone else's edit anyway (§7.6). This just avoids showing
  // them a form they can't submit.
  if (recipe.author.id !== user.id) redirect(`/recipes/${id}`);

  return (
    <>
      <h1>Edit recipe</h1>
      <RecipeForm
        recipe={{
          id: recipe.id,
          title: recipe.title,
          description: recipe.description,
          steps: recipe.steps.map((step) => step.text),
          ingredients: recipe.ingredients.map(({ quantity, unit, ingredient }) => ({
            name: ingredient.name,
            quantity,
            unit,
          })),
          tags: recipe.tags.map((tag) => tag.name),
        }}
      />
    </>
  );
}
```

It uses `serverQuery` rather than urql for a different reason than the auth state: the form only
needs the data once, as starting values, so there's nothing for urql's cache to do.
`notFound()` renders Next.js's 404 page.

### A little more CSS

Append to `app/globals.css`:

```css
/* Part 7 */
.site-header nav {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-weight: 400;
}

.site-header button,
.owner-actions button {
  font: inherit;
  padding: 0.25rem 0.5rem;
}

.owner-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}
```

### Try it

Restart `npm run dev` and run `npm run codegen` (or keep `codegen:watch` running).

1. Logged out, the header shows **Log in** and **Sign up**, and visiting `/recipes/new` sends
   you to `/login?next=%2Frecipes%2Fnew`.
2. A wrong password shows "Incorrect email or password". The right one (`cookbook123`) lands you
   back on `/recipes/new`, and the header says "Hi, Sam".
3. Create a recipe. Its page shows **Edit** and **Delete**. Edit it: the form is pre-filled,
   and **Save changes** takes you back to the updated recipe.
4. Log out and log in as Alex. Sam's recipes show no Edit or Delete, and typing
   `/recipes/<id>/edit` for one of them sends you back to the recipe.
5. As Sam again, delete your new recipe. You land on the list, and it's gone.
6. Sign up as someone new. A taken email gets "An account with that email already exists". A new
   one logs you straight in.

---

## 7.8 Capstone: favorites end-to-end

The ♡ button from §6.8 has been faking it with a timer. Now it gets real, using every piece of
this Part: a protected mutation, a per-user field, and a per-user page.

### The API

Two mutations and a query. Create `graphql/types/favorites.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { builder } from "../builder";
import { notFound } from "../errors";
import { requireUser } from "../guards";

builder.queryFields((t) => ({
  myFavorites: t.prismaField({
    type: ["Recipe"],
    resolve: (query, _parent, _args, ctx) => {
      const user = requireUser(ctx);
      return prisma.recipe.findMany({
        ...query,
        where: { favoritedBy: { some: { userId: user.id } } },
        orderBy: { createdAt: "desc" },
      });
    },
  }),
}));

builder.mutationFields((t) => ({
  favoriteRecipe: t.prismaField({
    type: "Recipe",
    args: { id: t.arg.id({ required: true }) },
    resolve: async (query, _parent, args, ctx) => {
      const user = requireUser(ctx);
      if (!(await prisma.recipe.count({ where: { id: args.id } }))) throw notFound("Recipe");

      // upsert, not create: favoriting twice is harmless, not an error.
      await prisma.favorite.upsert({
        where: { userId_recipeId: { userId: user.id, recipeId: args.id } },
        create: { userId: user.id, recipeId: args.id },
        update: {},
      });

      return prisma.recipe.findUniqueOrThrow({ ...query, where: { id: args.id } });
    },
  }),

  unfavoriteRecipe: t.prismaField({
    type: "Recipe",
    args: { id: t.arg.id({ required: true }) },
    resolve: async (query, _parent, args, ctx) => {
      const user = requireUser(ctx);
      if (!(await prisma.recipe.count({ where: { id: args.id } }))) throw notFound("Recipe");

      // deleteMany, not delete: unfavoriting something you hadn't favorited is harmless too.
      await prisma.favorite.deleteMany({ where: { userId: user.id, recipeId: args.id } });

      return prisma.recipe.findUniqueOrThrow({ ...query, where: { id: args.id } });
    },
  }),
}));
```

- **Both mutations are idempotent.** Favoriting twice, or unfavoriting something you hadn't
  favorited, succeeds and changes nothing. That matters for a button people double-click, and for
  requests a flaky network delivers twice.
- **They return the `Recipe`**, so the client gets the new `favoriteCount` back, and urql's cache
  sees a `Recipe` in the result and refreshes cached recipe lists.
- **`userId_recipeId`** is how Prisma names the composite primary key `@@id([userId, recipeId])`
  from §4.2.

Import it in `graphql/schema.ts`:

```ts
import "./types/favorites";
```

Then the field that tells each user whether *they* favorited a recipe. In
`graphql/types/recipe.ts`, after `favoriteCount`:

```ts
    // Loaded as part of the recipe's own query (`select`), not one extra query per recipe.
    isFavoritedByMe: t.boolean({
      select: (_args, ctx) => ({
        favoritedBy: {
          where: { userId: ctx.currentUser?.id ?? "" },
          select: { userId: true },
        },
      }),
```

**Why `select` instead of a query in the resolver?** A resolver that ran
`prisma.favorite.findUnique(…)` would work, but it'd run once per recipe: the N+1 problem from
§5.7, on any list that asks for `isFavoritedByMe`. `select` tells the Prisma plugin to fetch "this
user's favorite row, if any" *as part of the recipe's own query*, so it's still one query for the
whole list. The resolver just checks whether that row came back. When nobody is logged in, the
`""` user ID matches nothing, so the answer is `false`.

Restart `npm run dev`. In GraphiQL, as Alex (who favorited the chili in the seed), check
`{ recipes { title favoriteCount isFavoritedByMe } }`. Then as Sam. Then try `favoriteRecipe` and
`unfavoriteRecipe` with the chili's ID.

### Per-user data on the detail page

`isFavoritedByMe` is per-user, so by the rule from §7.7 it can't come from urql's server-rendered
query. The detail page fetches it on the server instead. Replace `app/recipes/[id]/page.tsx`:

```tsx
import { Suspense } from "react";
import { graphql } from "@/lib/generated";
import { serverQuery } from "@/lib/server-graphql";
import { RecipeDetail } from "@/components/recipe-detail";

// Per-user data, so it's fetched here on the server, with the session cookie, rather than
// by urql (§7.8). The rest of the recipe is the same for everyone and stays in urql.
const RecipeViewerQuery = graphql(`
  query RecipeViewer($id: ID!) {
    recipe(id: $id) {
      id
      isFavoritedByMe
    }
  }
`);

export default async function RecipePage({ params }: PageProps<"/recipes/[id]">) {
  const { id } = await params;
  const { recipe } = await serverQuery(RecipeViewerQuery, { id });

  return (
    <Suspense fallback={<p>Loading recipe…</p>}>
      <RecipeDetail id={id} isFavorited={recipe?.isFavoritedByMe ?? false} />
    </Suspense>
  );
}
```

In `components/recipe-detail.tsx`, take the new prop:

```tsx
type Props = {
  id: string;
  // Whether the logged-in user has favorited this recipe. It comes from the server
  // page, not this query, because it's different for every user (§7.8).
  isFavorited: boolean;
};

export function RecipeDetail({ id, isFavorited }: Props) {
```

and give the button everything it needs:

```tsx
        {recipe.title}{" "}
        <FavoriteButton
          recipeId={recipe.id}
          initialFavorited={isFavorited}
          initialCount={recipe.favoriteCount}
        />
```

### The real button

Replace `components/favorite-button.tsx`:

```tsx
"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@urql/next";
import { graphql } from "@/lib/generated";
import { useCurrentUser } from "./auth-provider";

const FavoriteMutation = graphql(`
  mutation Favorite($id: ID!) {
    favoriteRecipe(id: $id) {
      id
      favoriteCount
    }
  }
`);

const UnfavoriteMutation = graphql(`
  mutation Unfavorite($id: ID!) {
    unfavoriteRecipe(id: $id) {
      id
      favoriteCount
    }
  }
`);

type Props = {
  recipeId: string;
  initialFavorited: boolean;
  initialCount: number;
};

export function FavoriteButton({ recipeId, initialFavorited, initialCount }: Props) {
  const user = useCurrentUser();
  const router = useRouter();
  const [, favorite] = useMutation(FavoriteMutation);
  const [, unfavorite] = useMutation(UnfavoriteMutation);

  // What the server has confirmed.
  const [favorited, setFavorited] = useState(initialFavorited);
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
    // Favoriting needs an account. Send visitors to log in, then straight back here.
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/recipes/${recipeId}`)}`);
      return;
    }

    const next = !optimistic.favorited;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);

      const serverCount = next
        ? (await favorite({ id: recipeId })).data?.favoriteRecipe.favoriteCount
        : (await unfavorite({ id: recipeId })).data?.unfavoriteRecipe.favoriteCount;

      if (serverCount === undefined) {
        setError("Couldn't save — try again.");
        return;
      }

      startTransition(() => {
        setFavorited(next);
        setCount(serverCount); // the server's count, which includes other people's favorites
      });
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

Compared with §6.8, the optimistic pattern hasn't changed at all: `useOptimistic` on top of
confirmed state, and rollback by default. Three things are new:

- **`fakeFavoriteRequest` is gone**, replaced by `favoriteRecipe` / `unfavoriteRecipe`. A failed
  mutation leaves `data` undefined, which leads to the same "Couldn't save" path the fake failures
  did.
- **The confirmed count comes from the server.** `setCount(serverCount)` rather than `+1`, so if
  someone else favorited the recipe in the meantime, you see the true number once it settles.
- **Logged-out visitors are sent to log in**, with `next` pointing back here. After logging in
  they land on the same recipe, with the right heart, since the page re-fetches
  `isFavoritedByMe` with their cookie.

And the list catches up on its own. Both mutations return a `Recipe`, so urql marks the cached
`Recipes` query stale, and the card's ♥ count is current when you go back to the list. That's the
cache-wide update §6.8 left for this Part. The document cache does it by refetching, not by
patching the cache in place, so there's no need for Graphcache.

### My favorites

Last, a page listing your favorites. It's entirely per-user, so it's a Server Component from top
to bottom. Create `app/favorites/page.tsx`:

```tsx
import { graphql } from "@/lib/generated";
import { serverQuery } from "@/lib/server-graphql";
import { requireUserOrRedirect } from "@/lib/redirects";
import { RecipeCard } from "@/components/recipe-card";

const MyFavoritesQuery = graphql(`
  query MyFavorites {
    myFavorites {
      id
      ...RecipeCard
    }
  }
`);

export default async function FavoritesPage() {
  await requireUserOrRedirect("/favorites");
  const { myFavorites } = await serverQuery(MyFavoritesQuery);

  return (
    <>
      <h1>My favorites</h1>
      {myFavorites.length === 0 ? (
        <p>Nothing here yet. Tap ♡ on a recipe to save it.</p>
      ) : (
        <ul className="recipe-grid">
          {myFavorites.map((recipe) => (
            <li key={recipe.id}>
              <RecipeCard recipe={recipe} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

This reuses `RecipeCard` from §6.4, fragment and all. `RecipeCard` has no `"use client"`, so here,
imported by a Server Component, it renders on the server. The same component renders in the
browser inside `RecipeList`. That's the payoff of keeping it free of state and hooks.

### Try it

1. Log in as Sam and open the chili. Click ♡: it flips to ♥ at once and settles a moment later.
   Go back to the list: the chili's card shows the new count.
2. Reload the chili page and view source. The button is `aria-pressed="true"` in the HTML itself,
   so it was server-rendered with your favorite state.
3. **My favorites** lists it. Unfavorite it on the recipe page, and the list is empty again.
4. Log out and click ♡ on any recipe. You're sent to log in, then straight back to that recipe.
5. Log in as Alex: the chili is already ♥, from the seed.

---

## Checkpoint — a logged-in user can publish, manage their own recipes, and favorite others'

New and changed files:

```
lib/
├── auth.ts                  passwords, sessions, getCurrentUser
├── errors.ts                getValidationMessage, now shared
├── redirects.ts             requireUserOrRedirect, safeNextPath
└── server-graphql.ts        serverQuery, for Server Components
graphql/
├── context.ts               the real current user (replaced)
├── guards.ts                requireUser, requireRecipeOwner
├── errors.ts                + forbidden
├── builder.ts               + scope auth
└── types/
    ├── auth.ts              me, signup, login, logout
    ├── favorites.ts         myFavorites, favoriteRecipe, unfavoriteRecipe
    ├── user.ts              + email (owner-only)
    ├── recipe.ts            + isFavoritedByMe
    └── recipe-mutations.ts  guarded
app/
├── layout.tsx               runs Me, provides auth state
├── login/page.tsx
├── signup/page.tsx
├── favorites/page.tsx
└── recipes/
    ├── new/page.tsx         login required
    └── [id]/
        ├── page.tsx         + isFavoritedByMe on the server
        └── edit/page.tsx
components/
├── auth-provider.tsx
├── site-header.tsx
├── login-form.tsx
├── signup-form.tsx
├── delete-recipe-button.tsx
├── recipe-form.tsx          + edit mode
├── recipe-detail.tsx        + owner actions, real favorite state
└── favorite-button.tsx      real mutations
prisma/
├── schema.prisma            + User.passwordHash
├── migrations/…_add_password_hash/
└── seed.ts                  + passwords
```

Plus `SESSION_SECRET` in `.env` and `.env.example`.

You should be able to:

```bash
npx tsc --noEmit    # no errors
npm run lint        # no errors or warnings
npx next build      # every route ƒ (dynamic)
```

And in the browser:

- Logged out, you can browse every recipe. **New recipe** and **My favorites** send you to log
  in, and so does ♡, returning you to where you were afterwards.
- Sign up, log in, and log out all work, and the header always shows who you are.
- You can create recipes, and edit and delete **only your own**. Someone else's recipe has no
  Edit or Delete, and the API answers `FORBIDDEN` if you try anyway.
- ♡ saves for real, updates instantly, rolls back on failure, and the counts on the list keep up.
- **My favorites** shows your favorites, and only yours.
- In GraphiQL, `User.email` is `null` for everyone but you.

**What you have now:**

- Passwords stored as argon2 hashes, and sessions as signed JWTs in `httpOnly`, `SameSite`
  cookies.
- One place, `createContext`, that turns a cookie into `ctx.currentUser`, and authorization at
  three levels: logged-in-only mutations, owner-only mutations, and a field only its owner can see.
- A rule for where data comes from: public data through urql, per-user data through Server
  Components, so the session never leaves the server.

**Known gaps, on purpose:** sessions can't be revoked before they expire (§7.1). There's no
password reset or email verification. Lists are still unfiltered and unpaginated, and forms only
validate on the server (Part 8).

Commit and tag:

```bash
git add -A
git commit -m "Part 7 — auth: signup/login, sessions, authorization, real favorites"
git tag part-07-complete
```

---

## What's next

Part 8 fills out the app: search and filtering, pagination for the recipe list, tag management, a
"My recipes" page alongside "My favorites", validation rules shared between the server and the
forms, and the loading skeletons and error boundaries that make it feel finished.
