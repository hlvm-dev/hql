;; test/fixtures/utils.hql
;; Utility functions for import testing

(fn double [x]
  (* x 2))

(fn triple [x]
  (* x 3))

(fn square [x]
  (* x x))

(export [double, triple, square])
