"use client";

import { useQuery } from "@urql/next";
import { graphql } from "@/lib/generated";
import { RecipeCard } from "./recipe-card";

const RecipesQuery = graphql(`
  query Recipes {
    recipes {
      id
      ...RecipeCard
    }
  }
`);

export function RecipeList() {
  const [{ data, error }] = useQuery({ query: RecipesQuery });

  if (error) return <p role="alert">Couldn&apos;t load recipes: {error.message}</p>;

  const recipes = data?.recipes ?? [];
  if (recipes.length === 0) return <p>No recipes yet.</p>;

  return (
    <ul className="recipe-grid">
      {recipes.map((recipe) => (
        <li key={recipe.id}>
          <RecipeCard recipe={recipe} />
        </li>
      ))}
    </ul>
  );
}
