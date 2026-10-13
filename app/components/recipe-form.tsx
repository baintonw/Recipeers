"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, type CombinedError } from "@urql/next";
import { graphql } from "@/lib/generated";
import type { Unit } from "@/lib/generated/graphql";

const CreateRecipeMutation = graphql(`
  mutation CreateRecipe($input: RecipeInput!) {
    createRecipe(input: $input) {
      id
    }
  }
`);

const UNITS: Unit[] = [
  "GRAM",
  "KILOGRAM",
  "MILLILITER",
  "LITER",
  "TEASPOON",
  "TABLESPOON",
  "CUP",
  "PIECE",
];

type IngredientRow = { name: string; quantity: string; unit: Unit };

const emptyRow = (): IngredientRow => ({ name: "", quantity: "", unit: "GRAM" });

export function RecipeForm() {
  const router = useRouter();
  const [{ fetching, error }, createRecipe] = useMutation(CreateRecipeMutation);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [tags, setTags] = useState("");
  const [ingredients, setIngredients] = useState<IngredientRow[]>([emptyRow()]);

  function updateRow(index: number, patch: Partial<IngredientRow>) {
    setIngredients((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = await createRecipe({
      input: {
        title,
        description: description || null,
        steps: steps.split("\n"),
        ingredients: ingredients.map((row) => ({
          name: row.name,
          quantity: Number(row.quantity),
          unit: row.unit,
        })),
        tags: tags.split(","),
      },
    });

    if (result.data) {
      router.push(`/recipes/${result.data.createRecipe.id}`);
    }
  }


  return (
    <form onSubmit={handleSubmit} className="recipe-form">
      {error && (
        <p role="alert" className="form-error">
          {getValidationMessage(error) ?? "Something went wrong. Please try again."}
        </p>
      )}

      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <fieldset>
        <legend>Ingredients</legend>
        {ingredients.map((row, index) => (
          <div key={index} className="ingredient-row">
            <input
              aria-label="Ingredient"
              placeholder="Onion"
              value={row.name}
              onChange={(e) => updateRow(index, { name: e.target.value })}
            />
            <input
              aria-label="Quantity"
              type="number"
              step="any"
              placeholder="1"
              value={row.quantity}
              onChange={(e) => updateRow(index, { quantity: e.target.value })}
            />
            <select
              aria-label="Unit"
              value={row.unit}
              onChange={(e) => updateRow(index, { unit: e.target.value as Unit })}
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit.toLowerCase()}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIngredients((rows) => rows.filter((_, i) => i !== index))}
              disabled={ingredients.length === 1}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setIngredients((rows) => [...rows, emptyRow()])}>
          Add ingredient
        </button>
      </fieldset>

      <label>
        Steps <small>(one per line)</small>
        <textarea rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} />
      </label>

      <label>
        Tags <small>(comma-separated)</small>
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>

      <button type="submit" disabled={fetching}>
        {fetching ? "Saving…" : "Create recipe"}
      </button>
    </form>
  );
}

// The server's validation errors (§5.8) arrive as GraphQL errors with
// extensions.code === "BAD_USER_INPUT", and their messages are written for users.
// Anything else is unexpected, and its message isn't for users.
function getValidationMessage(error: CombinedError | undefined) {
  const validationError = error?.graphQLErrors.find(
    (e) => e.extensions.code === "BAD_USER_INPUT",
  );
  return validationError?.message ?? null;
}
