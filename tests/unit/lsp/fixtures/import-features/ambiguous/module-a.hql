;; Ambiguous: Module A exports helper
(fn helper [x] (+ x 1))
(export [helper])
