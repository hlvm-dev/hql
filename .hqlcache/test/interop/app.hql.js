import { runHQLFile, getExport } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await runHQLFile("/Users/seoksoonjang/dev/hql/test/interop/app.hql");


export const mod2 = getExport("mod2", _exports);

export const combine = getExport("combine", _exports);
