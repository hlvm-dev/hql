// import chalk from "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js"
// console.log(chalk.blue('Hello world!'));

import lodash from "npm:lodash";

const arr = [1, 2, 3, 4, 5, 6];
const chunked = lodash.chunk(arr, 2);
console.log(chunked);
