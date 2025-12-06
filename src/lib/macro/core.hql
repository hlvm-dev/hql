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
    ((empty? args) false)
    ((=== (count args) 1) (first args))
    (else
      `((fn [value]
          (if value
              value
              (or ~@(rest args))))
        ~(first args)))))

(macro and [& args]
  (cond
    ((empty? args) true)
    ((=== (count args) 1) (first args))
    (else
      `((fn [value]
          (if value
              (and ~@(rest args))
              value))
        ~(first args)))))

(macro when [test & body]
  `(if ~test
       (do ~@body)
       nil))

(macro when-let [binding & body]
  (let (var-name (first binding)
        var-value (second binding))
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
    ((empty? args) `"")
    ((=== (count args) 1) `(+ "" ~(first args)))
    (else `(+ ~@args))))

(macro contains? [coll key]
  `(js-call ~coll "has" ~key))

;; NOTE: nth is in STDLIB - handles LazySeq properly

(macro if-let [binding then-expr else-expr]
  (let (var-name (first binding)
        var-value (second binding))
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
  (if (empty? clauses)
      nil
      (let (first-arg (first clauses))
        (if (list? first-arg)
            ;; Case 1: Clause is a list (test result)
            (let (test (first first-arg)
                  result (second first-arg)
                  remaining (rest clauses))
              (if (and (symbol? test) (=== (name test) "else"))
                  result
                  `(if ~test ~result (cond ~@remaining))))
            
            ;; Case 2: Flat syntax test result ...
            (if (=== (length clauses) 1)
                first-arg  ;; Implicit default value
                (let (test first-arg
                      result (nth clauses 1)
                      remaining (drop 2 clauses))
                   (if (=== result undefined)
                       (throw "cond requires result expression for test")
                       `(if ~test ~result (cond ~@remaining)))))))))

;; NOTE: `do` is a kernel primitive, not a macro
;; It needs to create an IIFE with BlockStatement to handle both statements and expressions
;; A macro version using nested `let` can only handle expressions, fails with `var`/statements

;; ----------------------------------------
;; Threading Macros (Clojure-compatible)
;; ----------------------------------------
;; These are compile-time transformations with ZERO runtime overhead.
;; They transform nested function calls into readable linear pipelines.

;; Thread-first: inserts x as FIRST argument of each form
;; (-> x (f a) (g b)) => (g (f x a) b)
;; (-> x f g) => (g (f x))
(macro -> [x & forms]
  (if (empty? forms)
    x
    (let (form (first forms)
          rest-forms (rest forms)
          threaded (if (list? form)
                     ;; Form is a list like (f a b), insert x as first arg: (f x a b)
                     `(~(first form) ~x ~@(rest form))
                     ;; Form is a symbol like f, make it (f x)
                     `(~form ~x)))
      `(-> ~threaded ~@rest-forms))))

;; Thread-last: inserts x as LAST argument of each form
;; (->> x (f a) (g b)) => (g b (f a x))
;; (->> x f g) => (g (f x))
(macro ->> [x & forms]
  (if (empty? forms)
    x
    (let (form (first forms)
          rest-forms (rest forms)
          threaded (if (list? form)
                     ;; Form is a list like (f a b), insert x as last arg: (f a b x)
                     `(~@form ~x)
                     ;; Form is a symbol like f, make it (f x)
                     `(~form ~x)))
      `(->> ~threaded ~@rest-forms))))

;; Thread-as: binds x to a symbol for arbitrary placement
;; (as-> 2 x (+ x 1) (* x 3)) => ((fn [x] (* x 3)) ((fn [x] (+ x 1)) 2))
;; Each form is wrapped in a function that binds the name, avoiding rebinding issues
(macro as-> [expr name & forms]
  (if (empty? forms)
    expr
    (let (first-form (first forms)
          rest-forms (rest forms))
      `((fn [~name] (as-> ~first-form ~name ~@rest-forms))
        ~expr))))

;; ----------------------------------------
;; Pattern Matching (Swift/Scala-style syntax)
;; ----------------------------------------
;; Syntax:
;;   (match value
;;     (case pattern result)
;;     (case pattern (if guard) result)
;;     (default result))
;;
;; Supported patterns:
;;   - Literals: 42, "hello", true, null
;;   - Wildcard: _ (matches anything, no binding)
;;   - Symbol: x (matches anything, binds to x)
;;   - Array: [a, b], [], [h, & t] (rest pattern)
;;   - Object: {name, age}, {name: n, age: a}
;;
;; Guards: (if condition) checked AFTER pattern binding
;;
;; Implementation: All logic inlined because macros receive literal arguments.
;; Time complexity: O(n) where n = number of clauses (optimal for sequential matching)

;; Main match macro - binds value once, dispatches to implementation
;; Uses auto-gensym (val#) for hygiene - Clojure-style syntax
(macro match [value & clauses]
  `(let (val# ~value)
     (%match-impl val# ~@clauses)))

;; Implementation macro - processes clauses recursively
(macro %match-impl [val-sym & clauses]
  (if (empty? clauses)
      `((fn [] (throw (new Error "No matching pattern"))))
      (let (clause (first clauses)
            rest-clauses (rest clauses)
            clause-kind (if (list? clause)
                            (if (symbol? (first clause))
                                (name (first clause))
                                "unknown")
                            "unknown"))
        (cond
          ((=== clause-kind "default")
           (nth clause 1))

          ((=== clause-kind "case")
           (let (pattern (nth clause 1)
                 ;; Guard detection
                 has-guard (if (>= (count clause) 4)
                               (if (list? (nth clause 2))
                                   (if (symbol? (first (nth clause 2)))
                                       (=== (name (first (nth clause 2))) "if")
                                       false)
                                   false)
                               false)
                 guard-expr (if has-guard (nth (nth clause 2) 1) nil)
                 result-expr (if has-guard (nth clause 3) (nth clause 2))
                 ;; Pattern classification - single symbol? check, reuse result
                 pat-name (if (symbol? pattern) (name pattern) nil)
                 is-wildcard (=== pat-name "_")
                 is-null-pat (=== pat-name "null")
                 is-binding (if pat-name (if is-wildcard false (if is-null-pat false true)) false)
                 ;; List pattern detection
                 is-list (if pat-name false (list? pattern))
                 head-name (if is-list (if (symbol? (first pattern)) (name (first pattern)) nil) nil)
                 is-object (if head-name (if (=== head-name "hash-map") true (=== head-name "__hql_hash_map")) false)
                 is-array (if is-list (if is-object false true) false)
                 ;; Array rest pattern detection
                 arr-len (if is-array (count pattern) 0)
                 has-rest (if (>= arr-len 2)
                              (if (symbol? (nth pattern (- arr-len 2)))
                                  (=== (name (nth pattern (- arr-len 2))) "&")
                                  false)
                              false)
                 check-len (if has-rest (- arr-len 2) arr-len)
                 ;; Generate condition
                 condition (cond
                             (is-wildcard true)
                             (is-binding true)
                             (is-null-pat `(=== ~val-sym null))
                             (is-object `(and (=== (typeof ~val-sym) "object")
                                              (!== ~val-sym null)
                                              (! (Array.isArray ~val-sym))))
                             (is-array (if has-rest
                                           `(and (Array.isArray ~val-sym)
                                                 (>= (js-get ~val-sym "length") ~check-len))
                                           `(and (Array.isArray ~val-sym)
                                                 (=== (js-get ~val-sym "length") ~check-len))))
                             (else `(=== ~val-sym ~pattern)))
                 ;; Fallback for next clause
                 fallback `(%match-impl ~val-sym ~@rest-clauses)
                 ;; Generate body - 3 cases: no-binding, simple-binding, destructure
                 needs-destruct (if is-object true is-array)
                 body (cond
                        ;; Simple symbol binding
                        (is-binding
                         (if has-guard
                             `(let (~pattern ~val-sym) (if ~guard-expr ~result-expr ~fallback))
                             `(let (~pattern ~val-sym) ~result-expr)))
                        ;; Destructuring (object/array)
                        (needs-destruct
                         (if has-guard
                             `(do (let ~pattern ~val-sym) (if ~guard-expr ~result-expr ~fallback))
                             `(do (let ~pattern ~val-sym) ~result-expr)))
                        ;; No binding (wildcard, null, literal)
                        (else
                         (if has-guard `(if ~guard-expr ~result-expr ~fallback) result-expr))))
             ;; Optimization: skip (if true ...) when condition is always true
             (if (=== condition true)
                 body
                 `(if ~condition ~body ~fallback))))

          (else
           `((fn [] (throw (new Error "Invalid match clause")))))))))