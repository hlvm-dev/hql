// platform/node/stdio.ts
// @ts-nocheck

import * as readline from "readline";

/**
 * Read a single line from standard input using Node's readline.
 */
export async function readLineFromStdin(): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Write text to standard output.
 */
export async function writeToStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
