import { Suspense } from "react";
import { connection } from "next/server";
import { RecipeList } from "@/components/recipe-list";

export default async function HomePage() {
  // Render per request, not once at build time — otherwise `next build` would bake
  // today's recipe list into static HTML.
  await connection();

  return (
    <>
      <h1>Recipes</h1>
      <Suspense fallback={<p>Loading recipes…</p>}>
        <RecipeList />
      </Suspense>
    </>
  );
}
