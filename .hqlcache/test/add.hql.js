import { runHQLFile, getExport } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await runHQLFile("/Users/seoksoonjang/dev/hql/test/add.hql");


export const addModule = getExport("addModule", _exports);

export const add = getExport("add", _exports);
