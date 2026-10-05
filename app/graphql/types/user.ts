import { builder } from "../builder";

builder.prismaObject("User", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    recipes: t.relation("recipes", {
    query: { orderBy: { createdAt: "desc" } },
  }),
  }),
});
