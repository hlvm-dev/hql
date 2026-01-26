; ============================================================================
; Rest Parameters Examples (v2.0) - Executable Demonstrations
; ============================================================================
; Run with: deno run -A src/hlvm/cli/run.ts docs/features/13-rest-parameters/examples.hql

(import [assert, assertEqual] from "@hlvm/assert")

(print "=== REST PARAMETERS EXAMPLES ===")
(print "")

; Basic rest parameter
(print "1. Basic rest parameter:")
(fn sumAll [...nums]
  (.reduce nums (fn [acc val] (+ acc val)) 0))
(let sumAll-1 (sumAll 1 2 3 4 5))
(let sumAll-2 (sumAll 10 20))
(let sumAll-3 (sumAll 100))
(assert (=== sumAll-1 15) "sumAll 1..5")
(assert (=== sumAll-2 30) "sumAll 10 20")
(assert (=== sumAll-3 100) "sumAll 100")
(print "  (sumAll 1 2 3 4 5) =>" sumAll-1)
(print "  (sumAll 10 20) =>" sumAll-2)
(print "  (sumAll 100) =>" sumAll-3)
(print "")

; Rest with regular param
(print "2. Rest with regular param:")
(fn addToBase [base ...nums]
  (+ base (.reduce nums (fn [acc val] (+ acc val)) 0)))
(let addToBase-1 (addToBase 100 1 2 3))
(let addToBase-2 (addToBase 50 10 20 30))
(assert (=== addToBase-1 106) "addToBase 100 + 1 2 3")
(assert (=== addToBase-2 110) "addToBase 50 + 10 20 30")
(print "  (addToBase 100 1 2 3) =>" addToBase-1)
(print "  (addToBase 50 10 20 30) =>" addToBase-2)
(print "")

; Rest with multiple regular params
(print "3. Rest with multiple regular params:")
(fn addAll [x y z ...rest]
  (+ x y z (.reduce rest (fn [acc val] (+ acc val)) 0)))
(let addAll-1 (addAll 10 20 30 1 2 3))
(let addAll-2 (addAll 5 10 15))
(assert (=== addAll-1 66) "addAll with rest")
(assert (=== addAll-2 30) "addAll without rest")
(print "  (addAll 10 20 30 1 2 3) =>" addAll-1)
(print "  (addAll 5 10 15) =>" addAll-2)
(print "")

; Empty rest arrays
(print "4. Empty rest arrays:")
(fn getLength [...items]
  (get items "length"))
(let len-0 (getLength))
(let len-1 (getLength 1))
(let len-5 (getLength 1 2 3 4 5))
(assert (=== len-0 0) "getLength empty")
(assert (=== len-1 1) "getLength one")
(assert (=== len-5 5) "getLength many")
(print "  (getLength) =>" len-0)
(print "  (getLength 1) =>" len-1)
(print "  (getLength 1 2 3 4 5) =>" len-5)
(print "")

; Array indexing
(print "5. Array indexing on rest:")
(fn getFirst [...items]
  (get items 0))
(fn getSecond [...items]
  (get items 1))
(let first-item (getFirst 10 20 30))
(let second-item (getSecond 10 20 30))
(assert (=== first-item 10) "getFirst")
(assert (=== second-item 20) "getSecond")
(print "  (getFirst 10 20 30) =>" first-item)
(print "  (getSecond 10 20 30) =>" second-item)
(print "")

; Array methods
(print "6. Array methods on rest:")
(fn doubleAll [...nums]
  (.map nums (fn [n] (* n 2))))
(let doubled (doubleAll 1 2 3))
(assertEqual doubled [2, 4, 6] "doubleAll")
(print "  (doubleAll 1 2 3) =>" doubled)
(print "")

; Filter
(print "7. Filter on rest:")
(fn getEvens [...nums]
  (.filter nums (fn [n] (== (% n 2) 0))))
(let evens (getEvens 1 2 3 4 5 6))
(assertEqual evens [2, 4, 6] "getEvens")
(print "  (getEvens 1 2 3 4 5 6) =>" evens)
(print "")

; Multiply all
(print "8. Product of all:")
(fn multiply [...nums]
  (.reduce nums (fn [acc n] (* acc n)) 1))
(let product-1 (multiply 2 3 4))
(let product-2 (multiply 5 5 5))
(assert (=== product-1 24) "multiply 2 3 4")
(assert (=== product-2 125) "multiply 5 5 5")
(print "  (multiply 2 3 4) =>" product-1)
(print "  (multiply 5 5 5) =>" product-2)
(print "")

; String join
(print "9. Join strings:")
(fn concatAll [...strs]
  (.join strs ""))
(let concat (concatAll "Hello" " " "World"))
(assert (=== concat "Hello World") "concatAll")
(print "  (concatAll \"Hello\" \" \" \"World\") =>" concat)
(print "")

; Join with separator
(print "10. Join with separator:")
(fn joinWithSep [sep ...strs]
  (.join strs sep))
(let joined (joinWithSep ", " "a" "b" "c"))
(assert (=== joined "a, b, c") "joinWithSep")
(print "  (joinWithSep \", \" \"a\" \"b\" \"c\") =>" joined)
(print "")

; Real-world: max function
(print "11. Max function:")
(fn max [...nums]
  (.reduce nums (fn [acc n] (? (> n acc) n acc)) (get nums 0)))
(let max-1 (max 3 7 2 9 1 5))
(let max-2 (max 100 50 75))
(assert (=== max-1 9) "max 3 7 2 9 1 5")
(assert (=== max-2 100) "max 100 50 75")
(print "  (max 3 7 2 9 1 5) =>" max-1)
(print "  (max 100 50 75) =>" max-2)
(print "")

; Real-world: min function
(print "12. Min function:")
(fn min [...nums]
  (.reduce nums (fn [acc n] (? (< n acc) n acc)) (get nums 0)))
(let min-1 (min 3 7 2 9 1 5))
(assert (=== min-1 1) "min 3 7 2 9 1 5")
(print "  (min 3 7 2 9 1 5) =>" min-1)
(print "")

; Real-world: average
(print "13. Average function:")
(fn average [...nums]
  (let sum (.reduce nums (fn [a b] (+ a b)) 0))
  (/ sum (get nums "length")))
(let avg-1 (average 10 20 30))
(let avg-2 (average 5 10 15 20))
(assert (=== avg-1 20) "average 10 20 30")
(assert (=== avg-2 12.5) "average 5 10 15 20")
(print "  (average 10 20 30) =>" avg-1)
(print "  (average 5 10 15 20) =>" avg-2)
(print "")

(print "✅ All rest parameter examples completed successfully!")
