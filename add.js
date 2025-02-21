import { runHQLFile, getExport } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await runHQLFile("/Users/seoksoonjang/dev/hql/test/add2.hql");


export async function add(...args) {
  const fn = getExport("add", _exports);
  return await fn(...args);
}
