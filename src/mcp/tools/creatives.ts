import { z } from "zod";
import { setCreatives } from "../../services/creatives.ts";
import { PLACEMENT_IDS } from "../../sizes.ts";
import { projectInput as project, type RegisterTools } from "../context.ts";
import { creativeInput } from "../inputs.ts";
import { guard, notes, text } from "../result.ts";

export const registerCreativeTools: RegisterTools = (server, tools) => {
  server.registerTool(
    "set_creative_assets",
    {
      title: "Set header, search results and banner images",
      description:
        "Designs the project's wide images. For the Header and Search Results tab of App Store Connect: the product page header, the search results asset, or one universal asset for both. For outside the store: a README banner, the social preview of a repository, the link preview of a web page, and a 16:9 picture for a post. Each one given replaces that one; the others stay. Nothing is rendered until you call render. Each asset takes layout (fan, sides, wall or split), eyebrow, headline, subheadline, screenshots (names, most important first), badges, badgePosition, logo, background, textColor, accentColor, font, textScale, emphasis and device; what it leaves out comes from the theme. Design guide topics store-assets and banners; every field in topic fields.",
      inputSchema: {
        project,
        header: creativeInput("Product page header, 3840×1646"),
        search: creativeInput("Search results asset, 3840×2560"),
        universal: creativeInput("Universal asset, 5244×2950, cropped by App Store Connect for both places"),
        readme: creativeInput("Banner for the top of a README or a web page, 2400×800"),
        social: creativeInput("Social preview of a GitHub repository, 1280×640"),
        link: creativeInput("Link preview of a web page (its og:image), 1200×630"),
        post: creativeInput("Picture for a post, a deck or a video thumbnail, 1920×1080"),
        remove: z.array(z.enum(PLACEMENT_IDS)).optional().describe("Assets to delete from the project"),
      },
    },
    ({ project: id, remove, ...given }) =>
      guard(tools, "set_creative_assets", async () => {
        const { assets, warnings } = await setCreatives(tools.ctx, id, given, remove);
        if (assets.length === 0) return text("The project has no header, search results or banner images now.");
        const lines = assets.map(
          ({ placement, label, layout, shown, extra }) => `- ${placement}: ${label}, ${layout} layout${extra > 0 ? ` (it shows ${shown} screenshots, so the last ${extra} will be left out)` : ""}`,
        );
        return text(`The project now has these assets:\n${lines.join("\n")}\nCall render to see them.${notes(warnings)}`);
      }),
  );
};
