import { transpile } from "../src/hql/transpiler/index.ts";
const source = `
(import [first, rest, cons, seq, lazySeq] from "./js/core.js")

(fn isSome [x] (not (nil? x)))
(fn isString [x] (== "string" (typeof x)))
(fn isArray [x] (js-call Array.isArray x))

(fn distinct [coll]
  (let [step (fn [s seen]
               (lazy-seq
                 (when-let [xs (seq s)]
                   (let [f (first xs)]
                     (if (.has seen f)
                       (step (rest xs) seen)
                       (cons f (step (rest xs) (.add seen f))))))))]
    (step coll (js-new Set ()))))

(export [distinct])
`;
const STDLIB_DIR = "/Users/seoksoonjang/dev/hql/src/hql/lib/stdlib";
const result = await transpile(source, { 
  baseDir: STDLIB_DIR,
  currentFile: STDLIB_DIR + "/stdlib.hql",
});
console.log(result.code);
