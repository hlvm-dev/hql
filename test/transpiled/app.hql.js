import { runHQLFromSource, getExport } from "./hql_runtime.js";

const source = ";; (def npm_dist (import \"npm:@boraseoksoon/npm_dist\"))\n\n;; (def npm_dist (import \"https://unpkg.com/@boraseoksoon/npm_dist@1.0.8/add.hql.js \"))\n;; (log ((get npm_dist \"add\") 1 2))\n\n(def npm_dist (import \"npm:@boraseoksoon/npm_dist@1.0.8\"))\n(log ((get npm_dist \"add\") 1 2))\n\n;; (def lodash (import \"npm:lodash\"))\n;; (log ((get lodash \"chunk\") (list 1 2 3 4 5 6) 2))\n\n(defn processData (data)\n  (+ data 10))\n\n(export \"processData\" processData)\n";
const _exports = await runHQLFromSource(source);


export const npm_dist = getExport("npm_dist", _exports);

export const processData = getExport("processData", _exports);
