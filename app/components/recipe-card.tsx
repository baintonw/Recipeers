import Link from "next/link";
import { graphql, useFragment, type FragmentType } from "@/lib/generated";

export const RecipeCardFragment = graphql(`
  fragment RecipeCard on Recipe {
    id
    title
    favoriteCount
    author {
      name
    }
    tags {
      id
      name
    }
  }
`);

type Props = {
  recipe: FragmentType<typeof RecipeCardFragment>;
};

export function RecipeCard(props: Props) {
  const recipe = useFragment(RecipeCardFragment, props.recipe);

  return (
    <article className="card">
      <h2>
        <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
      </h2>
      <p>
        by {recipe.author.name} · ♥ {recipe.favoriteCount}
      </p>
      <p className="tags">
        {recipe.tags.map((tag) => (
          <span key={tag.id}>#{tag.name}</span>
        ))}
      </p>
    </article>
  );
}
