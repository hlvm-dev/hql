; module1.hql
(def base (import "./base.hql"))
(def addBase (get base "add"))
(defn doubleAndAdd (x y)
  (addBase (* x 2) (* y 2)))
(export "doubleAndAdd" doubleAndAdd)
(print "module1.hql: doubleAndAdd(3,4)=" (doubleAndAdd 3 4))
