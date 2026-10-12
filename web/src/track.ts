// Counts an action with the page analytics, on a server that has them (see analyticsTags in src/site.ts). Where it
// has none, or the browser blocks them, this does nothing.
//
// Only the name and a word from a fixed list go along: never anything a person typed, the name of a project, or
// who is signed in.

declare global {
  interface Window {
    umami?: { track(name: string, data?: Record<string, string>): unknown };
  }
}

export function track(name: string, data?: Record<string, string>): void {
  try {
    window.umami?.track(name, data);
  } catch {}
}
