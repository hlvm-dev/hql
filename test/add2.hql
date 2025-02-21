;; add2.hql
;; A simple HQL module that defines an add function

(defn add [a b]
  (+ a b))

(export "add" add)