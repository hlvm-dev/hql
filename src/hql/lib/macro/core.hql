;; ====================================================
;; HQL Core Macros Library
;; ====================================================
;;
;; IMPORTANT: This is the SOURCE FILE for core macros.
;; After editing this file, run: deno task embed-macros
;; to regenerate src/hql/lib/embedded-macros.ts
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

;; REMOVED: nil? - use isNil instead (camelCase convention)
;; REMOVED: empty? - use isEmpty from stdlib instead (camelCase convention)

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

;; Numeric predicates: isEven, isOdd, isZero, isPositive, isNegative
;; These are FUNCTIONS in stdlib (core.js), not macros.
;; Functions can be passed to higher-order functions like filter/map.

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
    (true `(|| ~(%first args) (or ~@(%rest args))))))

(macro and [& args]
  (cond
    ((%empty? args) true)
    ((=== (%length args) 1) (%first args))
    (true `(&& ~(%first args) (and ~@(%rest args))))))

(macro when [test & body]
  `(if ~test
       (do ~@body)
       nil))

;; Handle [] syntax: (when-let [x val]) is parsed as (when-let (vector x val))
;; Strip the "vector" prefix to normalize both () and [] syntax
(macro when-let [binding & body]
  (let (normalized-binding
         (if (symbol? (%first binding))
             (if (=== (name (%first binding)) "vector")
                 (%rest binding)
                 (if (=== (name (%first binding)) "empty-array")
                     (%rest binding)
                     binding))
             binding))
    (let (var-name (%first normalized-binding)
          var-value (%nth normalized-binding 1))
      `((fn [~var-name]
           (when ~var-name
               ~@body))
         ~var-value))))

(macro unless [test & body]
  `(if ~test
       nil
       (do ~@body)))

(macro inc [x]
  `(+ ~x 1))

(macro dec [x]
  `(- ~x 1))

(macro print [& args]
  (if (=== (%length args) 2)
      `(let (formatter (js-get js/globalThis "print")
            opts ~(%nth args 1))
         (if (and (isFunction formatter)
                  (js-get formatter "__hql_format_print__")
                  (isObject opts)
                  (js-get opts "type"))
             (formatter ~@args)
             (console.log ~@args)))
      `(console.log ~@args)))

;; NOTE: cons is in STDLIB - handles LazySeq properly

(macro set [target value]
  `(= ~target ~value))

(macro str [& args]
  (cond
    ((%empty? args) `"")
    ((=== (%length args) 1) `(+ "" ~(%first args)))
    (true `(+ ~@args))))

(macro contains [coll key]
  `(js-call ~coll "has" ~key))

;; NOTE: nth is in STDLIB - handles LazySeq properly

;; Handle [] syntax: (if-let [x val]) is parsed as (if-let (vector x val))
;; Strip the "vector" prefix to normalize both () and [] syntax
(macro if-let [binding then-expr else-expr]
  (let (normalized-binding
         (if (symbol? (%first binding))
             (if (=== (name (%first binding)) "vector")
                 (%rest binding)
                 (if (=== (name (%first binding)) "empty-array")
                     (%rest binding)
                     binding))
             binding))
    (let (var-name (%first normalized-binding)
          var-value (%nth normalized-binding 1))
      `((fn [~var-name]
           (if ~var-name
               ~then-expr
               ~else-expr))
         ~var-value))))

;; NOTE: second is in STDLIB - handles LazySeq properly

(macro hasElements [coll]
  `(> (length ~coll) 0))

(macro isEmptyList [coll]
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

;; cond - Supports BOTH syntaxes:
;; Grouped syntax: (cond ((< x 0) "neg") ((> x 0) "pos") (true "zero"))
;; Flat syntax:    (cond (< x 0) "neg" (> x 0) "pos" else "zero")
;; Detection: If first clause is a list with exactly 2 elements, use grouped syntax.
;; NOTE: Uses nested if instead of && to avoid circular dependency (and macro uses cond)
(macro cond [& clauses]
  (if (%empty? clauses)
      nil
      ;; Detect syntax based on first clause
      (let (first-clause (%first clauses))
        ;; Grouped syntax: first clause is a list with 2 elements like ((< x 0) "result")
        ;; Use nested if instead of && to avoid circular dependency
        (if (list? first-clause)
            (if (=== (%length first-clause) 2)
                ;; Grouped syntax: each clause is (test result)
                (let (test (%first first-clause)
                      result (%first (%rest first-clause))
                      remaining (%rest clauses))
                  (if (symbol? test)
                      (if (=== (name test) "else")
                          result
                          (if (%empty? remaining)
                              `(if ~test ~result nil)
                              `(if ~test ~result (cond ~@remaining))))
                      (if (%empty? remaining)
                          `(if ~test ~result nil)
                          `(if ~test ~result (cond ~@remaining)))))
                ;; List but not 2 elements - treat as flat syntax
                (if (%empty? (%rest clauses))
                    first-clause
                    (let (test first-clause
                          result (%first (%rest clauses))
                          remaining (%rest (%rest clauses)))
                      (if (symbol? test)
                          (if (=== (name test) "else")
                              result
                              (if (%empty? remaining)
                                  `(if ~test ~result nil)
                                  `(if ~test ~result (cond ~@remaining))))
                          (if (%empty? remaining)
                              `(if ~test ~result nil)
                              `(if ~test ~result (cond ~@remaining)))))))
            ;; Not a list - flat syntax: test1 result1 test2 result2 ...
            (if (%empty? (%rest clauses))
                ;; Single element - just return it (handles else or true at end)
                first-clause
                (let (test first-clause
                      result (%first (%rest clauses))
                      remaining (%rest (%rest clauses)))
                  (if (symbol? test)
                      (if (=== (name test) "else")
                          result
                          (if (%empty? remaining)
                              `(if ~test ~result nil)
                              `(if ~test ~result (cond ~@remaining))))
                      (if (%empty? remaining)
                          `(if ~test ~result nil)
                          `(if ~test ~result (cond ~@remaining))))))))))

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
  (if (%empty? forms)
    x
    (let (form (%first forms)
          rest-forms (%rest forms)
          threaded (if (list? form)
                     ;; Form is a list like (f a b), insert x as first arg: (f x a b)
                     `(~(%first form) ~x ~@(%rest form))
                     ;; Form is a symbol like f, make it (f x)
                     `(~form ~x)))
      `(-> ~threaded ~@rest-forms))))

;; Thread-last: inserts x as LAST argument of each form
;; (->> x (f a) (g b)) => (g b (f a x))
;; (->> x f g) => (g (f x))
(macro ->> [x & forms]
  (if (%empty? forms)
    x
    (let (form (%first forms)
          rest-forms (%rest forms)
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
  (if (%empty? forms)
    expr
    (let (first-form (%first forms)
          rest-forms (%rest forms))
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
;; Implementation: Uses IIFE with JS destructuring for object/array patterns.
;; This avoids macro-time let evaluation issues.
;; Time complexity: O(n) where n = number of clauses (optimal for sequential matching)


;; Main match macro - binds value once, dispatches to implementation
;; Uses auto-gensym (val#) for hygiene - Clojure-style syntax
(macro match [value & clauses]
  `(let (val# ~value)
     (__match_impl__ val# ~@clauses)))

;; Implementation macro - processes clauses recursively
(macro __match_impl__ [val-sym & clauses]
  (if (%empty? clauses)
      `((fn [] (throw (new Error "No matching pattern"))))
      (let (clause (%first clauses)
            rest-clauses (%rest clauses)
            clause-kind (if (list? clause)
                            (if (symbol? (%first clause))
                                (name (%first clause))
                                "unknown")
                            "unknown"))
        (cond
          ((=== clause-kind "default")
           (%nth clause 1))

          ((=== clause-kind "case")
           (let (pattern (%nth clause 1)
                 ;; Guard detection
                 has-guard (if (>= (%length clause) 4)
                               (if (list? (%nth clause 2))
                                   (if (symbol? (%first (%nth clause 2)))
                                       (=== (name (%first (%nth clause 2))) "if")
                                       false)
                                   false)
                               false)
                 guard-expr (if has-guard (%nth (%nth clause 2) 1) nil)
                 result-expr (if has-guard (%nth clause 3) (%nth clause 2))
                 ;; Pattern classification - single symbol? check, reuse result
                 pat-name (if (symbol? pattern) (name pattern) nil)
                 is-wildcard (=== pat-name "_")
                 is-null-pat (=== pat-name "null")
                 is-binding (if pat-name (if is-wildcard false (if is-null-pat false true)) false)
                 ;; List pattern detection
                 is-list (if pat-name false (list? pattern))
                 head-name (if is-list (if (symbol? (%first pattern)) (name (%first pattern)) nil) nil)
                 is-object (if head-name (if (=== head-name "hash-map") true (=== head-name "__hql_hash_map")) false)
                 is-array (if is-list (if is-object false true) false)
                 ;; Array rest pattern detection
                 arr-len (if is-array (%length pattern) 0)
                 has-rest (if (>= arr-len 2)
                              (if (symbol? (%nth pattern (- arr-len 2)))
                                  (=== (name (%nth pattern (- arr-len 2))) "&")
                                  false)
                              false)
                 check-len (if has-rest (- arr-len 2) arr-len)
                 ;; Generate condition using runtime helper __hql_match_obj
                 ;; For object patterns, pass the entire pattern - runtime extracts keys dynamically
                 ;; No hardcoding of key count - works for ANY number of keys
                 condition (cond
                             (is-wildcard true)
                             (is-binding true)
                             (is-null-pat `(=== ~val-sym null))
                             ;; Object pattern: pass pattern to runtime helper
                             ;; __hql_match_obj(val, pattern) extracts keys from pattern at indices 1,3,5,...
                             (is-object `(__hql_match_obj ~val-sym (quote ~pattern)))
                             (is-array (if has-rest
                                           `(and (Array.isArray ~val-sym)
                                                 (>= (js-get ~val-sym "length") ~check-len))
                                           `(and (Array.isArray ~val-sym)
                                                 (=== (js-get ~val-sym "length") ~check-len))))
                             (else `(=== ~val-sym ~pattern)))
                 ;; Fallback for next clause
                 fallback `(__match_impl__ ~val-sym ~@rest-clauses)
                 ;; Generate body - uses IIFE with destructuring param for object/array
                 ;; This bypasses macro-time let evaluation which doesn't support destructuring
                 body (cond
                        ;; Simple symbol binding
                        (is-binding
                         (if has-guard
                             `(let (~pattern ~val-sym) (if ~guard-expr ~result-expr ~fallback))
                             `(let (~pattern ~val-sym) ~result-expr)))
                        ;; Destructuring via IIFE - fn param supports destructuring!
                        (is-object
                         (if has-guard
                             `((fn [~pattern] (if ~guard-expr ~result-expr ~fallback)) ~val-sym)
                             `((fn [~pattern] ~result-expr) ~val-sym)))
                        (is-array
                         (if has-guard
                             `((fn [~pattern] (if ~guard-expr ~result-expr ~fallback)) ~val-sym)
                             `((fn [~pattern] ~result-expr) ~val-sym)))
                        ;; No binding (wildcard, null, literal)
                        (else
                         (if has-guard `(if ~guard-expr ~result-expr ~fallback) result-expr))))
             ;; Optimization: skip (if true ...) when condition is always true
             (if (=== condition true)
                 body
                 `(if ~condition ~body ~fallback))))

          (else
           `((fn [] (throw (new Error "Invalid match clause")))))))))
