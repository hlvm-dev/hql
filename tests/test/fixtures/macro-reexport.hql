;; Re-export macros from another file
(import [double, triple, magic-number] from "./macro-source.hql")

;; Add our own macro
(macro quadruple [x] `(double (double ~x)))

;; Re-export everything
(export [double, triple, magic-number, quadruple])
