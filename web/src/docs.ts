// The documentation pages arrive complete from the server (see web/docs.html). This adds the three things that
// need a script: the light and dark switch, the list of pages on a narrow screen, and Copy on every code block.

import { copyKeys, copyText } from "./clipboard.ts";
import { setAppearance, shownAppearance } from "./theme.ts";
import { track } from "./track.ts";

document.getElementById("appearance")!.addEventListener("click", () => setAppearance(shownAppearance() === "dark" ? "light" : "dark"));

const menu = document.getElementById("menu")!;
const pages = document.getElementById("pages")!;
menu.addEventListener("click", () => {
  const open = pages.classList.toggle("open");
  menu.setAttribute("aria-expanded", String(open));
});
// In a list longer than the window, the page that is open should not be out of sight.
pages.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" });

for (const pre of document.querySelectorAll<HTMLPreElement>(".prose pre")) {
  const box = document.createElement("div");
  box.className = "copy";
  pre.replaceWith(box);
  const button = document.createElement("button");
  button.className = "btn small";
  button.type = "button";
  button.textContent = "Copy";
  button.addEventListener("click", async () => {
    // Without the line break at the end, so a command pasted into a terminal waits for Return.
    const copied = await copyText((pre.textContent ?? "").trimEnd(), pre);
    if (copied) track("copy_command");
    button.textContent = copied ? "Copied" : `Press ${copyKeys}`;
    setTimeout(() => (button.textContent = "Copy"), copied ? 1200 : 3000);
  });
  box.append(pre, button);
}
