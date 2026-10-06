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
