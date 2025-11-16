;; Data Structure and Access Patterns in HQL
;; This demonstrates the disambiguation between property/array access and function calls

;; ========== SECTION 1: STRING KEY PROPERTY ACCESS vs FUNCTION CALLS ==========

;; Define an object with properties
(var person { 
  "name": "John", 
  "age": 30, 
  "hobbies": ["coding", "reading", "hiking"],
  "0": "zero-index-property"
})

;; Define a function that returns values based on keys
(fn get-hobby [key]
  (str "Finding hobby: " key))

;; Add properties to the function itself
(= get-hobby.version "1.0")
(= get-hobby.author "HQL Team")

;; === CASE 1: String property access ===
(print "\n=== CASE 1: String property access ===")
(print "(person \"name\") -> " (person "name"))
(print "(person.name) -> " person.name)
(print "(get person \"name\") -> " (get person "name"))

;; === CASE 2: String property that doesn't exist (undefined) ===
(print "\n=== CASE 2: Non-existent string property ===")
(print "(person \"address\") -> " (person "address"))

;; === CASE 3: String-keyed property access on a function ===
(print "\n=== CASE 3: String property access on a function ===")
(print "(get-hobby \"version\") -> " (get-hobby "version")) ;; Should access the property, not call the function

;; === CASE 4: Actual function call with string argument ===
(print "\n=== CASE 4: Function call with string argument ===")
(print "(get-hobby \"hiking\") -> " (get-hobby "hiking")) 

;; This is a fallback case - there's no 'hiking' property on get-hobby, so it calls the function

;; ========== SECTION 2: NUMERIC INDEX ACCESS vs FUNCTION CALLS ==========

;; Define an array
(var fruits ["apple", "banana", "cherry", "date", "elderberry"])

;; Define a function that multiplies a number
(fn multiply-by-two [n]
  (* n 2))

;; Define a function that has a numeric property
(= multiply-by-two.0 "zero-property")

;; === CASE 5: Numeric array indexing ===
(print "\n=== CASE 5: Numeric array indexing ===")
(print "(fruits 2) -> " (fruits 2)) ;; Should return "cherry"
(print "(get fruits 2) -> " (get fruits 2)) ;; Should return "cherry"

;; === CASE 6: Numeric property that doesn't exist on array ===
(print "\n=== CASE 6: Non-existent numeric property on array ===")
(print "(fruits 10) [expected:, undefined, or, error] -> ")
;; Just check if the array has this index first
(if (< 10 (fruits.length))
  (print (fruits 10))
  (print "(Index out of bounds as expected)"))

;; === CASE 7: Numeric property access on object ===
(print "\n=== CASE 7: Numeric property access on object ===")
(print "(person 0) -> " (person 0)) ;; Should access the "0" property

;; === CASE 8: Numeric property access on a function ===
(print "\n=== CASE 8: Numeric property access on a function ===")
(print "(multiply-by-two 0) -> " (multiply-by-two 0)) ;; Should prioritize property access

;; === CASE 9: Actual function call with numeric argument ===
(print "\n=== CASE 9: Function call with numeric argument ===")
(print "(multiply-by-two 5) -> " (multiply-by-two 5)) ;; Should call the function since no '5' property exists

;; ========== SECTION 3: LAMBDA AND METHOD CHAIN CONTEXTS ==========

;; === CASE 10: Lambda with array indexing pattern ===
(print "\n=== CASE 10: Lambda with array indexing pattern ===")
(var entries (Object.entries person))
(print "Original entries: " entries)

(var filtered (entries.filter (fn [entry] (!= (entry 0) "age"))))
(print "Filtered entries (excluding 'age'): " filtered)

;; === CASE 11: Lambda with function call pattern ===
(print "\n=== CASE 11: Lambda with function call pattern ===")
(var numbers [1, 2, 3, 4, 5])
(var doubled (numbers.map (fn [n] (multiply-by-two n))))
(print "Doubled numbers: " doubled)

;; ========== CONCLUSION ==========
(print "\nAll tests completed successfully!")
