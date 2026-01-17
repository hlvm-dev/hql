;; @hlvm/fs - File system operations
;; Uses hlvm global for platform-agnostic operations

(fn read [path] (js-call hlvm.fs "readTextFile" path))
(fn write [path content] (js-call hlvm.fs "writeTextFile" path content))
(fn remove [path] (js-call hlvm.fs "remove" path))
(fn exists? [path]
  (let [stat (js-call hlvm.fs "statSync" path)]
    (if stat true false)))
(export [read, write, remove, exists?])
