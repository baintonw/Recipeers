"use client";

import { useState } from "react";
import { UrqlProvider } from "@urql/next";
import { makeClient } from "@/lib/urql";

export function Providers({ children }: { children: React.ReactNode }) {
  const [{ client, ssr }] = useState(makeClient);
  return (
    <UrqlProvider client={client} ssr={ssr}>
      {children}
    </UrqlProvider>
  );
}
