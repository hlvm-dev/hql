;; ====================================================
;; HQL Utility Macros
;; Common Lisp-style utilities
;; ====================================================

;; doto: Executes forms with x as first argument, returns x
;; (doto (new HashMap) (.set "a" 1) (.set "b" 2))
(macro doto [x & forms]
  (let (gx (gensym "doto"))
    `(let (~gx ~x)
       ~@(map (fn [f]
                (if (list? f)
                  (let (head (%first f))
                    (if (symbol? head)
                        (let (hname (name head))
                          (if (=== (js-call hname "charAt" 0) ".")
                              `(js-call ~gx ~(js-call hname "substring" 1) ~@(%rest f))
                              `(~head ~gx ~@(%rest f))))
                        `(~head ~gx ~@(%rest f))))
                  `(~f ~gx)))
              forms)
       ~gx)))

;; if-not: Inverse of if
(macro if-not [test then else]
  `(if ~test ~else ~then))

;; when-not: Inverse of when
(macro when-not [test & body]
  `(if ~test nil (do ~@body)))

;; xor: Logical XOR
(macro xor [a b]
  (let (ga (gensym "xor_a")
        gb (gensym "xor_b"))
    `(let (~ga ~a
           ~gb ~b)
       (if ~ga (not ~gb) ~gb))))

;; min/max macros expanding to Math functions
(macro min [& args]
  `(Math.min ~@args))

(macro max [& args]
  `(Math.max ~@args))

;; with-gensyms: Hygiene helper for macro writers
;; Binds each name to a unique gensym for safe macro expansion.
;;
;; Usage:
;;   (macro my-swap [a b]
;;     (with-gensyms [tmp]
;;       `(let (~tmp ~a)
;;          (set! ~a ~b)
;;          (set! ~b ~tmp))))
;;
;; Each name in the vector gets bound to (gensym "name"), making the
;; macro hygienic by avoiding variable capture.
(macro with-gensyms [names & body]
  `(let ~(apply vector
           (apply concat
             (map (fn [n]
                    [n `(gensym ~(if (symbol? n) (name n) "g"))])
                  names)))
     ~@body))
