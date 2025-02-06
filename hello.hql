;; (def chalk (import "https://deno.land/x/chalk_deno@v4.1.1-deno/source/index.js"))
;; (log ((get chalk "blue") "hello hql!"))

(def lodash (import "npm:lodash"))
(log ((get lodash "chunk") (list 1 2 3 4 5 6) 2))
