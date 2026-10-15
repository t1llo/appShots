import { attempt, fail } from "./fail.mjs";
import { readConfig } from "./config.mjs";

/** @typedef {import("./config.mjs").Config} Config */

/**
 * The route of a project. Its id goes in encoded, so that a mistyped one is a project the server does not
 * have rather than another route.
 * @param {string} id
 * @param {string} [rest]
 */
export const projectRoute = (id, rest = "") => `/api/projects/${encodeURIComponent(id)}${rest}`;

/**
 * @param {Config} config
 * @param {string} method
 * @param {string} route
 * @param {{ body?: BodyInit, headers?: Record<string, string> }} [options]
 */
export async function request(config, method, route, { body, headers } = {}) {
  let response;
  try {
    response = await fetch(config.url + route, {
      method,
      body,
      headers: { ...(config.token ? { authorization: `Bearer ${config.token}` } : {}), ...headers },
    });
  } catch (error) {
    fail(`Cannot reach ${config.url}: ${error.cause?.message ?? error.message}`);
  }
  if (!response.ok) {
    const detail = await response.text();
    let message = detail;
    try {
      message = JSON.parse(detail).error ?? detail;
    } catch {}
    fail(`${method} ${route} failed (${response.status}): ${message}`);
  }
  return response;
}

/** The Server line of 'appshots check': asks the server whether it takes the token, without failing. */
export async function serverStatus() {
  const { value: config, problem } = await attempt(readConfig);
  if (problem) return problem;
  if (!config.url) return "not set up. Run the setup command from Connect in the Studio.";
  let response;
  try {
    response = await fetch(`${config.url}/api/projects`, {
      headers: config.token ? { authorization: `Bearer ${config.token}` } : {},
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    return `${config.url} cannot be reached (${error.cause?.message || error.cause?.code || error.message}). Is the server running, and is that its address?`;
  }
  if (response.status === 401) return `${config.url} ${config.token ? "did not accept the saved token" : "asks for a token"}. Create one under Connect in the Studio and run the setup command it shows.`;
  if (!response.ok) return `${config.url} answered ${response.status}. Is that the address of an appShots server?`;
  return `${config.url}, ${config.token ? "signed in" : "no sign-in needed"}`;
}

/**
 * Says that a project has no such language before anything slow starts, and not after it. The server decides
 * the same way.
 * @param {Config} config
 * @param {string} project
 * @param {string | undefined} language
 */
export async function hasLanguage(config, project, language) {
  if (!language) return;
  const { locales } = (await (await request(config, "GET", projectRoute(project))).json()).project;
  const bare = (code) => code.toLowerCase().split("-")[0];
  if (locales.some((code) => code.toLowerCase() === language.toLowerCase() || bare(code) === language.toLowerCase() || code.toLowerCase() === bare(language))) return;
  fail(`Project ${project} has no language "${language}". Its languages are ${locales.join(", ")}. Add it first: in the Studio under Languages, or with the update_project tool.`);
}

/**
 * One call to the server's MCP endpoint, which answers each request by itself and in plain JSON.
 * @param {Config} config
 * @param {string} method
 * @param {unknown} [params]
 */
export async function rpc(config, method, params) {
  const response = await request(config, "POST", "/mcp", {
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  });
  const reply = await response.json();
  if (reply.error) fail(reply.error.message ?? "The server refused the call.");
  return reply.result;
}
