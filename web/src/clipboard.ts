// Copying text with a button. The clipboard is out of reach on a plain-HTTP address, and a browser can turn a write
// down, so the text is then selected instead, for the keyboard to copy.

/** The keys that copy on this device. */
export const copyKeys = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘C" : "Ctrl+C";

/** Puts `text` on the clipboard, or, when that cannot be done, selects `shown`, where it is on the page, and says false. */
export async function copyText(text: string, shown: Node): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    getSelection()?.selectAllChildren(shown);
    return false;
  }
}
