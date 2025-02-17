import { runHQLFile, getExport } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await runHQLFile("/Users/seoksoonjang/dev/hql/test/app.hql");


export async function processData(...args) {
  const fn = getExport("processData", _exports);
  return await fn(...args);
}
