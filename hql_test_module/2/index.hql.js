import { exportHqlModules, getHqlModule } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/hql_test_module/2/index.hql");


export const multiply = getHqlModule("multiply", _exports);
