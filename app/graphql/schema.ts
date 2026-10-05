import { builder } from "./builder";

import "./types/user";
import "./types/recipe";
import "./types/recipe-parts";       // §5.7
// import "./types/recipe-mutations";  // §5.8

export const schema = builder.toSchema();
