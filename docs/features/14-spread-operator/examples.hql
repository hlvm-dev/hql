; ============================================================================
; Spread Operator Examples (v2.0) - Executable Demonstrations
; ============================================================================
; Run with: deno run -A src/hlvm/cli/run.ts docs/features/14-spread-operator/examples.hql

(print "=== SPREAD OPERATOR EXAMPLES ===")
(print "")

; Array spread at different positions
(print "1. Array spread positions:")
(let arr1 [1 2])
(print "  [...arr1 3 4] =>" [...arr1 3 4])
(let arr2 [2 3])
(print "  [1 ...arr2 4] =>" [1 ...arr2 4])
(let arr3 [3 4])
(print "  [1 2 ...arr3] =>" [1 2 ...arr3])
(print "")

; Multiple spreads
(print "2. Multiple spreads:")
(let a [1 2])
(let b [5 6])
(print "  [0 ...a 3 4 ...b 7] =>" [0 ...a 3 4 ...b 7])
(print "")

; Empty array spread
(print "3. Empty array spread:")
(let empty [])
(print "  [1 ...empty 2] =>" [1 ...empty 2])
(print "")

; Single element
(print "4. Single element spread:")
(let single [42])
(print "  [1 ...single 3] =>" [1 ...single 3])
(print "")

; Function call spread
(print "5. Function call spread:")
(fn add3 [x y z] (+ x y z))
(let args [1 2 3])
(print "  (add3 ...args) =>" (add3 ...args))
(print "")

; Mixed positional and spread
(print "6. Mixed positional and spread:")
(fn add4 [w x y z] (+ w x y z))
(let rest [3 4])
(print "  (add4 1 2 ...rest) =>" (add4 1 2 ...rest))
(print "")

; Multiple spreads in function call
(print "7. Multiple spreads in call:")
(fn sumAll [...nums]
  (.reduce nums (fn [a b] (+ a b)) 0))
(let nums1 [1 2])
(let nums2 [3 4])
(print "  (sumAll ...nums1 ...nums2) =>" (sumAll ...nums1 ...nums2))
(print "")

; Spread same array twice
(print "8. Spread same array twice:")
(let repeat [1 2])
(print "  [...repeat ...repeat] =>" [...repeat ...repeat])
(print "")

; Deeply nested spreads
(print "9. Deeply nested spreads:")
(let level1 [1])
(let level2 [...level1 2])
(let level3 [...level2 3])
(let level4 [...level3 4])
(print "  Nested build:" level4)
(print "")

; Array copy
(print "10. Shallow copy:")
(let original [1 2 3])
(let copy [...original])
(print "  [...original] =>" copy)
(print "")

; Append/prepend
(print "11. Append and prepend:")
(let base [2 3 4])
(print "  [1 ...base] =>" [1 ...base])
(print "  [...base 5] =>" [...base 5])
(print "")

; With map result
(print "12. With map result:")
(let nums [1 2 3])
(let doubled (.map nums (fn [x] (* x 2))))
(print "  [...doubled 7] =>" [...doubled 7])
(print "")

; With filter result
(print "13. With filter result:")
(let numbers [1 2 3 4 5])
(let evens (.filter numbers (fn [x] (== (% x 2) 0))))
(print "  [0 ...evens 6] =>" [0 ...evens 6])
(print "")

; Object spread
(print "14. Object spread:")
(let obj1 {"a": 1, "b": 2})
(let obj2 {...obj1, "c": 3})
(print "  {...obj1, c: 3} =>" obj2)
(print "")

; Object merge
(print "15. Object merge:")
(let defaults {"timeout": 30, "retries": 3})
(let custom {"timeout": 60})
(let config {...defaults, ...custom})
(print "  {...defaults, ...custom} =>" config)
(print "")

; Object property override
(print "16. Property override:")
(let baseObj {"a": 1, "b": 2})
(let modified {...baseObj, "a": 99})
(print "  {...baseObj, a: 99} =>" modified)
(print "")

; Combine let binding
(print "17. Combined array spread:")
(let arrA [1 2])
(let arrB [3 4])
(let combined [...arrA ...arrB])
(print "  [...arrA ...arrB] =>" combined)
(print "")

; Spread with rest in function
(print "18. Spread with rest parameter:")
(fn sumWithFirst [first ...rest]
  (+ first (.reduce rest (fn [a b] (+ a b)) 0)))
(let values [2 3 4])
(print "  (sumWithFirst 1 ...values) =>" (sumWithFirst 1 ...values))
(print "")

(print "✅ All spread operator examples completed successfully!")
