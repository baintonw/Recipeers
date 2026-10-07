import { cacheExchange, createClient, fetchExchange } from "urql";

export function makeClient() {
    return createClient({
        url: "/api/grapqhl",
        exchanges: [cacheExchange, fetchExchange]
    }) 
}