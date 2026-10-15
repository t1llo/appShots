// What a dropped file is called in the project, and how a batch of them goes up. Kept free of the DOM so it can be
// tested on its own.

/** The longest name the server takes (SLUG in src/schema.ts). */
const LONGEST = 64;

/** Lowercase letters, digits and dashes, as the server wants a name. */
export const slug = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Cuts a name that is too long out of its middle: what tells files of a batch apart is mostly at the end, such as the time. */
function fit(name: string, longest = LONGEST): string {
  if (name.length <= longest) return name;
  const head = name.slice(0, 20).replace(/-+$/, "");
  const tail = name.slice(-(longest - head.length - 1)).replace(/^-+/, "");
  return `${head}-${tail}`;
}

/**
 * The name a file is uploaded under. The words every screenshot of a simulator or of macOS starts with are left
 * out, so "Simulator Screenshot - iPhone 16 Pro - 2026-10-14 at 10.12.33.png" becomes "2026-10-14-at-10-12-33".
 */
export function uploadName(file: string, fallback = "shot"): string {
  const plain = file
    .replace(/\.[^.]+$/, "")
    .replace(/^Simulator Screen ?Shot - .*? - (?=\d{4}-\d{2}-\d{2})/i, "")
    .replace(/^Screen ?Shot /i, "");
  return fit(slug(plain) || slug(file.replace(/\.[^.]+$/, "")) || fallback);
}

/**
 * The names of a batch of files, told apart with -2, -3 where two would be the same, so one file of the batch never
 * replaces another. A name the project already has is kept: uploading under it is how a screenshot is replaced, and
 * how another language gets its own version.
 */
export function batchNames(files: string[], fallback = "shot"): string[] {
  const taken = new Set<string>();
  return files.map((file) => {
    const name = uploadName(file, fallback);
    let unique = name;
    for (let count = 2; taken.has(unique); count++) unique = `${fit(name, LONGEST - String(count).length - 1)}-${count}`;
    taken.add(unique);
    return unique;
  });
}

/** Runs `work` over every item with at most `limit` at a time, and reports how each went in the items' order. */
export async function inParallel<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await work(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
