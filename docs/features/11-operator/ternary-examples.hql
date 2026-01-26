; ============================================================================
; Ternary Operator Examples (v2.0) - Executable Demonstrations
; ============================================================================
; Run with: deno run -A src/hlvm/cli/run.ts docs/features/11-operator/ternary-examples.hql

(import [assert] from "@hlvm/assert")

(print "=== TERNARY OPERATOR EXAMPLES ===")
(print "")

; Basic ternary usage
(print "1. Basic ternary:")
(let ternary-true (? true "yes" "no"))
(let ternary-false (? false "yes" "no"))
(assert (=== ternary-true "yes") "ternary true")
(assert (=== ternary-false "no") "ternary false")
(print "  (? true \"yes\" \"no\") =>" ternary-true)
(print "  (? false \"yes\" \"no\") =>" ternary-false)
(print "")

; With comparison
(print "2. With comparison:")
(let compare-gt (? (> 10 5) "greater" "lesser"))
(let compare-lt (? (< 3 7) "less" "more"))
(assert (=== compare-gt "greater") "ternary with >")
(assert (=== compare-lt "less") "ternary with <")
(print "  (? (> 10 5) \"greater\" \"lesser\") =>" compare-gt)
(print "  (? (< 3 7) \"less\" \"more\") =>" compare-lt)
(print "")

; In arithmetic expressions
(print "3. In arithmetic:")
(let arith-add (+ 10 (? true 5 3)))
(let arith-mul (* 2 (? false 10 20)))
(assert (=== arith-add 15) "ternary in addition")
(assert (=== arith-mul 40) "ternary in multiplication")
(print "  (+ 10 (? true 5 3)) =>" arith-add)
(print "  (* 2 (? false 10 20)) =>" arith-mul)
(print "")

; Falsy values
(print "4. Falsy values:")
(let falsy-zero (? 0 "then" "else"))
(let falsy-empty (? "" "then" "else"))
(let falsy-null (? null "then" "else"))
(let falsy-false (? false "then" "else"))
(assert (=== falsy-zero "else") "ternary falsy 0")
(assert (=== falsy-empty "else") "ternary falsy empty string")
(assert (=== falsy-null "else") "ternary falsy null")
(assert (=== falsy-false "else") "ternary falsy false")
(print "  (? 0 \"then\" \"else\") =>" falsy-zero)
(print "  (? \"\" \"then\" \"else\") =>" falsy-empty)
(print "  (? null \"then\" \"else\") =>" falsy-null)
(print "  (? false \"then\" \"else\") =>" falsy-false)
(print "")

; Truthy values
(print "5. Truthy values:")
(let truthy-one (? 1 "then" "else"))
(let truthy-text (? "text" "then" "else"))
(assert (=== truthy-one "then") "ternary truthy 1")
(assert (=== truthy-text "then") "ternary truthy string")
(print "  (? 1 \"then\" \"else\") =>" truthy-one)
(print "  (? \"text\" \"then\" \"else\") =>" truthy-text)
(print "")

; Nested ternaries
(print "6. Nested ternaries:")
(let score 85)
(let grade (? (< score 60) "F"
              (? (< score 70) "D"
                (? (< score 80) "C"
                  (? (< score 90) "B" "A")))))
(assert (=== grade "B") "nested ternary grade")
(print "  Score 85 grade:" grade)
(print "")

; In function returns
(print "7. In function returns:")
(fn classify [n]
  (? (> n 0) "positive" "non-positive"))
(let class-pos (classify 10))
(let class-neg (classify -5))
(assert (=== class-pos "positive") "ternary in function true")
(assert (=== class-neg "non-positive") "ternary in function false")
(print "  (classify 10) =>" class-pos)
(print "  (classify -5) =>" class-neg)
(print "")

; With function calls
(print "8. With function calls:")
(fn double [x] (* x 2))
(fn triple [x] (* x 3))
(let call-true (? true (double 5) (triple 5)))
(let call-false (? false (double 5) (triple 5)))
(assert (=== call-true 10) "ternary with function calls true")
(assert (=== call-false 15) "ternary with function calls false")
(print "  (? true (double 5) (triple 5)) =>" call-true)
(print "  (? false (double 5) (triple 5)) =>" call-false)
(print "")

; In let bindings
(print "9. In let bindings:")
(let x 15)
(let message (? (> x 10) "big" "small"))
(assert (=== message "big") "ternary in let")
(print "  x=15, message:" message)
(print "")

; Real-world example: discount calculator
(print "10. Real-world: discount calculator")
(fn calculatePrice [basePrice isPremium quantity]
  (let discount (? isPremium 0.2 0.1))
  (let priceAfterDiscount (* basePrice (- 1 discount)))
  (* priceAfterDiscount quantity))
(let price-premium (calculatePrice 100 true 1))
(let price-regular (calculatePrice 100 false 1))
(let price-premium-bulk (calculatePrice 50 true 3))
(assert (=== price-premium 80) "price premium")
(assert (=== price-regular 90) "price regular")
(assert (=== price-premium-bulk 120) "price premium bulk")
(print "  Premium (100, true, 1):" price-premium)
(print "  Regular (100, false, 1):" price-regular)
(print "  Premium bulk (50, true, 3):" price-premium-bulk)
(print "")

(print "✅ All ternary examples completed successfully!")
