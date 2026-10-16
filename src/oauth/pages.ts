import type { Response } from "express";
import type { User } from "../accounts.ts";
import { isLocalRedirect, redirectHost } from "./clients.ts";
import type { Asked } from "./flow.ts";

// The two pages of the authorization step: the question whether to let an app in, and the page that says why an app
// cannot connect. Everything on them that an app or a person chose is escaped, and neither loads anything from
// elsewhere, so they work the same with sign-in from any client and give a framing page nothing to click.

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --soft: #f7f7f5; --text: #37352f; --text-2: rgb(55 53 47 / 0.65); --line: rgb(55 53 47 / 0.12); --ink: #2f2e2b; --on-ink: #fff; --warn: #9a6a16; --warn-soft: rgb(203 145 47 / 0.12); --code: rgb(135 131 120 / 0.15); }
@media (prefers-color-scheme: dark) { :root { --bg: #191919; --soft: #202020; --text: rgb(255 255 255 / 0.81); --text-2: rgb(255 255 255 / 0.56); --line: rgb(255 255 255 / 0.12); --ink: #e9e9e7; --on-ink: #191919; --warn: #ffc56b; --warn-soft: rgb(255 197 107 / 0.1); } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--soft); color: var(--text); font: 15px/1.55 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { width: 100%; max-width: 460px; background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
.brand { margin: 0 0 18px; font-weight: 600; color: var(--text-2); }
h1 { margin: 0 0 12px; font-size: 21px; line-height: 1.3; overflow-wrap: anywhere; }
p { margin: 0 0 12px; overflow-wrap: anywhere; }
dl { margin: 18px 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; }
dt { font-size: 13px; color: var(--text-2); }
dd { margin: 2px 0 12px; overflow-wrap: anywhere; }
dd:last-child { margin-bottom: 0; }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--code); border-radius: 4px; padding: 1px 4px; }
.warn { padding: 10px 12px; border-radius: 8px; background: var(--warn-soft); color: var(--warn); }
.small { font-size: 13px; color: var(--text-2); }
a { color: var(--text-2); }
form { display: flex; gap: 10px; margin: 20px 0 16px; }
button { flex: 1; font: inherit; font-weight: 600; padding: 9px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); cursor: pointer; }
button.allow { background: var(--ink); border-color: var(--ink); color: var(--on-ink); }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="brand">appShots</p>
${body}
</main>
</body>
</html>
`;
}

/** Sends one of the pages: never kept, never framed, and with nothing from elsewhere allowed in. */
function send(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set({
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      "Referrer-Policy": "no-referrer",
    })
    .type("html")
    .send(html);
}

/**
 * Asks the signed-in person whether to let the app in. The app's name is whatever it said, so the page also shows
 * where it sends people back to, which the server has checked, and warns when that is the person's own machine.
 */
export function sendConsent(res: Response, asked: Asked, user: User, sealed: string, switchAccount: string): void {
  const { client, redirectUri } = asked;
  const name = client.name || redirectHost(redirectUri);
  const local = isLocalRedirect(redirectUri);
  const source = client.documentHost
    ? `The app's name and addresses are published at <b>${escapeHtml(client.documentHost)}</b>.`
    : "The app gave its name itself when it registered. appShots has not checked it.";
  const body = `
<h1>Let ${escapeHtml(name)} use your appShots account?</h1>
<p>You are signed in as <b>${escapeHtml(user.name)}</b> (${escapeHtml(user.email)}). <a href="${escapeHtml(switchAccount)}">Use another account</a></p>
<p>It can do what you can do in the Studio: see, create, change and delete your projects and screenshots, and render them, which uses your renders. It cannot change your account, make tokens or see anybody else's work.</p>
<dl>
<dt>After you answer, you go back to</dt>
<dd><b>${escapeHtml(redirectHost(redirectUri))}</b><br /><code>${escapeHtml(redirectUri)}</code></dd>
<dt>Who says this is ${escapeHtml(name)}</dt>
<dd>${source}</dd>
</dl>
${local ? `<p class="warn">This address is on your own computer, where any program could be waiting for it. Allow only if you started connecting an app on this computer just now.</p>` : ""}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="request" value="${escapeHtml(sealed)}" />
<button class="allow" type="submit" name="decision" value="allow">Allow</button>
<button type="submit" name="decision" value="deny">Cancel</button>
</form>
<p class="small">Only allow an app you are adding appShots to yourself, right now. You can disconnect it at any time under Settings in the Studio.</p>`;
  send(res, 200, page(`Connect ${name} · appShots`, body));
}

/** Says why an app cannot connect, without sending the person anywhere. */
export function sendProblem(res: Response, status: number, message: string): void {
  const body = `
<h1>The app cannot connect</h1>
<p>${escapeHtml(message)}</p>
<p class="small">If this keeps happening, remove appShots from the app, add it again, and tell whoever made the app what this page says.</p>`;
  send(res, status, page("The app cannot connect · appShots", body));
}
