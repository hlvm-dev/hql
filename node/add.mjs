import { runHQLFile, getExport } from "../hql.js";

const _exports = await runHQLFile("./test/add2.hql");


export async function add(...args) {
  const fn = getExport("add", _exports);
  return await fn(...args);
}
