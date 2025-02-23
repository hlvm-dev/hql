import { exportHqlModules, getHqlModule } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/test/add.hql");


export const addModule = getHqlModule("addModule", _exports);

export const add = getHqlModule("add", _exports);
