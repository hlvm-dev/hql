;; (def npm_dist (import "npm:@boraseoksoon/npm_dist"))

(def npm_dist (import "https://unpkg.com/@boraseoksoon/npm_dist@1.0.1/add.hql.js "))
(log (get npm_dist "add") 1 2)

;; (def lodash (import "npm:lodash"))
;; (log ((get lodash "chunk") (list 1 2 3 4 5 6) 2))

(defn processData (data)
  (+ data 10))

(export "processData" processData)
