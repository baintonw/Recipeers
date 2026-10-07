import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  // Introspect the running dev server — the schema Pothos built is the source of truth.
  schema: "http://localhost:3000/api/graphql",
  // Every file that might contain a graphql(`...`) call.
  documents: ["app/**/*.tsx", "components/**/*.tsx"],
  ignoreNoDocuments: true,
  generates: {
    "./lib/generated/": {
      preset: "client",
      config: {
        scalars: { DateTime: "string" },
        enumsAsTypes: true,
      },
    },
  },
};

export default config;
