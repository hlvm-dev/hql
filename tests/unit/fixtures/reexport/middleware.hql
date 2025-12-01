;; test/fixtures/reexport/middleware.hql
;; Re-exports items from original.hql

(import [greet, farewell, secretValue] from "./original.hql")
(export [greet, farewell, secretValue])
