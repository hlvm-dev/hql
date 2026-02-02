import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const home = "/tmp/pw-home";
fs.mkdirSync(home, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  env: { ...process.env, HOME: home, USERPROFILE: home },
  ignoreDefaultArgs: ["--no-sandbox"],
});
await browser.close();
console.log("ok");
