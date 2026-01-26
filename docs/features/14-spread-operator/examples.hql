; ============================================================================
; Spread Operator Examples (v2.0) - Executable Demonstrations
; ============================================================================
; Run with: deno run -A src/hlvm/cli/run.ts docs/features/14-spread-operator/examples.hql

(import [assert, assertEqual] from "@hlvm/assert")

(print "=== SPREAD OPERATOR EXAMPLES ===")
(print "")

; Array spread at different positions
(print "1. Array spread positions:")
(let arr1 [1 2])
(let spread-1 [...arr1 3 4])
(assertEqual spread-1 [1, 2, 3, 4] "array spread tail")
(print "  [...arr1 3 4] =>" spread-1)
(let arr2 [2 3])
(let spread-2 [1 ...arr2 4])
(assertEqual spread-2 [1, 2, 3, 4] "array spread middle")
(print "  [1 ...arr2 4] =>" spread-2)
(let arr3 [3 4])
(let spread-3 [1 2 ...arr3])
(assertEqual spread-3 [1, 2, 3, 4] "array spread head")
(print "  [1 2 ...arr3] =>" spread-3)
(print "")

; Multiple spreads
(print "2. Multiple spreads:")
(let a [1 2])
(let b [5 6])
(let spread-multi [0 ...a 3 4 ...b 7])
(assertEqual spread-multi [0, 1, 2, 3, 4, 5, 6, 7] "multiple spreads")
(print "  [0 ...a 3 4 ...b 7] =>" spread-multi)
(print "")

; Empty array spread
(print "3. Empty array spread:")
(let empty [])
(let spread-empty [1 ...empty 2])
(assertEqual spread-empty [1, 2] "empty spread")
(print "  [1 ...empty 2] =>" spread-empty)
(print "")

; Single element
(print "4. Single element spread:")
(let single [42])
(let spread-single [1 ...single 3])
(assertEqual spread-single [1, 42, 3] "single element spread")
(print "  [1 ...single 3] =>" spread-single)
(print "")

; Function call spread
(print "5. Function call spread:")
(fn add3 [x y z] (+ x y z))
(let args [1 2 3])
(let add3-result (add3 ...args))
(assert (=== add3-result 6) "function call spread")
(print "  (add3 ...args) =>" add3-result)
(print "")

; Mixed positional and spread
(print "6. Mixed positional and spread:")
(fn add4 [w x y z] (+ w x y z))
(let rest [3 4])
(let add4-result (add4 1 2 ...rest))
(assert (=== add4-result 10) "mixed positional and spread")
(print "  (add4 1 2 ...rest) =>" add4-result)
(print "")

; Multiple spreads in function call
(print "7. Multiple spreads in call:")
(fn sumAll [...nums]
  (.reduce nums (fn [a b] (+ a b)) 0))
(let nums1 [1 2])
(let nums2 [3 4])
(let sumAll-result (sumAll ...nums1 ...nums2))
(assert (=== sumAll-result 10) "spread in call")
(print "  (sumAll ...nums1 ...nums2) =>" sumAll-result)
(print "")

; Spread same array twice
(print "8. Spread same array twice:")
(let repeat [1 2])
(let spread-repeat [...repeat ...repeat])
(assertEqual spread-repeat [1, 2, 1, 2] "repeat spread")
(print "  [...repeat ...repeat] =>" spread-repeat)
(print "")

; Deeply nested spreads
(print "9. Deeply nested spreads:")
(let level1 [1])
(let level2 [...level1 2])
(let level3 [...level2 3])
(let level4 [...level3 4])
(assertEqual level4 [1, 2, 3, 4] "nested spreads")
(print "  Nested build:" level4)
(print "")

; Array copy
(print "10. Shallow copy:")
(let original [1 2 3])
(let copy [...original])
(assertEqual copy [1, 2, 3] "shallow copy")
(print "  [...original] =>" copy)
(print "")

; Append/prepend
(print "11. Append and prepend:")
(let base [2 3 4])
(let prepend [1 ...base])
(let append [...base 5])
(assertEqual prepend [1, 2, 3, 4] "prepend spread")
(assertEqual append [2, 3, 4, 5] "append spread")
(print "  [1 ...base] =>" prepend)
(print "  [...base 5] =>" append)
(print "")

; With map result
(print "12. With map result:")
(let nums [1 2 3])
(let doubled (.map nums (fn [x] (* x 2))))
(let spread-doubled [...doubled 7])
(assertEqual spread-doubled [2, 4, 6, 7] "spread map result")
(print "  [...doubled 7] =>" spread-doubled)
(print "")

; With filter result
(print "13. With filter result:")
(let numbers [1 2 3 4 5])
(let evens (.filter numbers (fn [x] (== (% x 2) 0))))
(let spread-evens [0 ...evens 6])
(assertEqual spread-evens [0, 2, 4, 6] "spread filter result")
(print "  [0 ...evens 6] =>" spread-evens)
(print "")

; Object spread
(print "14. Object spread:")
(let obj1 {"a": 1, "b": 2})
(let obj2 {...obj1, "c": 3})
(assertEqual obj2 {"a": 1, "b": 2, "c": 3} "object spread")
(print "  {...obj1, c: 3} =>" obj2)
(print "")

; Object merge
(print "15. Object merge:")
(let defaults {"timeout": 30, "retries": 3})
(let custom {"timeout": 60})
(let config {...defaults, ...custom})
(assertEqual config {"timeout": 60, "retries": 3} "object merge")
(print "  {...defaults, ...custom} =>" config)
(print "")

; Object property override
(print "16. Property override:")
(let baseObj {"a": 1, "b": 2})
(let modified {...baseObj, "a": 99})
(assertEqual modified {"a": 99, "b": 2} "object override")
(print "  {...baseObj, a: 99} =>" modified)
(print "")

; Combine let binding
(print "17. Combined array spread:")
(let arrA [1 2])
(let arrB [3 4])
(let combined [...arrA ...arrB])
(assertEqual combined [1, 2, 3, 4] "combined spread")
(print "  [...arrA ...arrB] =>" combined)
(print "")

; Spread with rest in function
(print "18. Spread with rest parameter:")
(fn sumWithFirst [first ...rest]
  (+ first (.reduce rest (fn [a b] (+ a b)) 0)))
(let values [2 3 4])
(let sumWithFirst-result (sumWithFirst 1 ...values))
(assert (=== sumWithFirst-result 10) "spread with rest")
(print "  (sumWithFirst 1 ...values) =>" sumWithFirst-result)
(print "")

(print "✅ All spread operator examples completed successfully!")
