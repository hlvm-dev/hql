; ============================================================================
; Rest Parameters Examples (v2.0) - Executable Demonstrations
; ============================================================================
; Run with: deno run -A core/cli/run.ts doc/features/13-rest-parameters/examples.hql

(print "=== REST PARAMETERS EXAMPLES ===")
(print "")

; Basic rest parameter
(print "1. Basic rest parameter:")
(fn sumAll [...nums]
  (.reduce nums (fn [acc val] (+ acc val)) 0))
(print "  (sumAll 1 2 3 4 5) =>" (sumAll 1 2 3 4 5))
(print "  (sumAll 10 20) =>" (sumAll 10 20))
(print "  (sumAll 100) =>" (sumAll 100))
(print "")

; Rest with regular param
(print "2. Rest with regular param:")
(fn addToBase [base ...nums]
  (+ base (.reduce nums (fn [acc val] (+ acc val)) 0)))
(print "  (addToBase 100 1 2 3) =>" (addToBase 100 1 2 3))
(print "  (addToBase 50 10 20 30) =>" (addToBase 50 10 20 30))
(print "")

; Rest with multiple regular params
(print "3. Rest with multiple regular params:")
(fn addAll [x y z ...rest]
  (+ x y z (.reduce rest (fn [acc val] (+ acc val)) 0)))
(print "  (addAll 10 20 30 1 2 3) =>" (addAll 10 20 30 1 2 3))
(print "  (addAll 5 10 15) =>" (addAll 5 10 15))
(print "")

; Empty rest arrays
(print "4. Empty rest arrays:")
(fn getLength [...items]
  (get items "length"))
(print "  (getLength) =>" (getLength))
(print "  (getLength 1) =>" (getLength 1))
(print "  (getLength 1 2 3 4 5) =>" (getLength 1 2 3 4 5))
(print "")

; Array indexing
(print "5. Array indexing on rest:")
(fn getFirst [...items]
  (get items 0))
(fn getSecond [...items]
  (get items 1))
(print "  (getFirst 10 20 30) =>" (getFirst 10 20 30))
(print "  (getSecond 10 20 30) =>" (getSecond 10 20 30))
(print "")

; Array methods
(print "6. Array methods on rest:")
(fn doubleAll [...nums]
  (.map nums (fn [n] (* n 2))))
(print "  (doubleAll 1 2 3) =>" (doubleAll 1 2 3))
(print "")

; Filter
(print "7. Filter on rest:")
(fn getEvens [...nums]
  (.filter nums (fn [n] (== (% n 2) 0))))
(print "  (getEvens 1 2 3 4 5 6) =>" (getEvens 1 2 3 4 5 6))
(print "")

; Multiply all
(print "8. Product of all:")
(fn multiply [...nums]
  (.reduce nums (fn [acc n] (* acc n)) 1))
(print "  (multiply 2 3 4) =>" (multiply 2 3 4))
(print "  (multiply 5 5 5) =>" (multiply 5 5 5))
(print "")

; String join
(print "9. Join strings:")
(fn concatAll [...strs]
  (.join strs ""))
(print "  (concatAll \"Hello\" \" \" \"World\") =>" (concatAll "Hello" " " "World"))
(print "")

; Join with separator
(print "10. Join with separator:")
(fn joinWithSep [sep ...strs]
  (.join strs sep))
(print "  (joinWithSep \", \" \"a\" \"b\" \"c\") =>" (joinWithSep ", " "a" "b" "c"))
(print "")

; Real-world: max function
(print "11. Max function:")
(fn max [...nums]
  (.reduce nums (fn [acc n] (? (> n acc) n acc)) (get nums 0)))
(print "  (max 3 7 2 9 1 5) =>" (max 3 7 2 9 1 5))
(print "  (max 100 50 75) =>" (max 100 50 75))
(print "")

; Real-world: min function
(print "12. Min function:")
(fn min [...nums]
  (.reduce nums (fn [acc n] (? (< n acc) n acc)) (get nums 0)))
(print "  (min 3 7 2 9 1 5) =>" (min 3 7 2 9 1 5))
(print "")

; Real-world: average
(print "13. Average function:")
(fn average [...nums]
  (let sum (.reduce nums (fn [a b] (+ a b)) 0))
  (/ sum (get nums "length")))
(print "  (average 10 20 30) =>" (average 10 20 30))
(print "  (average 5 10 15 20) =>" (average 5 10 15 20))
(print "")

(print "✅ All rest parameter examples completed successfully!")
