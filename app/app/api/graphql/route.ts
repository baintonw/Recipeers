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
