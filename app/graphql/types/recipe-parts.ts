import { Unit } from "@prisma/client";
import { builder } from "../builder";

export const UnitEnum = builder.enumType(Unit, { name: "Unit" });

builder.prismaObject("Step", {
  fields: (t) => ({
    id: t.exposeID("id"),
    order: t.exposeInt("order"),
    text: t.exposeString("text"),
  }),
});

builder.prismaObject("RecipeIngredient", {
  fields: (t) => ({
    quantity: t.exposeFloat("quantity"),
    unit: t.expose("unit", { type: UnitEnum }),
    ingredient: t.relation("ingredient"),
  }),
});

builder.prismaObject("Ingredient", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
  }),
});

builder.prismaObject("Tag", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
  }),
});
