# Step 6 F: a web app

Part of the appshots skill: step 6 of SKILL.md for a web app.

A web app is captured page by page. `appshots capture --web <address>` draws the page at that address with Chrome, without opening a window, at the exact size of the device, and uploads it as that device's screenshot. It uses the Chrome, Edge or Brave that is installed, which `check` reports under `Browser:`. Do not install or script a browser yourself.

1. **Get it running.** If the user has the dev server running, use its address. Otherwise start it with the command `check` names, such as `npm run dev`, in the background, and read the address off what it prints: the port is not always the usual one. Install dependencies first only if they are missing. If it needs a database, keys or an account you do not have, ask the user to start it and tell you the address. A site that is already online works the same way, when the user says to use it.

2. **Capture each screen with one command:**

   ```bash
   appshots capture --web http://localhost:5173/stats --name stats --project <project>
   ```

   It waits for the page and what it fetches, then one second more (`--wait 3` for a slow screen). The size is an iPhone's unless you say otherwise: `--as ipad`, `--as mac` or `--as duo`. Add `--dark` or `--light` for the colour scheme the page is asked for, and `--lang de-DE` for the language the browser reports. On an iPhone or iPad the page is laid out as an installed web app is, between the status bar and the home indicator: the home indicator is drawn, and the status bar's place stays free for step 8 to fill.

3. **How to land on a screen,** in this order. Take the first that works:

   1. Its address. Read the routes off the router or the pages folder; a query or a `#` part counts.
   2. State the page reads when it loads, set with `--init`: JavaScript that runs before the page's own on every load, such as `--init "localStorage.setItem('onboarded', '1')"` or `--init @seed.js` for a file. Sample data, a dismissed cookie banner and a fixed date go here.
   3. A step in the loaded page, with `--eval`: the click that opens a tab or a dialog, a scroll. `--eval "document.querySelector('[data-tab=stats]').click()"`. `await` works in it, and when the click leads to another page, that page is captured.
   4. Pages behind a sign-in: use the test account the project's own seed or fixture files set up, never a real one. `--profile .appshots-browser` keeps cookies between captures, so sign in once with `--eval` and capture the rest after it. Without a test account, ask the user for one, or for the screenshots (A in `screens.md`).
   5. Otherwise ask the user for a screenshot of that screen (A in `screens.md`).

4. **Believable content.** Use what the project has for it: a seed script, fixtures, a demo mode, mocked requests. Never write into a database that is not a local one.

5. **Look at each picture.** The command says so when the address answered with an error such as 404. Take a dev tool's badge or overlay out of the picture with `--eval`, as in `--eval "document.querySelector('nextjs-portal')?.remove()"`.

6. **Stop what you started.** When the screens are captured, stop the dev server if you started it, and delete `.appshots-browser` if you made it. Do not commit either.

`appshots shoot` is not for web pages, which have no window to wait for. For the same screens on several devices, capture each address once per device under the same name, with `--as`.

In step 8, set `"device": {"statusBar": "overlay"}` in the theme for pages taken for an iPhone or iPad: it draws the 9:41 status bar into the place they leave free at the top.
