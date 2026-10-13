"use client";

import { useOptimistic, useState, useTransition } from "react";

// Stand-in for the real favoriteRecipe mutation, which arrives in Part 7 once
// there's a logged-in user to favorite *as*. Slow, and fails one time in four,
// so you can watch the optimistic value appear — and roll back.
async function fakeFavoriteRequest(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (Math.random() < 0.25) throw new Error("Network hiccup");
}

type Props = { initialCount: number };

export function FavoriteButton({ initialCount }: Props) {
  // What the server has confirmed.
  const [favorited, setFavorited] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);

  // What the user sees: the confirmed state, with any in-flight change applied on top.
  const [optimistic, setOptimistic] = useOptimistic(
    { favorited, count },
    (current, next: boolean) => ({
      favorited: next,
      count: current.count + (next ? 1 : -1),
    }),
  );
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !optimistic.favorited;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      try {
        await fakeFavoriteRequest();
        startTransition(() => {
          setFavorited(next);
          setCount((c) => c + (next ? 1 : -1));
        });
      } catch {
        setError("Couldn't save — try again.");
      }
    });
  }

  return (
    <span className="favorite">
      <button type="button" onClick={toggle} disabled={isPending} aria-pressed={optimistic.favorited}>
        {optimistic.favorited ? "♥" : "♡"} {optimistic.count}
      </button>
      {error && <small role="status">{error}</small>}
    </span>
  );
}
