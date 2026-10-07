"use client";

import { useState } from "react";
import { Provider } from "urql";
import { makeClient } from "@/lib/urql";

export function Providers({ children }: { children: React.ReactNode }) {
    // One client per browser tab, created once — not on every render.
    const [client] = useState(makeClient)
    return <Provider value={client}>{children}</Provider>
}