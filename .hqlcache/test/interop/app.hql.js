import { exportHqlModules, getHqlModule } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/test/interop/app.hql");


export const mod2 = getHqlModule("mod2", _exports);

export const combine = getHqlModule("combine", _exports);
