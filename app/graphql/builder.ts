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
  // Output fields are non-null unless marked `nullable: true` (see the note in §5.2).
  DefaultFieldNullability: false;
  Scalars: {
    ID: { Input: string; Output: string };
    DateTime: { Input: Date; Output: Date };
  };
}>({
  plugins: [PrismaPlugin],
  defaultFieldNullability: false,
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
// Uncomment in §5.8 — GraphQL rejects a Mutation type with no fields.
// builder.mutationType({});
