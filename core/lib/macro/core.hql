;; ====================================================
;; HQL Core Macros Library
;; ====================================================
;;
;; IMPORTANT: This is the SOURCE FILE for core macros.
;; After editing this file, run: deno task embed-macros
;; to regenerate core/src/lib/embedded-macros.ts
;; ====================================================

(macro not (value)
  `(if ~value false true))

;; Note: list?, symbol?, and name are built-in functions defined in environment.ts

;; Macro versions for user code (generate efficient inline code)
(macro length (coll)
  `(if (= ~coll null)
       0
       (js-get ~coll "length")))

(macro first (coll)
  `(get ~coll 0))

(macro rest (coll)
  `(js-call ~coll "slice" 1))

(macro next (coll)
  `(if (< (js-get ~coll "length") 2)
       null
       (js-call ~coll "slice" 1)))

(macro list (& items)
  `[~@items])

(macro nil? (x)
  `(= ~x null))

(macro empty? (coll)
  `(if (nil? ~coll)
       true
       (= (length ~coll) 0)))

(macro or (& args)
  (cond
    ((%empty? args) false)
    ((= (%length args) 1) (%first args))
    (true
      `((fn (value)
          (if value
              value
              (or ~@(%rest args))))
        ~(%first args)))))

(macro and (& args)
  (cond
    ((%empty? args) true)
    ((= (%length args) 1) (%first args))
    (true
      `((fn (value)
          (if value
              (and ~@(%rest args))
              value))
        ~(%first args)))))

(macro when (test & body)
  `(if ~test
       (do ~@body)
       nil))

(macro when-let (binding & body)
  (let (var-name (%first binding)
        var-value (%nth binding 1))
    `((fn (~var-name)
         (when ~var-name
             ~@body))
       ~var-value)))

(macro unless (test & body)
  `(if ~test
       nil
       (do ~@body)))

(macro inc (x)
  `(+ ~x 1))

(macro dec (x)
  `(- ~x 1))

(macro print (& args)
  `(console.log ~@args))

(macro cons (item lst)
  `(concat (list ~item) ~lst))

(fn concat (arr1 arr2)
  (js-call arr1 "concat" arr2))

(macro set (target value)
  `(set! ~target ~value))

(macro str (& args)
  (cond
    ((%empty? args) `"")
    ((= (%length args) 1) `(+ "" ~(%first args)))
    (true `(+ ~@args))))

(macro contains? (coll key)
  `(js-call ~coll "has" ~key))

(macro nth (coll index)
  `(get ~coll ~index))

(macro if-let (binding then-expr else-expr)
  (let (var-name (%first binding)
        var-value (%nth binding 1))
    `((fn (~var-name)
         (if ~var-name
             ~then-expr
             ~else-expr))
       ~var-value)))

(macro second (coll)
  `(if (and (not (nil? ~coll)) (> (length ~coll) 1))
      (nth ~coll 1)
      nil))

(macro rest? (coll)
  `(> (length ~coll) 0))

(macro empty-list? (coll)
  `(= (length ~coll) 0))

(macro rest-list (coll)
  `(js-call ~coll "slice" 1))

(macro seq (coll)
  `(if (= (js-get ~coll "length") 0)
       null
       ~coll))

(macro empty-array ()
  `(vector))

;; NOTE: `throw` is a kernel primitive, not a macro
;; It needs to create ThrowStatement IR node for exception handling

;; method-call is syntactic sugar over js-call
(macro method-call (obj method & args)
  `(js-call ~obj ~method ~@args))

(macro hash-map (& items)
  `(__hql_hash_map ~@items))

(macro empty-map ()
  `(hash-map))

(macro empty-set ()
  `(hash-set))

;; ----------------------------------------
;; Core control flow
;; ----------------------------------------

(macro cond (& clauses)
  (if (%empty? clauses)
      nil
      (let (first-clause (%first clauses)
            rest-clauses (%rest clauses)
            first-el (%first first-clause))
        ;; Check if first clause is a list (e.g., (else expr))
        ;; If we can extract a first element, it's a list
        (if (not (= first-el nil))
            ;; List clause syntax: ((test) result)
            (let (test first-el
                  result (%first (%rest first-clause)))
              ;; Check if test is the symbol 'else' - if so, return result directly
              (if (symbol? test)
                  (if (= (name test) "else")
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
