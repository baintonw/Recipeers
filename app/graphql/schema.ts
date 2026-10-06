import { builder } from "./builder";

import "./types/user";
import "./types/recipe";
import "./types/recipe-parts";
import "./types/recipe-mutations";

export const schema = builder.toSchema();
