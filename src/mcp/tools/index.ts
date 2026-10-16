import type { RegisterTools } from "../context.ts";
import { registerCreativeTools } from "./creatives.ts";
import { registerGuideTools } from "./guide.ts";
import { registerMockupTools } from "./mockups.ts";
import { registerProjectTools } from "./projects.ts";
import { registerRenderTools } from "./render.ts";
import { registerSlideTools } from "./slides.ts";

/**
 * Every family of tools, in the order tools/list names them. A new family is a module in this folder that exports
 * a RegisterTools, and one line here.
 */
export const TOOL_FAMILIES: RegisterTools[] = [registerGuideTools, registerProjectTools, registerSlideTools, registerCreativeTools, registerRenderTools, registerMockupTools];
