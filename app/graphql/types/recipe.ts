import { builder } from "../builder";
import { prisma } from "@/lib/prisma";

builder.queryFields((t) => ({
  recipes: t.prismaField({
    type: ["Recipe"],
    resolve: (query) =>
      prisma.recipe.findMany({
        ...query,
        orderBy: { createdAt: "desc" },
      }),
  }),

  recipe: t.prismaField({
    type: "Recipe",
    nullable: true,
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (query, _parent, args) =>
      prisma.recipe.findUnique({
        ...query,
        where: { id: args.id },
      }),
  }),
}));


builder.prismaObject("Recipe", {
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    description: t.exposeString("description", { nullable: true }),
    author: t.relation("author"),
    steps: t.relation("steps", {
      query: { orderBy: { order: "asc" } },
    }),
    ingredients: t.relation("ingredients"),
    tags: t.relation("tags", {
      query: { orderBy: { name: "asc" } },
    }),
    favoriteCount: t.relationCount("favoritedBy"),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    updatedAt: t.expose("updatedAt", { type: "DateTime" }),
  }),
});
