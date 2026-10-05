import { prisma } from "@/lib/prisma";
import type { Context } from "./builder";

// TEMPORARY (Part 5): there's no login yet, so every request acts as the oldest user in the
// database — Sam, from the seed. Part 7 replaces this with the user from the session cookie.
export async function createContext(): Promise<Context> {
  const currentUser = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  return { currentUser };
}
