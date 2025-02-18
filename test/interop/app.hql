; app.hql
(def mod2 (import "./module2.hql"))
(def combine (get mod2 "combine"))
(print "app.hql: combine(10,20)=" (combine 10 20))
(export "combine" combine)
