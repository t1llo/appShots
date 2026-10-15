import readline from "node:readline";
import { fail, Failure } from "./fail.mjs";

/**
 * Asks the person at the Terminal and returns the answer. Without a terminal there is nobody to answer, so it
 * fails with `missing`, which says how to give the answer up front instead of waiting for good.
 * @param {string} question
 * @param {{ hidden?: boolean, missing: string }} options
 * @returns {Promise<string>}
 */
function ask(question, { hidden = false, missing }) {
  if (!process.stdin.isTTY) fail(missing);
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let answered = false;
    if (hidden) {
      process.stdout.write(question);
      // Swallow the echo so the token does not end up in the terminal scrollback.
      rl._writeToOutput = () => {};
    }
    rl.on("SIGINT", () => {
      rl.close();
      process.stdout.write("\n");
      process.exit(130);
    });
    // Ctrl-D ends the input without an answer.
    rl.on("close", () => answered || reject(new Failure(missing)));
    rl.question(hidden ? "" : question, (answer) => {
      answered = true;
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

/** @param {string} question */
export const promptHidden = (question) => ask(question, { hidden: true, missing: "No token: run it with APPSHOTS_TOKEN=<token> or --token <token>. Connect in the Studio shows the command." });

/**
 * @param {string} question
 * @param {string} missing What to do instead, for a command run without a terminal.
 */
export const promptLine = (question, missing) => ask(question, { missing });

/**
 * A yes or no from the person at the Terminal, yes when they only press Return. False without a terminal.
 * @param {string} question
 */
export async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  return /^(y|yes|)$/i.test(await ask(`${question} [Y/n] `, { missing: "" }));
}
