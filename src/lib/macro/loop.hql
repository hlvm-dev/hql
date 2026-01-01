;; ====================================================
;; HQL Loop Constructs Library - Enhanced Version
;; This library implements a series of looping constructs
;; built on the fundamental loop/recur mechanism
;; ====================================================
;;
;; IMPORTANT: This is the SOURCE FILE for loop macros.
;; After editing this file, run: deno task embed-macros
;; to regenerate core/src/lib/embedded-macros.ts
;; ====================================================

;; ====================
;; 1. While Loop
;; ====================

;; Simple while loop - repeats body as long as condition is true
(macro while [condition & body]
  `(loop []
     (if ~condition
       (do
         ~@body
         (recur))
       nil)))

;; ====================
;; 2. Dotimes Loop (Clojure-style fixed iteration)
;; ====================

;; Simple dotimes loop - executes body a specific number of times
;; Named after Clojure's dotimes to avoid conflicts with user code
;; Example usage:
;; (dotimes 3 (print "hello"))
(macro dotimes [count & body]
  `(loop [i 0]
     (if (< i ~count)
       (do
         ~@body
         (recur (+ i 1)))
       nil)))

;; ====================
;; 2b. Repeat Loop (alias for dotimes)
;; ====================

;; repeat loop - executes body a specific number of times
;; Same as dotimes but with a different name
;; Example usage:
;; (repeat 3 (print "hello"))
(macro repeat [count & body]
  `(loop [__repeat_i 0]
     (if (< __repeat_i ~count)
       (do
         ~@body
         (recur (+ __repeat_i 1)))
       nil)))

;; ====================
;; 3. Enhanced For Loop
;; ====================

;; for loop - enhanced iteration with multiple syntaxes
;; Handle [] syntax: (for [x coll]) is parsed as (for (vector x coll))
;; Strip the "vector" prefix to normalize both () and [] syntax
;;
;; IMPORTANT: Uses for-of internally (not __hql_for_each with callback)
;; so that return/break/continue work correctly from the enclosing function.
(macro for [binding & body]
  (let (normalized-binding
         (if (symbol? (%first binding))
             (if (=== (name (%first binding)) "vector")
                 (%rest binding)
                 (if (=== (name (%first binding)) "empty-array")
                     (%rest binding)
                     binding))
             binding))
    (let (var (%first normalized-binding)
          spec (%rest normalized-binding)
          spec-count (%length spec)
          first-elem (%first spec))
    (cond
      ;; Error: empty spec
      ((=== spec-count 0)
       `(throw (str "Invalid 'for' loop binding: " '~binding)))

      ;; Collection/count iteration: (for (x coll) ...) or (for (i n) ...)
      ;; Uses for-of with __hql_toIterable to handle both collections and numbers
      ;; Numbers are converted to range(0, n) at runtime
      ((=== spec-count 1)
       `(for-of [~var (__hql_toIterable ~first-elem)]
          ~@body))

      ;; spec-count is 2 - could be positional OR named "to:"
      ((=== spec-count 2)
       ;; Check if first element is the SYMBOL "to:"
       (if (symbol? first-elem)
           (if (=== (name first-elem) "to:")
               ;; Named form: (for (i to: end) ...)
               (let (end (%nth spec 1))
                 `(for-of [~var (__hql_range 0 ~end)]
                    ~@body))
               ;; Positional form: (for (i start end) ...)
               (let (start first-elem
                     end (%nth spec 1))
                 `(for-of [~var (__hql_range ~start ~end)]
                    ~@body)))
           ;; Positional form: (for (i start end) ...)
           (let (start first-elem
                 end (%nth spec 1))
             `(for-of [~var (__hql_range ~start ~end)]
                ~@body))))

      ;; spec-count is 3 - could be positional OR named with step
      ((=== spec-count 3)
       ;; Positional form: (for (i start end step) ...)
       (let (start first-elem
             end (%nth spec 1)
             step (%nth spec 2))
         `(for-of [~var (__hql_range ~start ~end ~step)]
            ~@body)))

      ;; spec-count is 4 - must be named "to: end by: step" OR "from: start to: end"
      ((=== spec-count 4)
       (if (symbol? first-elem)
           (if (=== (name first-elem) "to:")
               ;; Named form: (for (i to: end by: step) ...)
               (if (symbol? (%nth spec 2))
                   (if (=== (name (%nth spec 2)) "by:")
                       (let (end (%nth spec 1)
                             step (%nth spec 3))
                         `(for-of [~var (__hql_range 0 ~end ~step)]
                            ~@body))
                       `(throw (str "Invalid 'for' loop binding: " '~binding)))
                   `(throw (str "Invalid 'for' loop binding: " '~binding)))
               (if (=== (name first-elem) "from:")
                   ;; Named form: (for (i from: start to: end) ...)
                   (if (symbol? (%nth spec 2))
                       (if (=== (name (%nth spec 2)) "to:")
                           (let (start (%nth spec 1)
                                 end (%nth spec 3))
                             `(for-of [~var (__hql_range ~start ~end)]
                                ~@body))
                           `(throw (str "Invalid 'for' loop binding: " '~binding)))
                       `(throw (str "Invalid 'for' loop binding: " '~binding)))
                   `(throw (str "Invalid 'for' loop binding: " '~binding))))
           `(throw (str "Invalid 'for' loop binding: " '~binding))))

      ;; spec-count is 6 - must be named "from: start to: end by: step"
      ((=== spec-count 6)
       (if (symbol? first-elem)
           (if (=== (name first-elem) "from:")
               (if (symbol? (%nth spec 2))
                   (if (=== (name (%nth spec 2)) "to:")
                       (if (symbol? (%nth spec 4))
                           (if (=== (name (%nth spec 4)) "by:")
                               (let (start (%nth spec 1)
                                     end (%nth spec 3)
                                     step (%nth spec 5))
                                 `(for-of [~var (__hql_range ~start ~end ~step)]
                                    ~@body))
                               `(throw (str "Invalid 'for' loop binding: " '~binding)))
                           `(throw (str "Invalid 'for' loop binding: " '~binding)))
                       `(throw (str "Invalid 'for' loop binding: " '~binding)))
                   `(throw (str "Invalid 'for' loop binding: " '~binding)))
               `(throw (str "Invalid 'for' loop binding: " '~binding)))
           `(throw (str "Invalid 'for' loop binding: " '~binding))))

      (true `(throw (str "Invalid 'for' loop binding: " '~binding))))))
  )
