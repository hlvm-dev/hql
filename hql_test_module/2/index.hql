(def multiply (get (import "./multiply.hql") "multiply"))

(defn add2 (x y) (+ (multiply x y) 2))

; (print (add2 3 4))

(export "add2" add2)