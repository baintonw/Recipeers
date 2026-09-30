import { PrismaClient, Unit } from "@prisma/client"

const prisma = new PrismaClient();

async function main() {
  // Wipe in dependency order — children before parents — so re-running this script
  // is always safe.
  await prisma.favorite.deleteMany();
  await prisma.recipeIngredient.deleteMany();
  await prisma.step.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.user.deleteMany();

  const sam = await prisma.user.create({ data: {
    email: "sam@example.com",
    name: "Sam"
  } })

  const alex = await prisma.user.create({ data: {
    email: "alex@example.com",
    name: "Alex"
  }})

  const [beef, onion, chiliPowder, beans] = await Promise.all([
    prisma.ingredient.create({ data: { name: "Ground beef" } }),
    prisma.ingredient.create({ data: { name: "Onion" } }),
    prisma.ingredient.create({ data: { name: "Chili powder" } }),
    prisma.ingredient.create({ data: { name: "Kidney beans" } }),
  ]);

  const [dinner, quick] = await Promise.all([
    prisma.tag.create({ data: { name: "dinner" } }),
    prisma.tag.create({ data: { name: "quick" } }),
  ]);

  const chili = await prisma.recipe.create({
    data: {
      title: "Weeknight Chili",
      description: "A fast, no-fuss chili for a weeknight.",
      authorId: sam.id,
      tags: { connect: [{ id: dinner.id }, { id: quick.id }] },
      steps: {
        create: [
          { order: 1, text: "Brown the beef with the diced onion." },
          { order: 2, text: "Stir in the chili powder and beans." },
          { order: 3, text: "Simmer for 20 minutes." },
        ],
      },
      ingredients: {
        create: [
          { ingredientId: beef.id, quantity: 500, unit: Unit.GRAM },
          { ingredientId: onion.id, quantity: 1, unit: Unit.PIECE },
          { ingredientId: chiliPowder.id, quantity: 2, unit: Unit.TABLESPOON },
          { ingredientId: beans.id, quantity: 400, unit: Unit.GRAM },
        ],
      },
    },
  });

  await prisma.favorite.create({ data: { userId: alex.id, recipeId: chili.id } });

  console.log("Seeded.")
}

main()
    .catch((error) => {
        console.log(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect())