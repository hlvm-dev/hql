import chalk from "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js"
console.log(chalk.blue('Hello world!'));

import lodash from "npm:lodash";

const arr = [1, 2, 3, 4, 5, 6];
const chunked = lodash.chunk(arr, 2);
console.log(chunked);

console.log("hey!")

import { add, minus, add2, minus2 } from "./hello.hql.js";
console.log(add(2,1));          // 3 
console.log(await minus(2,1));  //1

async function asyncFunction() {
    console.log(await add2(20,10));   // 3 
    console.log(await minus2(20,10)); //1
}
  
asyncFunction()

// import { runHQLFile, getExport } from "./hql.ts";

// await runHQLFile("hello.hql");
// export const add = getExport("add");
// export const minus = getExport("minus");

// console.log(add(100, 1));
// console.log(await minus(100, 1));


