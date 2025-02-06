import chalk from "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js"
console.log(chalk.blue('Hello world!'));

import lodash from "npm:lodash";

const arr = [1, 2, 3, 4, 5, 6];
const chunked = lodash.chunk(arr, 2);
console.log(chunked);

import { runHQLFile, getExport } from "./hql.ts";

await runHQLFile("hello.hql");

export const add = getExport("add");
export const minus = getExport("minus");

console.log(await add(4, 1));
console.log(await minus(10, 1));

// import { add, minus } from "./hello.hql.js";

// async function main() {
//   console.log(await add(4, 1));
//   console.log(await minus(4, 1));
// }

// main();


// import{ add, minus } from "./hello.hql"

// let res1 = add(2,1)
// let res2 = minus(2, 1)
// console.log(res1)
// console.log(res2)