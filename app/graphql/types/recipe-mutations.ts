import { builder } from "../builder";
import { UnitEnum } from "./recipe-parts";
import { prisma } from "@/lib/prisma";
import { badInput, unauthenticated, isRecordNotFound, notFound } from "../errors";

const IngredientInput = builder.inputType("IngredientInput", {
  fields: (t) => ({
    name: t.string({ required: true }),
    quantity: t.float({ required: true }),
    unit: t.field({ type: UnitEnum, required: true }),
  }),
});

const RecipeInput = builder.inputType("RecipeInput", {
  fields: (t) => ({
    title: t.string({ required: true }),
    description: t.string(),
    steps: t.stringList({ required: true }),
    ingredients: t.field({ type: [IngredientInput], required: true }),
    tags: t.stringList({ required: true }),
  }),
});


type RecipeInputData = typeof RecipeInput.$inferInput;

function validateRecipeInput(input: RecipeInputData) {
  const title = input.title.trim();
  if (!title) throw badInput("Title is required", "title");
  if (title.length > 120) throw badInput("Title must be 120 characters or fewer", "title");

  const steps = input.steps.map((step) => step.trim()).filter(Boolean);
  if (steps.length === 0) throw badInput("Add at least one step", "steps");

  const ingredients = input.ingredients.map((ingredient) => ({
    ...ingredient,
    name: ingredient.name.trim(),
  }));
  if (ingredients.length === 0) throw badInput("Add at least one ingredient", "ingredients");

  const seen = new Set<string>();
  for (const { name, quantity } of ingredients) {
    if (!name) throw badInput("Every ingredient needs a name", "ingredients");
    if (!(quantity > 0)) throw badInput(`Quantity for "${name}" must be positive`, "ingredients");

    const key = name.toLowerCase();
    if (seen.has(key)) throw badInput(`"${name}" is listed more than once`, "ingredients");
    seen.add(key);
  }

  const tags = [...new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];

  return {
    title,
    description: input.description?.trim() || null,
    steps,
    ingredients,
    tags,
  };
}

// Helpers that turn validated input into Prisma nested-write shapes, shared by createRecipe and
// updateRecipe. Typed off validateRecipeInput's return value, so they only accept cleaned-up input.
type ValidRecipe = ReturnType<typeof validateRecipeInput>;

// ["Whisk…", "Bake…"] → [{ order: 1, text: "Whisk…" }, { order: 2, text: "Bake…" }].
// Order comes from list position, so the client never sends it.
const stepCreates = (steps: ValidRecipe["steps"]) =>
  steps.map((text, index) => ({ order: index + 1, text }));

// One RecipeIngredient (join) row per ingredient, holding this recipe's quantity and unit.
// connectOrCreate links to the existing Ingredient with that name, or creates it if it's new,
// so "Onion" is shared across recipes rather than duplicated.
const ingredientCreates = (ingredients: ValidRecipe["ingredients"]) =>
  ingredients.map(({ name, quantity, unit }) => ({
    quantity,
    unit,
    ingredient: {
      connectOrCreate: { where: { name }, create: { name } },
    },
  }));

// Recipe ↔ Tag is an implicit many-to-many (no join model), so tags are connected directly:
// passed to `tags: { connectOrCreate: … }`, not wrapped in a join row like ingredients.
const tagConnects = (tags: ValidRecipe["tags"]) =>
  tags.map((name) => ({ where: { name }, create: { name } }));

builder.mutationFields((t) => ({
  createRecipe: t.prismaField({
    type: "Recipe",
    args: {
      input: t.arg({ type: RecipeInput, required: true }),
    },
    resolve: async (query, _parent, args, ctx) => {
      if (!ctx.currentUser) throw unauthenticated();
      const recipe = validateRecipeInput(args.input);

      return prisma.recipe.create({
        ...query,
        data: {
          title: recipe.title,
          description: recipe.description,
          author: { connect: { id: ctx.currentUser.id } },
          steps: { create: stepCreates(recipe.steps) },
          ingredients: { create: ingredientCreates(recipe.ingredients) },
          tags: { connectOrCreate: tagConnects(recipe.tags) },
        },
      });
    },
  }),
  updateRecipe: t.prismaField({
    type: "Recipe",
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: RecipeInput, required: true }),
    },
    resolve: async (query, _parent, args) => {
      const recipe = validateRecipeInput(args.input);

      try {
        return await prisma.$transaction(async (tx) => {
          const tags = await Promise.all(
            recipe.tags.map((name) =>
              tx.tag.upsert({ where: { name }, create: { name }, update: {} }),
            ),
          );

          return tx.recipe.update({
            ...query,
            where: { id: args.id },
            data: {
              title: recipe.title,
              description: recipe.description,
              steps: { deleteMany: {}, create: stepCreates(recipe.steps) },
              ingredients: { deleteMany: {}, create: ingredientCreates(recipe.ingredients) },
              tags: { set: tags.map((tag) => ({ id: tag.id })) },
            },
          });
        });
      } catch (error) {
        if (isRecordNotFound(error)) throw notFound("Recipe");
        throw error;
      }
    },
  }),
  deleteRecipe: t.field({
    type: "ID",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args) => {
      try {
        await prisma.recipe.delete({ where: { id: args.id } });
        return args.id;
      } catch (error) {
        if (isRecordNotFound(error)) throw notFound("Recipe");
        throw error;
      }
    },
  }),
}));

