"use client";

import Link from "next/link";
import { useQuery } from "@urql/next";
import { graphql } from "@/lib/generated";
import { FavoriteButton } from "./favorite-button";


const RecipeDetailQuery = graphql(`
  query RecipeDetail($id: ID!) {
    recipe(id: $id) {
      id
      title
      description
      favoriteCount
      updatedAt
      author {
        name
      }
      tags {
        id
        name
      }
      ingredients {
        quantity
        unit
        ingredient {
          id
          name
        }
      }
      steps {
        id
        order
        text
      }
    }
  }
`);

export function RecipeDetail({ id }: { id: string }) {
  const [{ data, error }] = useQuery({
    query: RecipeDetailQuery,
    variables: { id },
  });

  if (error) return <p role="alert">Couldn&apos;t load this recipe: {error.message}</p>;

  const recipe = data?.recipe;
  if (!recipe) {
    return (
      <>
        <h1>Recipe not found</h1>
        <Link href="/">← Back to recipes</Link>
      </>
    );
  }

  return (
    <article className="recipe">
      <Link href="/">← Back</Link>
      <h1>
        {recipe.title} <FavoriteButton initialCount={recipe.favoriteCount} />
      </h1>
      <p>
        by {recipe.author.name} · updated{" "}
        {new Date(recipe.updatedAt).toLocaleDateString()}
      </p>

      <p className="tags">
        {recipe.tags.map((tag) => (
          <span key={tag.id}>#{tag.name}</span>
        ))}
      </p>
      {recipe.description && <p>{recipe.description}</p>}

      <div className="recipe-columns">
        <section>
          <h2>Ingredients</h2>
          <ul>
            {recipe.ingredients.map(({ quantity, unit, ingredient }) => (
              <li key={ingredient.id}>
                {quantity} {unit.toLowerCase()} {ingredient.name}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Steps</h2>
          <ol>
            {recipe.steps.map((step) => (
              <li key={step.id}>{step.text}</li>
            ))}
          </ol>
        </section>
      </div>
    </article>
  );
}
