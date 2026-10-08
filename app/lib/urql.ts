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
