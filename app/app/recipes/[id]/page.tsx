import { Suspense } from "react";
import { RecipeDetail } from "@/components/recipe-detail";

export default async function RecipePage({ params }: PageProps<"/recipes/[id]">) {
  const { id } = await params;
  return (
    <Suspense fallback={<p>Loading recipe…</p>}>
      <RecipeDetail id={id} />
    </Suspense>
  );
}
