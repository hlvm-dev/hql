; module2.hql
(def mod1 (import "./module1.hql"))
(def jsMod (import "./jsmodule.js"))
(def doubleAndAdd (get mod1 "doubleAndAdd"))
(def multiply (get jsMod "multiply"))
(defn combine (a b)
  (multiply (doubleAndAdd a b) 3))
(export "combine" combine)
(print "module2.hql: combine(5,7)=" (combine 5 7))
