; ============================================================================
; Ternary Operator Examples (v2.0) - Executable Demonstrations
; ============================================================================
; Run with: deno run -A core/cli/run.ts doc/features/11-operator/ternary-examples.hql

(print "=== TERNARY OPERATOR EXAMPLES ===")
(print "")

; Basic ternary usage
(print "1. Basic ternary:")
(print "  (? true \"yes\" \"no\") =>" (? true "yes" "no"))
(print "  (? false \"yes\" \"no\") =>" (? false "yes" "no"))
(print "")

; With comparison
(print "2. With comparison:")
(print "  (? (> 10 5) \"greater\" \"lesser\") =>" (? (> 10 5) "greater" "lesser"))
(print "  (? (< 3 7) \"less\" \"more\") =>" (? (< 3 7) "less" "more"))
(print "")

; In arithmetic expressions
(print "3. In arithmetic:")
(print "  (+ 10 (? true 5 3)) =>" (+ 10 (? true 5 3)))
(print "  (* 2 (? false 10 20)) =>" (* 2 (? false 10 20)))
(print "")

; Falsy values
(print "4. Falsy values:")
(print "  (? 0 \"then\" \"else\") =>" (? 0 "then" "else"))
(print "  (? \"\" \"then\" \"else\") =>" (? "" "then" "else"))
(print "  (? null \"then\" \"else\") =>" (? null "then" "else"))
(print "  (? false \"then\" \"else\") =>" (? false "then" "else"))
(print "")

; Truthy values
(print "5. Truthy values:")
(print "  (? 1 \"then\" \"else\") =>" (? 1 "then" "else"))
(print "  (? \"text\" \"then\" \"else\") =>" (? "text" "then" "else"))
(print "")

; Nested ternaries
(print "6. Nested ternaries:")
(let score 85)
(let grade (? (< score 60) "F"
              (? (< score 70) "D"
                (? (< score 80) "C"
                  (? (< score 90) "B" "A")))))
(print "  Score 85 grade:" grade)
(print "")

; In function returns
(print "7. In function returns:")
(fn classify [n]
  (? (> n 0) "positive" "non-positive"))
(print "  (classify 10) =>" (classify 10))
(print "  (classify -5) =>" (classify -5))
(print "")

; With function calls
(print "8. With function calls:")
(fn double [x] (* x 2))
(fn triple [x] (* x 3))
(print "  (? true (double 5) (triple 5)) =>" (? true (double 5) (triple 5)))
(print "  (? false (double 5) (triple 5)) =>" (? false (double 5) (triple 5)))
(print "")

; In let bindings
(print "9. In let bindings:")
(let x 15)
(let message (? (> x 10) "big" "small"))
(print "  x=15, message:" message)
(print "")

; Real-world example: discount calculator
(print "10. Real-world: discount calculator")
(fn calculatePrice [basePrice isPremium quantity]
  (let discount (? isPremium 0.2 0.1))
  (let priceAfterDiscount (* basePrice (- 1 discount)))
  (* priceAfterDiscount quantity))
(print "  Premium (100, true, 1):" (calculatePrice 100 true 1))
(print "  Regular (100, false, 1):" (calculatePrice 100 false 1))
(print "  Premium bulk (50, true, 3):" (calculatePrice 50 true 3))
(print "")

(print "✅ All ternary examples completed successfully!")
