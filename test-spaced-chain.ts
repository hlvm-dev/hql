import { transpile } from "./mod.ts";

const hql = `(var obj {a: {b: 99}})
(print (obj .a .b))
`;

const result = await transpile(hql);
const js = typeof result === 'string' ? result : result.code;
console.log("Generated JS (last 15 lines):");
const lines = js.split('\n');
console.log(lines.slice(-15).join('\n'));
