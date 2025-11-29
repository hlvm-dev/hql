;; ====================================================
;; HQL Core Macros Library
;; ====================================================
;;
;; IMPORTANT: This is the SOURCE FILE for core macros.
;; After editing this file, run: deno task embed-macros
;; to regenerate core/src/lib/embedded-macros.ts
;; ====================================================

(macro not [value]
  `(if ~value false true))

;; Note: list?, symbol?, and name are built-in functions defined in environment.ts

;; Macro versions for user code (generate efficient inline code)
;; NOTE: first, rest, cons, nth, second, seq are in STDLIB (core.js)
;; They handle LazySeq properly - DO NOT shadow them with macros!

(macro length [coll]
  `(if (=== ~coll null)
       0
       (js-get ~coll "length")))

(macro list [& items]
  `[~@items])

(macro nil? [x]
  `(=== ~x null))

(macro empty? [coll]
  `(if (nil? ~coll)
       true
       (=== (length ~coll) 0)))

;; ----------------------------------------
;; JavaScript-Style Type Predicates
;; ----------------------------------------
;; These compile to OPTIMAL inline JS - no IIFEs, no function calls.
;; Uses JS loose equality (==) for nullish checks: x == null is true for both null AND undefined.

;; Null/Undefined checks - use JS loose equality for efficiency
(macro isNull [x]
  `(=== ~x null))

(macro isUndefined [x]
  `(=== ~x undefined))

(macro isNil [x]
  `(== ~x null))              ;; JS: x == null catches both null and undefined

(macro isDefined [x]
  `(!== ~x undefined))        ;; Direct !== check

(macro notNil [x]
  `(!= ~x null))              ;; JS: x != null is true when x is neither null nor undefined

;; Type checks - compile to inline typeof checks
(macro isString [x]
  `(=== (typeof ~x) "string"))

(macro isNumber [x]
  `(=== (typeof ~x) "number"))

(macro isBoolean [x]
  `(=== (typeof ~x) "boolean"))

(macro isFunction [x]
  `(=== (typeof ~x) "function"))

(macro isSymbol [x]
  `(=== (typeof ~x) "symbol"))

;; Object/Array checks - use && for direct JS output
(macro isArray [x]
  `(Array.isArray ~x))

(macro isObject [x]
  `(&& (&& (=== (typeof ~x) "object")
           (!== ~x null))
       (! (Array.isArray ~x))))

;; ----------------------------------------
;; camelCase Aliases for Lisp-Style Macros
;; ----------------------------------------
;; Pure aliases - expand to the kebab-case versions.

(macro ifLet [binding then-expr else-expr]
  `(if-let ~binding ~then-expr ~else-expr))

(macro whenLet [binding & body]
  `(when-let ~binding ~@body))

(macro or [& args]
  (cond
    ((%empty? args) false)
    ((=== (%length args) 1) (%first args))
    (true
      `((fn [value]
          (if value
              value
              (or ~@(%rest args))))
        ~(%first args)))))

(macro and [& args]
  (cond
    ((%empty? args) true)
    ((=== (%length args) 1) (%first args))
    (true
      `((fn [value]
          (if value
              (and ~@(%rest args))
              value))
        ~(%first args)))))

(macro when [test & body]
  `(if ~test
       (do ~@body)
       nil))

(macro when-let [binding & body]
  (let (var-name (%first binding)
        var-value (%nth binding 1))
    `((fn [~var-name]
         (when ~var-name
             ~@body))
       ~var-value)))

(macro unless [test & body]
  `(if ~test
       nil
       (do ~@body)))

(macro inc [x]
  `(+ ~x 1))

(macro dec [x]
  `(- ~x 1))

(macro print [& args]
  `(console.log ~@args))

;; NOTE: cons is in STDLIB - handles LazySeq properly

(macro set [target value]
  `(= ~target ~value))

(macro str [& args]
  (cond
    ((%empty? args) `"")
    ((=== (%length args) 1) `(+ "" ~(%first args)))
    (true `(+ ~@args))))

(macro contains? [coll key]
  `(js-call ~coll "has" ~key))

;; NOTE: nth is in STDLIB - handles LazySeq properly

(macro if-let [binding then-expr else-expr]
  (let (var-name (%first binding)
        var-value (%nth binding 1))
    `((fn [~var-name]
         (if ~var-name
             ~then-expr
             ~else-expr))
       ~var-value)))

;; NOTE: second is in STDLIB - handles LazySeq properly

(macro rest? [coll]
  `(> (length ~coll) 0))

(macro empty-list? [coll]
  `(=== (length ~coll) 0))

;; NOTE: seq is in STDLIB - handles LazySeq properly

(macro empty-array []
  `(vector))

;; NOTE: `throw` is a kernel primitive, not a macro
;; It needs to create ThrowStatement IR node for exception handling

;; method-call is syntactic sugar over js-call
(macro method-call [obj method & args]
  `(js-call ~obj ~method ~@args))

(macro hash-map [& items]
  `(__hql_hash_map ~@items))

(macro empty-map []
  `(hash-map))

(macro empty-set []
  `(hash-set))

;; ----------------------------------------
;; Core control flow
;; ----------------------------------------

(macro cond [& clauses]
  (if (%empty? clauses)
      nil
      (let (first-clause (%first clauses)
            rest-clauses (%rest clauses)
            first-el (%first first-clause))
        ;; Check if first clause is a list (e.g., (else expr))
        ;; If we can extract a first element, it's a list
        (if (not (=== first-el nil))
            ;; List clause syntax: ((test) result)
            (let (test first-el
                  result (%first (%rest first-clause)))
              ;; Check if test is the symbol 'else' - if so, return result directly
              (if (symbol? test)
                  (if (=== (name test) "else")
                      result
                      ;; Otherwise generate if expression
                      (if (%empty? rest-clauses)
                          `(if ~test ~result nil)
                          `(if ~test ~result (cond ~@rest-clauses))))
                  ;; test is not a symbol, generate if expression
                  (if (%empty? rest-clauses)
                      `(if ~test ~result nil)
                      `(if ~test ~result (cond ~@rest-clauses)))))
            ;; Flat syntax: test result test result...
            (if (%empty? rest-clauses)
                (throw "cond requires result expression for test")
                (let (test first-clause
                      result (%first rest-clauses)
                      remaining (%rest rest-clauses))
                  (if (%empty? remaining)
                      `(if ~test ~result nil)
                      `(if ~test ~result (cond ~@remaining)))))))))

;; NOTE: `do` is a kernel primitive, not a macro
;; It needs to create an IIFE with BlockStatement to handle both statements and expressions
;; A macro version using nested `let` can only handle expressions, fails with `var`/statements
